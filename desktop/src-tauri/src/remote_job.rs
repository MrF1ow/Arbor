use crate::transport::{
    map_ssh_error, quote_remote_command, remote_course_dir, remote_knowledge_root,
    remote_mkdir_tokens, remote_parent_dir, root_id_for, rsync_argv, rsync_remote_file_spec,
    rsync_remote_spec, rsync_ssh_wrapper, ssh_argv, ValidatedSsh,
};
use serde_json::Value;
use std::collections::HashSet;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

const REMOTE_PLAN_FILENAME: &str = "arbor-remote-plan.json";

pub trait RemoteOps {
    fn sync_up(&mut self, local_dir: &Path, remote_dir: &str) -> Result<(), String>;
    fn put_file(&mut self, local_file: &Path, remote_file: &str) -> Result<(), String>;
    fn run(
        &mut self,
        remote_tokens: &[String],
        on_line: &mut dyn FnMut(&str),
        interrupt: Option<&AtomicBool>,
    ) -> Result<i32, String>;
    fn sync_down(&mut self, remote_dir: &str, local_dir: &Path, rel_paths: &[String]) -> Result<(), String>;
    fn kill(&mut self) -> Result<(), String>;
    fn cancelled(&self) -> bool {
        false
    }
}

#[derive(Debug, Clone)]
pub struct RemoteJobRequest {
    pub endpoint: ValidatedSsh,
    pub local_root: PathBuf,
    pub courses: Vec<String>,
    pub remote_tokens: Vec<String>,
    pub plan_file: Option<PathBuf>,
    pub message: String,
    pub index: bool,
    pub cancel_after_first_line: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteJobOutcome {
    pub lines: Vec<String>,
    pub commit_paths: Vec<String>,
    pub committed: bool,
    pub error: Option<String>,
    pub killed: bool,
}

fn local_root_string(local_root: &Path) -> Result<String, String> {
    if !local_root.is_absolute() {
        return Err("local_root: must be absolute".to_string());
    }
    Ok(local_root.to_string_lossy().into_owned())
}

pub fn courses_from_selection_paths(paths: &[&str]) -> Result<Vec<String>, String> {
    let mut courses = Vec::new();
    let mut seen = HashSet::new();
    for path in paths {
        let path = path.trim();
        if path.is_empty() {
            return Err("selection path: required".to_string());
        }
        for component in path.split('/') {
            if component == ".." {
                return Err(format!("selection path: invalid `{path}`"));
            }
        }
        let Some((course, _rest)) = path.split_once('/') else {
            return Err(format!("selection path must include course: `{path}`"));
        };
        if course.is_empty() {
            return Err(format!("selection path: invalid `{path}`"));
        }
        if seen.insert(course.to_string()) {
            courses.push(course.to_string());
        }
    }
    Ok(courses)
}

pub fn prepare_remote_worker_tokens(
    remote_knowledge_root: &str,
    remote_plan_path: Option<&str>,
    worker_tokens: &[String],
    request_tokens: &[String],
) -> Result<Vec<String>, String> {
    let mut tokens: Vec<String> = worker_tokens.to_vec();
    tokens.extend_from_slice(request_tokens);

    let mut i = 0;
    while i < tokens.len() {
        if tokens[i] == "--cancel-file" {
            tokens.remove(i);
            if i < tokens.len() {
                tokens.remove(i);
            }
            continue;
        }
        i += 1;
    }

    let mut has_root = false;
    i = 0;
    while i < tokens.len() {
        if tokens[i] == "--root" {
            has_root = true;
            if i + 1 < tokens.len() {
                tokens[i + 1] = remote_knowledge_root.to_string();
            } else {
                tokens.push(remote_knowledge_root.to_string());
            }
            break;
        }
        i += 1;
    }
    if !has_root {
        tokens.push("--root".to_string());
        tokens.push(remote_knowledge_root.to_string());
    }

    if let Some(plan_path) = remote_plan_path {
        let mut found = false;
        i = 0;
        while i < tokens.len() {
            if tokens[i] == "--plan" {
                found = true;
                if i + 1 < tokens.len() {
                    tokens[i + 1] = plan_path.to_string();
                } else {
                    tokens.push(plan_path.to_string());
                }
                break;
            }
            i += 1;
        }
        if !found {
            tokens.push("--plan".to_string());
            tokens.push(plan_path.to_string());
        }
    }

    if !tokens.iter().any(|t| t == "--no-commit") {
        tokens.push("--no-commit".to_string());
    }

    quote_remote_command(&tokens)?;
    Ok(tokens)
}

fn parse_ndjson_line(line: &str, commit_paths: &mut Vec<String>, error: &mut Option<String>) {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return;
    };
    let Some(kind) = value.get("type").and_then(|v| v.as_str()) else {
        return;
    };
    match kind {
        "commit_paths" => {
            if let Some(paths) = value.get("paths").and_then(|v| v.as_array()) {
                for p in paths {
                    if let Some(s) = p.as_str() {
                        commit_paths.push(s.to_string());
                    }
                }
            }
        }
        "error" | "auth_failed" => {
            let msg = value
                .get("message")
                .and_then(|v| v.as_str())
                .or_else(|| value.get("reason").and_then(|v| v.as_str()))
                .unwrap_or("worker error");
            *error = Some(msg.to_string());
        }
        _ => {}
    }
}

