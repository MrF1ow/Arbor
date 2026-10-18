use crate::worker::{
    default_python_dir, kill_worker_tree, packaged_sidecar, parse_worker_json_output,
    process_path_for_spawn, resolve_worker_argv,     run_worker_json, uv_project_missing_error,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Deserialize)]
struct ServeResponse {
    id: u64,
    exit: i32,
    stdout: String,
    stderr: String,
}

struct Server {
    child: Child,
    stdin: Mutex<ChildStdin>,
    pending: Arc<Mutex<HashMap<u64, std::sync::mpsc::Sender<Result<ServeResponse, String>>>>>,
    dead: Arc<AtomicBool>,
}

pub struct WorkerPool {
    inner: Mutex<Option<Server>>,
    next_id: AtomicU64,
}

impl WorkerPool {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            next_id: AtomicU64::new(1),
        }
    }

    pub fn prewarm(self: &Arc<Self>, app_dir: &Path) {
        if serve_disabled() {
            return;
        }
        let pool = Arc::clone(self);
        let app_dir = app_dir.to_path_buf();
        thread::spawn(move || {
            let _ = pool.ensure_server(&app_dir);
        });
    }

    pub fn shutdown(&self) {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(mut server) = guard.take() {
            kill_worker_tree(&mut server.child);
            let _ = server.child.wait();
        }
    }
}

impl Default for WorkerPool {
    fn default() -> Self {
        Self::new()
    }
}

pub fn serve_eligible(sub_args: &[&str]) -> bool {
    let sub0 = sub_args.first().copied().unwrap_or("");
    match sub0 {
        "library-show" | "study-progress" | "study-plan" | "append-card" | "list-models"
        | "skill-index" => true,
        "sync" => sub_args.iter().any(|arg| *arg == "--show"),
        _ => false,
    }
}

fn serve_request_is_write(sub_args: &[&str]) -> bool {
    match sub_args.first() {
        Some(&"append-card") => true,
        Some(&"study-progress") => sub_args.iter().any(|arg| *arg == "grade" || *arg == "quiz"),
        _ => false,
    }
}

fn serve_disabled() -> bool {
    std::env::var("ARBOR_WORKER_NO_SERVE").as_deref() == Ok("1")
}

fn fail_all_pending(
    pending: &Arc<Mutex<HashMap<u64, std::sync::mpsc::Sender<Result<ServeResponse, String>>>>>,
    message: &str,
) {
    let mut map = pending.lock().unwrap_or_else(|e| e.into_inner());
    for (_, tx) in map.drain() {
        let _ = tx.send(Err(message.to_string()));
    }
}

fn spawn_server(app_dir: &Path) -> Result<Server, String> {
    let sidecar = if std::env::var("ARBOR_WORKER_NO_SIDECAR").as_deref() == Ok("1") {
        None
    } else {
        packaged_sidecar()
    };
    let argv = resolve_worker_argv(
        &|k| std::env::var(k).ok(),
        &default_python_dir(app_dir),
        &["serve"],
        sidecar.as_deref(),
    );
    if let Some(err) = uv_project_missing_error(&argv) {
        return Err(err);
    }
    let mut command = Command::new(&argv[0]);
    command
        .args(&argv[1..])
        .env("PATH", process_path_for_spawn())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("failed to launch worker serve: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "worker serve stdout unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "worker serve stderr unavailable".to_string())?;

    let pending: Arc<Mutex<HashMap<u64, std::sync::mpsc::Sender<Result<ServeResponse, String>>>>> =
        Arc::new(Mutex::new(HashMap::new()));
    let dead = Arc::new(AtomicBool::new(false));
    let pending_reader = Arc::clone(&pending);
    let dead_reader = Arc::clone(&dead);

    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let line = match line {
                Ok(line) => line,
                Err(_) => break,
            };
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let parsed: ServeResponse = match serde_json::from_str(trimmed) {
                Ok(value) => value,
                Err(err) => {
                    dead_reader.store(true, Ordering::SeqCst);
                    fail_all_pending(
                        &pending_reader,
                        &format!("worker server parse error: {err}"),
                    );
                    break;
                }
            };
            let id = parsed.id;
            let tx = pending_reader
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&id);
            if let Some(tx) = tx {
                let _ = tx.send(Ok(parsed));
            }
        }
        dead_reader.store(true, Ordering::SeqCst);
        fail_all_pending(&pending_reader, "worker server exited");
    });

    thread::spawn(move || {
        let perf = std::env::var("ARBOR_PERF").as_deref() == Ok("1");
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            if perf {
                eprintln!("[arbor-perf] serve-stderr {line}");
            }
        }
    });

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "worker serve stdin unavailable".to_string())?;

    Ok(Server {
        child,
        stdin: Mutex::new(stdin),
        pending,
        dead,
    })
}

impl WorkerPool {
    fn ensure_server(&self, app_dir: &Path) -> Result<(), String> {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let needs_spawn = match guard.as_ref() {
            None => true,
            Some(server) => server.dead.load(Ordering::SeqCst),
        };
        if needs_spawn {
            if let Some(mut old) = guard.take() {
                kill_worker_tree(&mut old.child);
                let _ = old.child.wait();
            }
            *guard = Some(spawn_server(app_dir)?);
        }
        Ok(())
    }