fn ensure_local_parent_for_sync(local_dir: &Path, rel: &str) -> Result<(), String> {
    if rel.is_empty() {
        return Ok(());
    }
    let local_path = local_dir.join(rel);
    let Some(parent) = local_path.parent() else {
        return Ok(());
    };
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())
}

fn paths_for_course(course: &str, commit_paths: &[String]) -> Vec<String> {
    let prefix = format!("{course}/");
    commit_paths
        .iter()
        .filter_map(|p| {
            if p == course {
                Some(String::new())
            } else if p.starts_with(&prefix) {
                Some(p[prefix.len()..].to_string())
            } else {
                None
            }
        })
        .collect()
}

fn is_infrastructure_ssh_error(mapped: &str) -> bool {
    mapped.contains("host key mismatch")
        || mapped.to_lowercase().contains("authentication failed")
        || mapped.contains("worker command was not found")
        || mapped.contains("could not connect to the remote host")
}

fn resolve_run_error(stderr: &str, exit_code: i32, worker_error: &Option<String>) -> String {
    let mapped = map_ssh_error(stderr, exit_code);
    if is_infrastructure_ssh_error(&mapped) {
        return mapped;
    }
    if let Some(err) = worker_error {
        return err.clone();
    }
    mapped
}

pub fn run_remote_job(
    ops: &mut dyn RemoteOps,
    req: &RemoteJobRequest,
    local_commit: &mut dyn FnMut(&[String], &str, bool) -> Result<(), String>,
    mut on_line: Option<&mut dyn FnMut(&str)>,
) -> RemoteJobOutcome {
    let mut outcome = RemoteJobOutcome {
        lines: Vec::new(),
        commit_paths: Vec::new(),
        committed: false,
        error: None,
        killed: false,
    };

    let local_root_str = match local_root_string(&req.local_root) {
        Ok(s) => s,
        Err(e) => {
            outcome.error = Some(e);
            return outcome;
        }
    };
    let root_id = root_id_for(&local_root_str);
    let knowledge_root = match remote_knowledge_root(&req.endpoint.remote_root, &root_id) {
        Ok(p) => p,
        Err(e) => {
            outcome.error = Some(e);
            return outcome;
        }
    };

    for course in &req.courses {
        let remote_dir = match remote_course_dir(&req.endpoint.remote_root, &root_id, course) {
            Ok(d) => d,
            Err(e) => {
                outcome.error = Some(e);
                return outcome;
            }
        };
        let local_dir = req.local_root.join(course);
        if let Err(e) = ops.sync_up(&local_dir, &remote_dir) {
            outcome.error = Some(e);
            return outcome;
        }
    }

    let remote_plan_path = if req.plan_file.is_some() {
        Some(format!("{knowledge_root}/{REMOTE_PLAN_FILENAME}"))
    } else {
        None
    };

    if let Some(plan_local) = &req.plan_file {
        let remote_path = remote_plan_path.as_ref().expect("plan path");
        if let Err(e) = ops.put_file(plan_local, remote_path) {
            outcome.error = Some(e);
            return outcome;
        }
    }

    let remote_tokens = match prepare_remote_worker_tokens(
        &knowledge_root,
        remote_plan_path.as_deref(),
        &req.endpoint.worker_tokens,
        &req.remote_tokens,
    ) {
        Ok(t) => t,
        Err(e) => {
            outcome.error = Some(e);
            return outcome;
        }
    };

    let mut worker_error: Option<String> = None;
    let mut lines_seen = 0usize;
    let interrupt = Arc::new(AtomicBool::new(false));
    let interrupt_flag = interrupt.clone();
    let run_result = ops.run(
        &remote_tokens,
        &mut |line| {
            outcome.lines.push(line.to_string());
            parse_ndjson_line(line, &mut outcome.commit_paths, &mut worker_error);
            if let Some(cb) = on_line.as_deref_mut() {
                cb(line);
            }
            lines_seen += 1;
            if req.cancel_after_first_line && lines_seen == 1 {
                interrupt_flag.store(true, Ordering::SeqCst);
                outcome.killed = true;
            }
        },
        Some(&interrupt),
    );

    if ops.cancelled() {
        outcome.killed = true;
        outcome.error = None;
        return outcome;
    }

    match run_result {
        Ok(0) => {}
        Ok(_code) if outcome.killed => {}
        Ok(code) => {
            outcome.error = Some(resolve_run_error("", code, &worker_error));
            return outcome;
        }
        Err(_stderr) if outcome.killed => {}
        Err(stderr) => {
            outcome.error = Some(resolve_run_error(&stderr, 255, &worker_error));
            return outcome;
        }
    }

    if outcome.killed {
        return outcome;
    }

    if let Some(err) = worker_error {
        outcome.error = Some(err);
        return outcome;
    }

    for course in &req.courses {
        let remote_dir = match remote_course_dir(&req.endpoint.remote_root, &root_id, course) {
            Ok(d) => d,
            Err(e) => {
                outcome.error = Some(e);
                return outcome;
            }
        };
        let rels = paths_for_course(course, &outcome.commit_paths);
        if rels.is_empty() {
            continue;
        }
        let local_dir = req.local_root.join(course);
        if let Err(e) = ops.sync_down(&remote_dir, &local_dir, &rels) {
            outcome.error = Some(e);
            return outcome;
        }
    }

    if outcome.commit_paths.is_empty() {
        return outcome;
    }

    match local_commit(&outcome.commit_paths, &req.message, req.index) {
        Ok(()) => outcome.committed = true,
        Err(e) => outcome.error = Some(e),
    }
    outcome
}

type KillFn = Box<dyn FnMut() + Send>;

fn active_kill_slot() -> &'static Mutex<Option<KillFn>> {
    static SLOT: OnceLock<Mutex<Option<KillFn>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

fn active_cancel_flag() -> &'static Mutex<Option<Arc<AtomicBool>>> {
    static SLOT: OnceLock<Mutex<Option<Arc<AtomicBool>>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

pub fn cancel_active_remote() {
    if let Ok(guard) = active_cancel_flag().lock() {
        if let Some(flag) = guard.as_ref() {
            flag.store(true, Ordering::SeqCst);
        }
    }
    if let Ok(mut guard) = active_kill_slot().lock() {
        if let Some(kill) = guard.as_mut() {
            kill();
        }
    }
}

pub struct SystemRemoteOps {
    endpoint: ValidatedSsh,
    known_hosts: PathBuf,
    wrapper: PathBuf,
    child_pid: Option<u32>,
    run_cancelled: Option<Arc<AtomicBool>>,
}

impl SystemRemoteOps {
    pub fn new(
        endpoint: ValidatedSsh,
        app_data_dir: &Path,
    ) -> Result<Self, String> {
        let known_hosts = crate::transport::arbor_known_hosts_path(app_data_dir);
        let ssh_dir = app_data_dir.join("ssh");
        std::fs::create_dir_all(&ssh_dir).map_err(|e| e.to_string())?;
        let (wrapper, body) = rsync_ssh_wrapper(app_data_dir, &endpoint, &known_hosts)?;
        std::fs::write(&wrapper, body).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| e.to_string())?;
        }
        Ok(Self {
            endpoint,
            known_hosts,
            wrapper,
            child_pid: None,
            run_cancelled: None,
        })
    }

    fn rsync_with_excludes(
        &self,
        source: &str,
        destination: &str,
    ) -> Result<(), String> {
        let mut argv = rsync_argv(&self.wrapper, source, destination)?;
        let destination = argv.pop().expect("destination");
        let source = argv.pop().expect("source");
        for pattern in ["_arbor_cache/", ".arbor/", ".git/"] {
            argv.push("--exclude".to_string());
            argv.push(pattern.to_string());
        }
        argv.push(source);
        argv.push(destination);
        let output = Command::new(&argv[0])
            .args(&argv[1..])
            .output()
            .map_err(|e| e.to_string())?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).into_owned())
        }
    }

    fn remote_mkdir(&self, remote_abs_dir: &str) -> Result<(), String> {
        let tokens = remote_mkdir_tokens(remote_abs_dir)?;
        let argv = ssh_argv(&self.endpoint, &self.known_hosts, &tokens)?;
        let output = Command::new(&argv[0])
            .args(&argv[1..])
            .output()
            .map_err(|e| e.to_string())?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).into_owned())
        }
    }
}