    fn drop_server(&self) {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(mut server) = guard.take() {
            kill_worker_tree(&mut server.child);
            let _ = server.child.wait();
        }
    }

    pub fn request(
        &self,
        app_dir: &Path,
        sub_args: &[&str],
        env: HashMap<String, String>,
        deadline: Duration,
    ) -> Result<serde_json::Value, String> {
        if serve_disabled() || !serve_eligible(sub_args) {
            let refs: Vec<(&str, &str)> = env
                .iter()
                .map(|(k, v)| (k.as_str(), v.as_str()))
                .collect();
            return run_worker_json(app_dir, sub_args, &refs);
        }

        let allow_retry = !serve_request_is_write(sub_args);
        for attempt in 0..2 {
            match self.request_once(app_dir, sub_args, &env, deadline) {
                Ok(RequestOutcome::Json(value)) => return Ok(value),
                Ok(RequestOutcome::SpawnFallback) => {
                    let refs: Vec<(&str, &str)> = env
                        .iter()
                        .map(|(k, v)| (k.as_str(), v.as_str()))
                        .collect();
                    return run_worker_json(app_dir, sub_args, &refs);
                }
                Err(err) if allow_retry && attempt == 0 && err.contains("worker server") => {
                    self.drop_server();
                    continue;
                }
                Err(err) => return Err(err),
            }
        }
        Err("worker server request failed".to_string())
    }

    fn request_once(
        &self,
        app_dir: &Path,
        sub_args: &[&str],
        env: &HashMap<String, String>,
        deadline: Duration,
    ) -> Result<RequestOutcome, String> {
        self.ensure_server(app_dir)?;

        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = std::sync::mpsc::channel();

        let pending_arc = {
            let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            let server = guard
                .as_ref()
                .ok_or_else(|| "worker server unavailable".to_string())?;
            if server.dead.load(Ordering::SeqCst) {
                return Err("worker server exited".to_string());
            }
            server
                .pending
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(id, tx);
            Arc::clone(&server.pending)
        };

        let request_line = serde_json::json!({
            "id": id,
            "argv": sub_args,
            "env": env,
        });
        let payload = serde_json::to_string(&request_line)
            .map_err(|e| format!("worker serve request encode failed: {e}"))?;

        {
            let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            let server = guard
                .as_ref()
                .ok_or_else(|| "worker server unavailable".to_string())?;
            let mut stdin = server.stdin.lock().unwrap_or_else(|e| e.into_inner());
            stdin
                .write_all(payload.as_bytes())
                .and_then(|_| stdin.write_all(b"\n"))
                .map_err(|e| format!("worker serve write failed: {e}"))?;
            stdin
                .flush()
                .map_err(|e| format!("worker serve flush failed: {e}"))?;
        }

        let started = Instant::now();
        match rx.recv_timeout(deadline) {
            Ok(Ok(resp)) => {
                if resp.exit == 64 {
                    return Ok(RequestOutcome::SpawnFallback);
                }
                let exit_code = if resp.exit == 0 { None } else { Some(resp.exit) };
                parse_worker_json_output(&resp.stdout, &resp.stderr, exit_code)
                    .map(RequestOutcome::Json)
            }
            Ok(Err(err)) => Err(err),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                self.drop_server();
                fail_all_pending(&pending_arc, "worker server timed out");
                let secs = deadline.as_secs();
                let sub0 = sub_args.first().copied().unwrap_or("");
                Err(format!(
                    "worker timed out after {secs}s: {sub0} ({}ms elapsed)",
                    started.elapsed().as_millis()
                ))
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                Err("worker server exited".to_string())
            }
        }
    }
}

enum RequestOutcome {
    Json(serde_json::Value),
    SpawnFallback,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use std::path::PathBuf;

    fn write_script(dir: &Path, body: &str) -> PathBuf {
        let script = dir.join("fake_serve.py");
        let mut file = fs::File::create(&script).unwrap();
        write!(
            file,
            "#!/usr/bin/env python3\nimport json, sys, os, time\n{body}\n"
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        }
        script
    }