impl RemoteOps for SystemRemoteOps {
    fn sync_up(&mut self, local_dir: &Path, remote_dir: &str) -> Result<(), String> {
        self.remote_mkdir(remote_dir)?;
        let local = format!("{}/", local_dir.to_string_lossy());
        let spec = rsync_remote_spec(&self.endpoint, remote_dir)?;
        self.rsync_with_excludes(&local, &spec)
    }

    fn put_file(&mut self, local_file: &Path, remote_file: &str) -> Result<(), String> {
        let parent = remote_parent_dir(remote_file)?;
        self.remote_mkdir(&parent)?;
        let spec = rsync_remote_file_spec(&self.endpoint, remote_file)?;
        self.rsync_with_excludes(&local_file.to_string_lossy(), &spec)
    }

    fn sync_down(
        &mut self,
        remote_dir: &str,
        local_dir: &Path,
        rel_paths: &[String],
    ) -> Result<(), String> {
        for rel in rel_paths {
            let remote = if rel.is_empty() {
                remote_dir.to_string()
            } else {
                format!("{remote_dir}/{rel}")
            };
            let spec = if rel.is_empty() {
                rsync_remote_spec(&self.endpoint, &remote)?
            } else {
                rsync_remote_file_spec(&self.endpoint, &remote)?
            };
            let local = if rel.is_empty() {
                format!("{}/", local_dir.to_string_lossy())
            } else {
                ensure_local_parent_for_sync(local_dir, rel)?;
                local_dir.join(rel).to_string_lossy().into_owned()
            };
            self.rsync_with_excludes(&spec, &local)?;
        }
        Ok(())
    }

    fn run(
        &mut self,
        remote_tokens: &[String],
        on_line: &mut dyn FnMut(&str),
        interrupt: Option<&AtomicBool>,
    ) -> Result<i32, String> {
        let cancelled = Arc::new(AtomicBool::new(false));
        cancelled.store(false, Ordering::SeqCst);
        self.run_cancelled = Some(cancelled.clone());
        {
            let mut flag_guard = active_cancel_flag().lock().map_err(|e| e.to_string())?;
            *flag_guard = Some(cancelled.clone());
        }

        let argv = ssh_argv(&self.endpoint, &self.known_hosts, remote_tokens)?;
        let mut child = Command::new(&argv[0]);
        child.args(&argv[1..]);
        child.stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            child.process_group(0);
        }
        let mut child = child.spawn().map_err(|e| e.to_string())?;
        let pid = child.id();
        self.child_pid = Some(pid);

        {
            let cancelled_kill = cancelled.clone();
            let mut guard = active_kill_slot().lock().map_err(|e| e.to_string())?;
            *guard = Some(Box::new(move || {
                cancelled_kill.store(true, Ordering::SeqCst);
                let _ = Command::new("kill")
                    .args(["-TERM", &format!("-{pid}")])
                    .status();
            }));
        }

        let stdout = child.stdout.take().ok_or("stdout")?;
        let stderr = child.stderr.take();
        let stderr_handle = stderr.map(|mut err| {
            std::thread::spawn(move || {
                let mut buf = Vec::new();
                let _ = std::io::copy(&mut err, &mut buf);
                buf
            })
        });

        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if interrupt.is_some_and(|f| f.load(Ordering::SeqCst)) {
                let _ = self.kill();
                break;
            }
            let line = line.map_err(|e| e.to_string())?;
            on_line(&line);
            if interrupt.is_some_and(|f| f.load(Ordering::SeqCst)) {
                let _ = self.kill();
                break;
            }
        }

        let status = child.wait().map_err(|e| e.to_string())?;
        let stderr_buf = stderr_handle
            .map(|h| h.join().unwrap_or_default())
            .unwrap_or_default();
        self.child_pid = None;
        if let Ok(mut guard) = active_kill_slot().lock() {
            *guard = None;
        }
        if let Ok(mut flag_guard) = active_cancel_flag().lock() {
            *flag_guard = None;
        }

        let code = status.code().unwrap_or(255);
        if code == 0 {
            Ok(0)
        } else {
            let stderr = String::from_utf8_lossy(&stderr_buf).into_owned();
            Err(stderr)
        }
    }

    fn kill(&mut self) -> Result<(), String> {
        if let Some(flag) = self.run_cancelled.as_ref() {
            flag.store(true, Ordering::SeqCst);
        }
        if let Some(pid) = self.child_pid.take() {
            let _ = Command::new("kill")
                .args(["-TERM", &format!("-{pid}")])
                .status();
        }
        Ok(())
    }

    fn cancelled(&self) -> bool {
        self.run_cancelled
            .as_ref()
            .is_some_and(|f| f.load(Ordering::SeqCst))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::{
        arbor_known_hosts_path, remote_course_dir, remote_mkdir_tokens, root_id_for, ssh_argv,
        validate_ssh, WorkerTransport,
    };
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    fn test_endpoint() -> ValidatedSsh {
        validate_ssh(&WorkerTransport::Ssh {
            host: "127.0.0.1".to_string(),
            port: 22222,
            user: None,
            identity_file: Some(PathBuf::from("/tmp/arbor-r14/ssh/client_key")),
            worker_cmd: "uv run --project /opt/arbor/python arbor-worker".to_string(),
            remote_root: "/tmp/arbor-r14/remote".to_string(),
        })
        .expect("endpoint")
    }

    struct FakeOps {
        sync_up_calls: Vec<(PathBuf, String)>,
        run_tokens: Option<Vec<String>>,
        run_count: AtomicUsize,
        kill_count: AtomicUsize,
        run_lines: Vec<String>,
        run_result: Result<i32, String>,
        block_until_kill: bool,
        killed: Arc<Mutex<bool>>,
        user_cancelled: bool,
    }

    impl FakeOps {
        fn new(run_result: Result<i32, String>) -> Self {
            Self {
                sync_up_calls: Vec::new(),
                run_tokens: None,
                run_count: AtomicUsize::new(0),
                kill_count: AtomicUsize::new(0),
                run_lines: vec![
                    r#"{"type":"stage","name":"write"}"#.to_string(),
                    r#"{"type":"commit_paths","paths":["Biology/digests/2026-10-18-lecture.md","Biology/course.md","Biology/arbor-course.json"]}"#.to_string(),
                    r#"{"type":"run_done","processed":1}"#.to_string(),
                ],
                run_result,
                block_until_kill: false,
                killed: Arc::new(Mutex::new(false)),
                user_cancelled: false,
            }
        }
    }

    impl RemoteOps for FakeOps {
        fn sync_up(&mut self, local_dir: &Path, remote_dir: &str) -> Result<(), String> {
            self.sync_up_calls
                .push((local_dir.to_path_buf(), remote_dir.to_string()));
            Ok(())
        }

        fn put_file(&mut self, _local_file: &Path, _remote_file: &str) -> Result<(), String> {
            Ok(())
        }

        fn run(
            &mut self,
            remote_tokens: &[String],
            on_line: &mut dyn FnMut(&str),
            interrupt: Option<&AtomicBool>,
        ) -> Result<i32, String> {
            self.run_count.fetch_add(1, Ordering::SeqCst);
            self.run_tokens = Some(remote_tokens.to_vec());
            if self.block_until_kill {
                loop {
                    if *self.killed.lock().unwrap() {
                        return Ok(255);
                    }
                    std::thread::sleep(std::time::Duration::from_millis(5));
                }
            }
            for line in &self.run_lines {
                on_line(line);
                if interrupt.is_some_and(|f| f.load(Ordering::SeqCst)) {
                    let _ = self.kill();
                    return Ok(255);
                }
            }
            self.run_result.clone()
        }

        fn sync_down(
            &mut self,
            _remote_dir: &str,
            _local_dir: &Path,
            _rel_paths: &[String],
        ) -> Result<(), String> {
            Ok(())
        }

        fn kill(&mut self) -> Result<(), String> {
            self.kill_count.fetch_add(1, Ordering::SeqCst);
            *self.killed.lock().unwrap() = true;
            Ok(())
        }

        fn cancelled(&self) -> bool {
            self.user_cancelled
        }
    }

    fn sample_request(endpoint: ValidatedSsh, local_root: PathBuf) -> RemoteJobRequest {
        RemoteJobRequest {
            endpoint,
            local_root,
            courses: vec!["Biology".to_string()],
            remote_tokens: vec![
                "update".to_string(),
                "--root".to_string(),
                "/local/knowledge".to_string(),
                "--model".to_string(),
                "m".to_string(),
                "--cancel-file".to_string(),
                "/tmp/cancel".to_string(),
            ],
            plan_file: None,
            message: "digest: Biology".to_string(),
            index: false,
            cancel_after_first_line: false,
        }
    }

    #[test]
    fn end_to_end_happy_path() {
        let endpoint = test_endpoint();
        let local_root = PathBuf::from("/tmp/Knowledge");
        let mut req = sample_request(endpoint.clone(), local_root.clone());
        req.index = true;
        let mut ops = FakeOps::new(Ok(0));
        let mut committed_paths: Option<Vec<String>> = None;
        let mut commit_index: Option<bool> = None;
        let outcome = run_remote_job(
            &mut ops,
            &req,
            &mut |paths, msg, index| {
                assert_eq!(msg, "digest: Biology");
                assert!(index);
                commit_index = Some(index);
                committed_paths = Some(paths.to_vec());
                Ok(())
            },
            None,
        );
        assert!(outcome.error.is_none());
        assert!(outcome.committed);
        assert_eq!(ops.sync_up_calls.len(), 1);
        assert!(ops.sync_up_calls[0].0.ends_with("Biology"));
        let tokens = ops.run_tokens.expect("tokens");
        let root_id = root_id_for("/tmp/Knowledge");
        let knowledge = remote_knowledge_root(&endpoint.remote_root, &root_id).unwrap();
        assert!(tokens.contains(&knowledge));
        assert!(!tokens.contains(&"/local/knowledge".to_string()));
        assert!(tokens.iter().any(|t| t == "--no-commit"));
        assert!(!tokens.iter().any(|t| t == "--cancel-file"));
        let paths = committed_paths.unwrap();
        assert_eq!(paths.len(), 3);
        assert_eq!(commit_index, Some(true));
    }

    #[test]
    fn sync_up_mkdir_ssh_argv() {
        let endpoint = test_endpoint();
        let app_data = PathBuf::from("/tmp/arbor-r14/xdg/data/com.arbor.app");
        let known = arbor_known_hosts_path(&app_data);
        let root_id = root_id_for("/tmp/Knowledge");
        let remote_dir =
            remote_course_dir("/tmp/arbor-r14/remote", &root_id, "Biology").unwrap();
        let tokens = remote_mkdir_tokens(&remote_dir).unwrap();
        let argv = ssh_argv(&endpoint, &known, &tokens).unwrap();
        let kh = argv
            .iter()
            .find(|a| a.starts_with("UserKnownHostsFile="))
            .expect("UserKnownHostsFile");
        assert!(kh.contains("/tmp/arbor-r14/xdg/data/com.arbor.app/ssh/known_hosts"));
        let remote_cmd = argv.last().expect("remote command");
        assert_eq!(
            remote_cmd,
            &format!("'mkdir' '-p' '{remote_dir}'")
        );
        assert!(remote_mkdir_tokens("/tmp/arbor-r14/remote/../etc/passwd").is_err());
    }

    #[test]
    fn ssh_argv_uses_app_known_hosts() {
        let endpoint = test_endpoint();
        let root_id = root_id_for("/tmp/Knowledge");
        let knowledge = remote_knowledge_root(&endpoint.remote_root, &root_id).unwrap();
        let tokens = prepare_remote_worker_tokens(
            &knowledge,
            None,
            &endpoint.worker_tokens,
            &["update".to_string(), "--model".to_string(), "m".to_string()],
        )
        .unwrap();
        let app_data = PathBuf::from("/var/tmp/arbor-test-app");
        let known = arbor_known_hosts_path(&app_data);
        let argv = ssh_argv(&endpoint, &known, &tokens).unwrap();
        let kh = argv
            .iter()
            .find(|a| a.starts_with("UserKnownHostsFile="))
            .unwrap();
        assert!(kh.contains("ssh/known_hosts"));
        assert!(!kh.contains(".ssh"));
    }

    #[test]
    fn user_cancel_after_ssh_err_is_killed_not_failed() {
        let endpoint = test_endpoint();
        let local_root = PathBuf::from("/tmp/Knowledge");
        let mut ops = FakeOps::new(Err("Connection reset".to_string()));
        ops.user_cancelled = true;
        let mut commit_called = false;
        let outcome = run_remote_job(
            &mut ops,
            &sample_request(endpoint, local_root),
            &mut |_, _, _| {
                commit_called = true;
                Ok(())
            },
            None,
        );
        assert!(outcome.killed);
        assert!(outcome.error.is_none());
        assert!(!commit_called);
    }

    #[test]
    fn cancel_kills_without_local_commit() {
        let endpoint = test_endpoint();
        let local_root = PathBuf::from("/tmp/Knowledge");
        let mut req = sample_request(endpoint, local_root);
        req.cancel_after_first_line = true;
        let mut ops = FakeOps::new(Ok(255));
        let mut commit_called = false;
        let outcome = run_remote_job(
            &mut ops,
            &req,
            &mut |_, _, _| {
                commit_called = true;
                Ok(())
            },
            None,
        );
        assert!(outcome.killed);
        assert!(!commit_called);
        assert_eq!(ops.kill_count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn transport_errors_map_and_skip_commit() {
        let endpoint = test_endpoint();
        let local_root = PathBuf::from("/tmp/Knowledge");
        let cases: Vec<(&str, fn(&str) -> bool)> = vec![
            (
                "Permission denied (publickey).",
                |e| e.to_lowercase().contains("authentication failed"),
            ),
            (
                "@@@@@@@@ REMOTE HOST IDENTIFICATION HAS CHANGED @@@@@@@@",
                |e| e.contains("host key mismatch") && !e.contains("~/.ssh"),
            ),
            (
                "bash: arbor-worker: command not found",
                |e| e.contains("worker command was not found"),
            ),
        ];
        for (stderr, check) in cases {
            let mut ops = FakeOps::new(Err(stderr.to_string()));
            let mut commit_called = false;
            let outcome = run_remote_job(
                &mut ops,
                &sample_request(endpoint.clone(), local_root.clone()),
                &mut |_, _, _| {
                    commit_called = true;
                    Ok(())
                },
                None,
            );
            assert!(
                outcome
                    .error
                    .as_deref()
                    .is_some_and(|e| check(e)),
                "stderr={stderr}"
            );
            assert!(!outcome.committed);
            assert!(!commit_called);
        }
    }

    #[test]
    fn worker_ndjson_error_overrides_empty_ssh_stderr() {
        let endpoint = test_endpoint();
        let local_root = PathBuf::from("/tmp/Knowledge");
        let mut ops = FakeOps::new(Err(String::new()));
        ops.run_lines = vec![r#"{"type":"error","message":"model refused"}"#.to_string()];
        let mut commit_called = false;
        let outcome = run_remote_job(
            &mut ops,
            &sample_request(endpoint, local_root),
            &mut |_, _, _| {
                commit_called = true;
                Ok(())
            },
            None,
        );
        assert_eq!(outcome.error.as_deref(), Some("model refused"));
        assert!(!outcome.committed);
        assert!(!commit_called);
    }

    #[test]
    fn sync_down_ensure_local_parent_creates_intermediate_dirs() {
        let base = std::env::temp_dir().join(format!(
            "arbor-sync-down-parent-{}",
            std::process::id()
        ));
        let course_dir = base.join("Biology");
        std::fs::create_dir_all(&course_dir).expect("course dir");
        let rel = "digests/2026-10-18.md";
        ensure_local_parent_for_sync(&course_dir, rel).expect("ensure parent");
        assert!(course_dir.join("digests").is_dir());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn courses_from_selection_paths_helper() {
        assert_eq!(
            courses_from_selection_paths(&["Biology/a.pdf"]).unwrap(),
            vec!["Biology".to_string()]
        );
        assert_eq!(
            courses_from_selection_paths(&["Biology/lecture..notes.pdf"]).unwrap(),
            vec!["Biology".to_string()]
        );
        assert!(courses_from_selection_paths(&["../etc/a.pdf"]).is_err());
        assert!(courses_from_selection_paths(&["Biology/../../etc/passwd"]).is_err());
        assert!(courses_from_selection_paths(&["orphan.pdf"]).is_err());
    }

    #[test]
    fn invalid_course_or_token_fails_before_run() {
        let endpoint = test_endpoint();
        let local_root = PathBuf::from("/tmp/Knowledge");
        let mut req = sample_request(endpoint.clone(), local_root.clone());
        req.courses = vec!["../etc".to_string()];
        let mut ops = FakeOps::new(Ok(0));
        let outcome = run_remote_job(&mut ops, &req, &mut |_, _, _| Ok(()), None);
        assert!(outcome.error.is_some());
        assert_eq!(ops.run_count.load(Ordering::SeqCst), 0);

        let mut req2 = sample_request(endpoint, local_root);
        req2.remote_tokens = vec!["foo;rm".to_string()];
        let mut ops2 = FakeOps::new(Ok(0));
        let outcome2 = run_remote_job(&mut ops2, &req2, &mut |_, _, _| Ok(()), None);
        assert!(outcome2.error.is_some());
        assert_eq!(ops2.run_count.load(Ordering::SeqCst), 0);
    }
}