    fn with_fake_serve<F: FnOnce(&Path)>(body: &str, test: F) {
        let _guard = crate::worker::WORKER_ENV_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let tmp = std::env::temp_dir().join(format!("arbor-serve-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let script = write_script(&tmp, body);
        std::env::set_var("ARBOR_WORKER_CMD", script.to_string_lossy().as_ref());
        std::env::set_var("ARBOR_WORKER_NO_SIDECAR", "1");
        std::env::remove_var("ARBOR_WORKER_NO_SERVE");
        test(Path::new("."));
        std::env::remove_var("ARBOR_WORKER_CMD");
        std::env::remove_var("ARBOR_WORKER_NO_SIDECAR");
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn serve_eligible_matches_allow_list() {
        assert!(serve_eligible(&["library-show", "--root", "/r"]));
        assert!(serve_eligible(&["sync", "--root", "/r", "--show"]));
        assert!(!serve_eligible(&["sync", "--root", "/r"]));
        assert!(serve_eligible(&[
            "study-progress",
            "--root",
            "/r",
            "--course",
            "c",
            "due"
        ]));
        assert!(serve_eligible(&["append-card", "--root", "/r"]));
        assert!(!serve_eligible(&["check-auth"]));
    }

    #[test]
    fn pool_orders_concurrent_requests() {
        let body = r#"
if "serve" not in sys.argv:
    print(json.dumps({"seq": 0}))
    sys.exit(0)
while True:
    line = sys.stdin.readline()
    if not line:
        break
    req = json.loads(line)
    rid = req["id"]
    time.sleep(0.02)
    sys.stdout.write(json.dumps({"id": rid, "exit": 0, "stdout": '{"seq":%d}\n' % rid, "stderr": ""}) + "\n")
    sys.stdout.flush()
"#;
        with_fake_serve(body, |app_dir| {
            let pool = Arc::new(WorkerPool::new());
            let app_dir = app_dir.to_path_buf();
            let handles: Vec<_> = (0..10)
                .map(|_| {
                    let pool = Arc::clone(&pool);
                    let app_dir = app_dir.clone();
                    thread::spawn(move || {
                        pool.request(
                            &app_dir,
                            &["library-show", "--root", "/r"],
                            HashMap::new(),
                            Duration::from_secs(5),
                        )
                        .unwrap()
                    })
                })
                .collect();
            let mut ids: Vec<u64> = handles
                .into_iter()
                .map(|h| h.join().unwrap()["seq"].as_u64().unwrap())
                .collect();
            ids.sort_unstable();
            assert_eq!(ids, (1..=10).collect::<Vec<_>>());
        });
    }

    #[test]
    fn pool_timeout_kills_server() {
        let body = r#"
if "serve" not in sys.argv:
    sys.exit(0)
while True:
    line = sys.stdin.readline()
    if not line:
        break
    req = json.loads(line)
    if req["argv"] and req["argv"][0] == "library-show":
        time.sleep(30)
    sys.stdout.write(json.dumps({"id": req["id"], "exit": 0, "stdout": '{"ok":true}\n', "stderr": ""}) + "\n")
    sys.stdout.flush()
"#;
        with_fake_serve(body, |app_dir| {
            let pool = WorkerPool::new();
            let err = pool
                .request(
                    app_dir,
                    &["library-show", "--root", "/r"],
                    HashMap::new(),
                    Duration::from_millis(200),
                )
                .unwrap_err();
            assert!(err.contains("timed out"));
            let guard = pool.inner.lock().unwrap();
            assert!(guard.is_none());
        });
    }

    #[test]
    fn pool_retries_read_after_crash() {
        let body = r#"
if "serve" not in sys.argv:
    sys.exit(0)
while True:
    line = sys.stdin.readline()
    if not line:
        break
    req = json.loads(line)
    if req["id"] == 1:
        os._exit(1)
    sys.stdout.write(json.dumps({"id": req["id"], "exit": 0, "stdout": '{"retry":true}\n', "stderr": ""}) + "\n")
    sys.stdout.flush()
"#;
        with_fake_serve(body, |app_dir| {
            let pool = WorkerPool::new();
            let value = pool
                .request(
                    app_dir,
                    &["library-show", "--root", "/r"],
                    HashMap::new(),
                    Duration::from_secs(5),
                )
                .unwrap();
            assert_eq!(value["retry"], true);
        });
    }

    #[test]
    fn pool_does_not_retry_grade() {
        let body = r#"
if "serve" not in sys.argv:
    sys.exit(0)
while True:
    line = sys.stdin.readline()
    if not line:
        break
    os._exit(1)
"#;
        with_fake_serve(body, |app_dir| {
            let pool = WorkerPool::new();
            let err = pool
                .request(
                    app_dir,
                    &[
                        "study-progress",
                        "--root",
                        "/r",
                        "--course",
                        "c",
                        "grade",
                        "--id",
                        "1",
                        "--result",
                        "good",
                        "--heading",
                        "",
                    ],
                    HashMap::new(),
                    Duration::from_secs(2),
                )
                .unwrap_err();
            assert!(err.contains("worker server"));
        });
    }

    #[test]
    fn pool_exit_64_falls_back_to_spawn() {
        let body = r#"
if "serve" not in sys.argv:
    print(json.dumps({"ok": "spawn"}))
    sys.exit(0)
while True:
    line = sys.stdin.readline()
    if not line:
        break
    req = json.loads(line)
    sys.stdout.write(json.dumps({"id": req["id"], "exit": 64, "stdout": "", "stderr": "not serve-eligible"}) + "\n")
    sys.stdout.flush()
"#;
        with_fake_serve(body, |app_dir| {
            let pool = WorkerPool::new();
            let value = pool
                .request(
                    app_dir,
                    &["library-show", "--root", "/r"],
                    HashMap::new(),
                    Duration::from_secs(5),
                )
                .unwrap();
            assert_eq!(value["ok"], "spawn");
        });
    }
}
