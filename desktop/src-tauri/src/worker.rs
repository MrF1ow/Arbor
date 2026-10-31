#[allow(unused_imports)]
pub use crate::transport::{
    arbor_known_hosts_path, map_ssh_error, quote_remote_command, quote_remote_token,
    remote_course_dir, remote_knowledge_root, root_id_for, rsync_argv, rsync_remote_spec,
    rsync_ssh_wrapper, ssh_argv, validate_ssh, ValidatedSsh, WorkerTransport,
};

use std::collections::HashSet;
use std::ffi::OsString;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::{Condvar, Mutex, OnceLock};
#[cfg(test)]
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(test)]
pub(crate) static WORKER_ENV_TEST_LOCK: Mutex<()> = Mutex::new(());

pub fn parse_worker_json_output(
    stdout: &str,
    stderr: &str,
    exit_code: Option<i32>,
) -> Result<serde_json::Value, String> {
    let mut last_invalid: Option<(serde_json::Error, String)> = None;
    for line in stdout.lines().rev() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        match serde_json::from_str::<serde_json::Value>(line) {
            Ok(value) => return Ok(value),
            Err(err) => {
                if last_invalid.is_none() {
                    last_invalid = Some((err, line.to_string()));
                }
            }
        }
    }
    if let Some((err, last)) = last_invalid {
        return Err(format!("invalid worker json: {err}: {last}"));
    }
    if let Some(code) = exit_code.filter(|code| *code != 0) {
        let trimmed = stderr.trim();
        let tail = stderr_tail(trimmed, 600);
        return Err(format!("worker failed to start (exit {code}): {tail}"));
    }
    Err(format!("worker produced no output (stderr: {stderr})"))
}

fn stderr_tail(trimmed: &str, max_bytes: usize) -> &str {
    if trimmed.len() <= max_bytes {
        return trimmed;
    }
    let mut start = trimmed.len() - max_bytes;
    while !trimmed.is_char_boundary(start) {
        start += 1;
    }
    &trimmed[start..]
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn extract_login_shell_path(raw: &str) -> Option<String> {
    const START: &str = "__ARBOR_PATH__";
    const END: &str = "__ARBOR_PATH__";
    let start = raw.find(START)? + START.len();
    let end = raw[start..].find(END)? + start;
    let path = raw[start..end].trim();
    if path.is_empty() {
        None
    } else {
        Some(path.to_string())
    }
}

#[cfg(target_os = "macos")]
fn login_shell_path_uncached() -> Option<String> {
    use std::process::{Command, Stdio};

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut child = Command::new(&shell)
        .arg("-ilc")
        .arg("printf \"__ARBOR_PATH__%s__ARBOR_PATH__\" \"$PATH\"")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                let output = child.wait_with_output().ok()?;
                if !output.status.success() {
                    return None;
                }
                return extract_login_shell_path(&String::from_utf8_lossy(&output.stdout));
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => return None,
        }
    }
}

static LOGIN_SHELL_PATH: OnceLock<Option<String>> = OnceLock::new();

fn cached_login_shell_path() -> Option<&'static str> {
    LOGIN_SHELL_PATH
        .get_or_init(|| {
            #[cfg(target_os = "macos")]
            {
                login_shell_path_uncached()
            }
            #[cfg(not(target_os = "macos"))]
            {
                None
            }
        })
        .as_deref()
}

fn push_path_segment(seen: &mut HashSet<String>, parts: &mut Vec<OsString>, segment: &str) {
    if segment.is_empty() || seen.contains(segment) {
        return;
    }
    seen.insert(segment.to_string());
    parts.push(OsString::from(segment));
}

pub fn augmented_path_from(
    home: Option<&str>,
    login_shell: Option<&str>,
    current: Option<&str>,
) -> OsString {
    let mut seen: HashSet<String> = HashSet::new();
    let mut parts: Vec<OsString> = Vec::new();
    if let Some(login) = login_shell.filter(|path| !path.is_empty()) {
        for segment in login.split(':') {
            push_path_segment(&mut seen, &mut parts, segment);
        }
    }
    if let Some(home) = home {
        for sub in [
            ".local/bin",
            ".grok/bin",
            ".claude/local",
            ".npm-global/bin",
            ".bun/bin",
            ".volta/bin",
            ".cargo/bin",
        ] {
            let segment = Path::new(home).join(sub).to_string_lossy().into_owned();
            push_path_segment(&mut seen, &mut parts, &segment);
        }
    }
    push_path_segment(&mut seen, &mut parts, "/opt/homebrew/bin");
    push_path_segment(&mut seen, &mut parts, "/usr/local/bin");
    if let Some(current) = current.filter(|path| !path.is_empty()) {
        for segment in current.split(':') {
            push_path_segment(&mut seen, &mut parts, segment);
        }
    }
    let mut joined = OsString::new();
    for (i, part) in parts.iter().enumerate() {
        if i > 0 {
            joined.push(":");
        }
        joined.push(part);
    }
    joined
}

pub fn sidecar_path_in(dir: &Path) -> Option<PathBuf> {
    let plain = dir.join("arbor-worker");
    if plain.is_file() {
        return Some(plain);
    }
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let text = name.to_string_lossy();
        if text.starts_with("arbor-worker-") && entry.path().is_file() {
            return Some(entry.path());
        }
    }
    None
}

/// Search paths for a packaged worker binary, in priority order.
pub fn sidecar_candidates(exe_dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    out.push(
        exe_dir
            .join("../Resources/arbor-worker/arbor-worker")
            .to_path_buf(),
    );
    out.push(exe_dir.join("arbor-worker/arbor-worker"));
    if let Some(onefile) = sidecar_path_in(exe_dir) {
        out.push(onefile);
    }
    out
}

fn first_existing_sidecar(candidates: &[PathBuf]) -> Option<PathBuf> {
    for path in candidates {
        if path.is_file() {
            return path
                .canonicalize()
                .ok()
                .or_else(|| Some(path.to_path_buf()));
        }
    }
    None
}

pub fn process_path_for_spawn() -> OsString {
    augmented_path_from(
        std::env::var("HOME").ok().as_deref(),
        cached_login_shell_path(),
        std::env::var("PATH").ok().as_deref(),
    )
}

fn process_path() -> OsString {
    process_path_for_spawn()
}

pub fn resolve_worker_argv(
    env: &dyn Fn(&str) -> Option<String>,
    default_python_dir: &str,
    sub_args: &[&str],
    sidecar: Option<&Path>,
) -> Vec<String> {
    if let Some(path) = sidecar {
        if path.is_file() {
            let mut argv = vec![path.to_string_lossy().into_owned()];
            argv.extend(sub_args.iter().map(|s| s.to_string()));
            return argv;
        }
    }
    if let Some(cmd) = env("ARBOR_WORKER_CMD") {
        let mut argv: Vec<String> = cmd.split_whitespace().map(|s| s.to_string()).collect();
        argv.extend(sub_args.iter().map(|s| s.to_string()));
        return argv;
    }
    let python_dir = env("ARBOR_PYTHON_DIR").unwrap_or_else(|| default_python_dir.to_string());
    let mut argv = vec![
        "uv".to_string(),
        "run".to_string(),
        "--project".to_string(),
        python_dir,
        "arbor-worker".to_string(),
    ];
    argv.extend(sub_args.iter().map(|s| s.to_string()));
    argv
}

pub fn packaged_sidecar() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    first_existing_sidecar(&sidecar_candidates(exe.parent()?))
}

#[allow(dead_code)]
pub fn default_python_dir(app_dir: &Path) -> String {
    // Dev assumption: the repo's `python/` dir sits next to `desktop/`.
    app_dir.join("python").to_string_lossy().to_string()
}

pub fn is_arbor_repo(dir: &Path) -> bool {
    let pyproject = dir.join("python").join("pyproject.toml");
    std::fs::read_to_string(pyproject)
        .map(|contents| contents.contains("arbor-worker"))
        .unwrap_or(false)
}

fn absolute_start(start: &Path, current_dir: Option<&Path>) -> PathBuf {
    if start.is_absolute() {
        start.to_path_buf()
    } else if let Some(cwd) = current_dir {
        cwd.join(start)
    } else {
        start.to_path_buf()
    }
}

pub fn find_repo_root(start: &Path) -> Option<PathBuf> {
    start
        .ancestors()
        .find(|dir| is_arbor_repo(dir))
        .map(|dir| dir.to_path_buf())
}

/// Locate the Arbor repo root (the folder that contains `python/`).
///
/// `ARBOR_REPO_DIR` always wins. Otherwise walk up from the crate dir, the
/// executable, the process cwd, and Tauri's resource dir looking for
/// `python/pyproject.toml`. That avoids `tauri dev` treating
/// `src-tauri/target/` as the repo and running `uv --project target/python`.
pub fn resolve_repo_dir(
    env: &dyn Fn(&str) -> Option<String>,
    resource_dir: Option<&Path>,
    current_dir: Option<&Path>,
    current_exe: Option<&Path>,
    cargo_manifest_dir: Option<&Path>,
) -> PathBuf {
    if let Some(dir) = env("ARBOR_REPO_DIR") {
        return PathBuf::from(dir);
    }
    let starts = [cargo_manifest_dir, current_exe, current_dir, resource_dir];
    for start in starts.into_iter().flatten() {
        let abs = absolute_start(start, current_dir);
        if let Some(repo) = find_repo_root(&abs) {
            return repo;
        }
    }
    PathBuf::from(".")
}

pub fn uv_project_missing_error(argv: &[String]) -> Option<String> {
    let project = argv
        .windows(2)
        .find(|pair| pair[0] == "--project")
        .map(|pair| pair[1].as_str())?;
    if Path::new(project).join("pyproject.toml").is_file() {
        None
    } else {
        Some(format!(
            "worker project not found at '{project}'. Set ARBOR_REPO_DIR to the Arbor repo root (the folder that contains python/)."
        ))
    }
}

pub fn worker_deadline(sub_args: &[&str]) -> Duration {
    let sub0 = sub_args.first().copied().unwrap_or("");
    match sub0 {
        "usage" => Duration::from_secs(20),
        "check-auth" => Duration::from_secs(15),
        "list-models" => Duration::from_secs(20),
        "list-providers" => Duration::from_secs(30),
        "sync" if sub_args.iter().any(|arg| *arg == "--show") => Duration::from_secs(30),
        "sync" => Duration::from_secs(120),
        "reindex" => Duration::from_secs(300),
        "skill-install" | "skill-run" => Duration::from_secs(300),
        _ => Duration::from_secs(30),
    }
}

struct WorkerSpawnLimiter {
    active: Mutex<usize>,
    cv: Condvar,
}

static WORKER_SPAWN_LIMITER: OnceLock<WorkerSpawnLimiter> = OnceLock::new();

#[cfg(test)]
static TEST_SPAWN_ACTIVE: AtomicUsize = AtomicUsize::new(0);

#[cfg(test)]
static TEST_SPAWN_HIGH_WATER: AtomicUsize = AtomicUsize::new(0);

fn worker_spawn_limiter() -> &'static WorkerSpawnLimiter {
    WORKER_SPAWN_LIMITER.get_or_init(|| WorkerSpawnLimiter {
        active: Mutex::new(0),
        cv: Condvar::new(),
    })
}

struct WorkerSpawnSlot;

impl Drop for WorkerSpawnSlot {
    fn drop(&mut self) {
        let limiter = worker_spawn_limiter();
        let mut guard = limiter
            .active
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        *guard = guard.saturating_sub(1);
        limiter.cv.notify_all();
        #[cfg(test)]
        TEST_SPAWN_ACTIVE.fetch_sub(1, Ordering::SeqCst);
    }
}

fn acquire_worker_spawn_slot() -> WorkerSpawnSlot {
    const MAX: usize = 3;
    let limiter = worker_spawn_limiter();
    let mut guard = limiter
        .active
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    while *guard >= MAX {
        guard = limiter
            .cv
            .wait(guard)
            .unwrap_or_else(|error| error.into_inner());
    }
    *guard += 1;
    #[cfg(test)]
    {
        let active = TEST_SPAWN_ACTIVE.fetch_add(1, Ordering::SeqCst) + 1;
        let mut high = TEST_SPAWN_HIGH_WATER.load(Ordering::SeqCst);
        while active > high {
            match TEST_SPAWN_HIGH_WATER.compare_exchange_weak(
                high,
                active,
                Ordering::SeqCst,
                Ordering::SeqCst,
            ) {
                Ok(_) => break,
                Err(next) => high = next,
            }
        }
    }
    drop(guard);
    WorkerSpawnSlot
}

pub(crate) fn kill_worker_tree(child: &mut std::process::Child) {
    #[cfg(unix)]
    {
        // The child leads its own process group (process_group(0) above).
        let pgid = child.id() as libc::pid_t;
        unsafe {
            libc::kill(-pgid, libc::SIGKILL);
        }
    }
    let _ = child.kill();
}

#[cfg(feature = "desktop-runtime")]
pub fn run_worker_json_with_stdin(
    app_dir: &Path,
    sub_args: &[&str],
    stdin_body: &str,
    extra_env: &[(&str, &str)],
    deadline: Duration,
) -> Result<serde_json::Value, String> {
    let _slot = acquire_worker_spawn_slot();
    let perf_start = Instant::now();
    let sub0 = sub_args.first().copied().unwrap_or("");

    let sidecar = if std::env::var("ARBOR_WORKER_NO_SIDECAR").as_deref() == Ok("1") {
        None
    } else {
        packaged_sidecar()
    };
    let argv = resolve_worker_argv(
        &|k| std::env::var(k).ok(),
        &default_python_dir(app_dir),
        sub_args,
        sidecar.as_deref(),
    );
    if let Some(err) = uv_project_missing_error(&argv) {
        return Err(err);
    }
    let mut command = Command::new(&argv[0]);
    command
        .args(&argv[1..])
        .env("PATH", process_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    crate::secrets::apply_env_pairs(&mut command, extra_env);
    let mut child = command
        .spawn()
        .map_err(|e| format!("failed to launch worker: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        if let Err(e) = stdin.write_all(stdin_body.as_bytes()) {
            kill_worker_tree(&mut child);
            let _ = child.wait();
            return Err(format!("failed to write worker stdin: {e}"));
        }
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "worker stdout unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "worker stderr unavailable".to_string())?;

    let stdout_handle = thread::spawn(move || {
        let mut buf = Vec::new();
        let mut reader = stdout;
        let _ = reader.read_to_end(&mut buf);
        buf
    });
    let stderr_handle = thread::spawn(move || {
        let mut buf = Vec::new();
        let mut reader = stderr;
        let _ = reader.read_to_end(&mut buf);
        buf
    });

    let poll = Duration::from_millis(10);
    let deadline_at = Instant::now() + deadline;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if Instant::now() >= deadline_at {
                    kill_worker_tree(&mut child);
                    let _ = child.wait();
                    drop(stdout_handle);
                    drop(stderr_handle);
                    if std::env::var("ARBOR_PERF").as_deref() == Ok("1") {
                        eprintln!(
                            "[arbor-perf] {sub0} {}ms exit=timeout",
                            perf_start.elapsed().as_millis()
                        );
                    }
                    let secs = deadline.as_secs();
                    return Err(format!("worker timed out after {secs}s: {sub0}"));
                }
                thread::sleep(poll);
            }
            Err(error) => {
                let _ = stdout_handle.join();
                let _ = stderr_handle.join();
                return Err(format!("failed waiting on worker: {error}"));
            }
        }
    };

    let stdout_bytes = stdout_handle
        .join()
        .map_err(|_| "worker stdout reader panicked".to_string())?;
    let stderr_bytes = stderr_handle
        .join()
        .map_err(|_| "worker stderr reader panicked".to_string())?;
    let exit_code = status.code();
    parse_worker_json_output(
        &String::from_utf8_lossy(&stdout_bytes),
        &String::from_utf8_lossy(&stderr_bytes),
        exit_code,
    )
}

pub fn run_worker_json_with_deadline(
    app_dir: &Path,
    sub_args: &[&str],
    extra_env: &[(&str, &str)],
    deadline: Duration,
) -> Result<serde_json::Value, String> {
    let _slot = acquire_worker_spawn_slot();
    let perf_start = Instant::now();
    let sub0 = sub_args.first().copied().unwrap_or("");

    let sidecar = if std::env::var("ARBOR_WORKER_NO_SIDECAR").as_deref() == Ok("1") {
        None
    } else {
        packaged_sidecar()
    };
    let argv = resolve_worker_argv(
        &|k| std::env::var(k).ok(),
        &default_python_dir(app_dir),
        sub_args,
        sidecar.as_deref(),
    );
    if let Some(err) = uv_project_missing_error(&argv) {
        return Err(err);
    }
    let mut command = Command::new(&argv[0]);
    command
        .args(&argv[1..])
        .env("PATH", process_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Own process group, so a timeout also kills grandchildren (uv's python,
    // the onefile bootloader's child) that would otherwise hold the pipes open.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    crate::secrets::apply_env_pairs(&mut command, extra_env);
    let mut child = command
        .spawn()
        .map_err(|e| format!("failed to launch worker: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "worker stdout unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "worker stderr unavailable".to_string())?;

    let stdout_handle = thread::spawn(move || {
        let mut buf = Vec::new();
        let mut reader = stdout;
        let _ = reader.read_to_end(&mut buf);
        buf
    });
    let stderr_handle = thread::spawn(move || {
        let mut buf = Vec::new();
        let mut reader = stderr;
        let _ = reader.read_to_end(&mut buf);
        buf
    });

    let poll = Duration::from_millis(10);
    let deadline_at = Instant::now() + deadline;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if Instant::now() >= deadline_at {
                    kill_worker_tree(&mut child);
                    let _ = child.wait();
                    // Don't join the readers: a surviving grandchild could keep
                    // the pipes open. They exit on EOF by themselves.
                    drop(stdout_handle);
                    drop(stderr_handle);
                    if std::env::var("ARBOR_PERF").as_deref() == Ok("1") {
                        eprintln!(
                            "[arbor-perf] {sub0} {}ms exit=timeout",
                            perf_start.elapsed().as_millis()
                        );
                    }
                    let secs = deadline.as_secs();
                    return Err(format!("worker timed out after {secs}s: {sub0}"));
                }
                thread::sleep(poll);
            }
            Err(error) => {
                let _ = stdout_handle.join();
                let _ = stderr_handle.join();
                return Err(format!("failed waiting on worker: {error}"));
            }
        }
    };

    let stdout_bytes = stdout_handle
        .join()
        .map_err(|_| "worker stdout reader panicked".to_string())?;
    let stderr_bytes = stderr_handle
        .join()
        .map_err(|_| "worker stderr reader panicked".to_string())?;
    let exit_code = status.code();
    let result = parse_worker_json_output(
        &String::from_utf8_lossy(&stdout_bytes),
        &String::from_utf8_lossy(&stderr_bytes),
        exit_code,
    );
    if std::env::var("ARBOR_PERF").as_deref() == Ok("1") {
        eprintln!(
            "[arbor-perf] {sub0} {}ms exit={}",
            perf_start.elapsed().as_millis(),
            exit_code.unwrap_or(-1)
        );
    }
    result
}

#[cfg(feature = "desktop-runtime")]
pub fn run_worker_json(
    app_dir: &Path,
    sub_args: &[&str],
    extra_env: &[(&str, &str)],
) -> Result<serde_json::Value, String> {
    run_worker_json_with_deadline(app_dir, sub_args, extra_env, worker_deadline(sub_args))
}

#[cfg(feature = "desktop-runtime")]
pub fn cancel_file_path() -> PathBuf {
    std::env::temp_dir().join("arbor-cancel.flag")
}

#[cfg(feature = "desktop-runtime")]
pub fn plan_file_path() -> PathBuf {
    std::env::temp_dir().join("arbor-plan.json")
}

pub fn normalize_study_model(model: Option<String>) -> Option<String> {
    model
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn effective_provider_id(provider_id: &str) -> &str {
    if provider_id.is_empty() {
        "codex"
    } else {
        provider_id
    }
}

pub fn update_sub_args(
    root: &str,
    model: &str,
    provider_id: &str,
    cancel_file: &str,
    plan_file: &str,
) -> Vec<String> {
    vec![
        "update".to_string(),
        "--root".to_string(),
        root.to_string(),
        "--provider".to_string(),
        effective_provider_id(provider_id).to_string(),
        "--model".to_string(),
        model.to_string(),
        "--cancel-file".to_string(),
        cancel_file.to_string(),
        "--plan".to_string(),
        plan_file.to_string(),
    ]
}

pub fn generate_sub_args(
    root: &str,
    course: &str,
    skill: &str,
    force: bool,
    model: Option<String>,
    provider_id: &str,
) -> Vec<String> {
    let mut sub_args = vec![
        "generate".to_string(),
        "--root".to_string(),
        root.to_string(),
        "--course".to_string(),
        course.to_string(),
        "--skill".to_string(),
        skill.to_string(),
    ];
    if force {
        sub_args.push("--force".to_string());
    }
    if let Some(model) = normalize_study_model(model) {
        sub_args.extend([
            "--provider".to_string(),
            effective_provider_id(provider_id).to_string(),
            "--model".to_string(),
            model,
        ]);
    } else {
        sub_args.extend(["--provider".to_string(), "fake".to_string()]);
    }
    sub_args
}

pub fn embed_sub_args(root: &str, force: bool) -> Vec<String> {
    let mut args = vec![
        "embed".to_string(),
        "--root".to_string(),
        root.to_string(),
        "--provider".to_string(),
        "hashed".to_string(),
    ];
    if force {
        args.push("--force".to_string());
    }
    args
}

#[cfg(feature = "desktop-runtime")]
pub fn spawn_update_stream(
    app: tauri::AppHandle,
    app_dir: PathBuf,
    root: String,
    model: String,
    provider_id: String,
    cancel_file: PathBuf,
    plan_file: PathBuf,
    job_id: String,
) {
    let cancel_str = cancel_file.to_string_lossy().into_owned();
    let plan_str = plan_file.to_string_lossy().into_owned();
    let sub_args = update_sub_args(&root, &model, &provider_id, &cancel_str, &plan_str);
    let label = crate::settings::provider_label(effective_provider_id(&provider_id));
    let settings = crate::settings::load(&app);
    let store = crate::secrets::OsSecretStore;
    let env_pairs = crate::secrets::worker_env_for_provider_id(
        effective_provider_id(&provider_id),
        &store,
        &settings,
    );
    spawn_worker_stream(
        app,
        app_dir,
        root,
        sub_args,
        job_id,
        "update",
        label,
        Some(effective_provider_id(&provider_id).to_string()),
        env_pairs,
    );
}

#[cfg(feature = "desktop-runtime")]
pub fn spawn_generate_stream(
    app: tauri::AppHandle,
    app_dir: PathBuf,
    root: String,
    course: String,
    skill: String,
    force: bool,
    model: Option<String>,
    provider_id: String,
    job_id: String,
) {
    let sub_args = generate_sub_args(&root, &course, &skill, force, model, &provider_id);
    let label = crate::settings::provider_label(effective_provider_id(&provider_id));
    let settings = crate::settings::load(&app);
    let store = crate::secrets::OsSecretStore;
    let env_pairs = crate::secrets::worker_env_for_provider_id(
        effective_provider_id(&provider_id),
        &store,
        &settings,
    );
    spawn_worker_stream(
        app,
        app_dir,
        root,
        sub_args,
        job_id,
        "generate",
        label,
        Some(effective_provider_id(&provider_id).to_string()),
        env_pairs,
    );
}

#[cfg(feature = "desktop-runtime")]
pub fn spawn_embed_stream(
    app: tauri::AppHandle,
    app_dir: PathBuf,
    root: String,
    force: bool,
    job_id: String,
) {
    let sub_args = embed_sub_args(&root, force);
    let settings = crate::settings::load(&app);
    let store = crate::secrets::OsSecretStore;
    let env_pairs = crate::secrets::worker_env_for_provider_id("hashed", &store, &settings);
    spawn_worker_stream(
        app,
        app_dir,
        root,
        sub_args,
        job_id,
        "embed",
        "Provider".to_string(),
        None,
        env_pairs,
    );
}

#[cfg(feature = "desktop-runtime")]
fn spawn_worker_stream(
    app: tauri::AppHandle,
    app_dir: PathBuf,
    root: String,
    sub_args: Vec<String>,
    job_id: String,
    operation: &'static str,
    provider_label: String,
    provider_id: Option<String>,
    env_pairs: Vec<(String, String)>,
) {
    use crate::jobs::{self, SharedCoordinator};
    use tauri::{Emitter, Manager};

    let knowledge_root = PathBuf::from(&root);
    let sub_arg_refs = sub_args.iter().map(String::as_str).collect::<Vec<_>>();
    let sidecar = packaged_sidecar();
    let argv = resolve_worker_argv(
        &|k| std::env::var(k).ok(),
        &default_python_dir(&app_dir),
        &sub_arg_refs,
        sidecar.as_deref(),
    );

    std::thread::spawn(move || {
        let release = |app: &tauri::AppHandle, job_id: &str| {
            if let Some(state) = app.try_state::<SharedCoordinator>() {
                if let Ok(mut guard) = state.lock() {
                    guard.finish(job_id);
                }
            }
        };
        if let Some(err) = uv_project_missing_error(&argv) {
            let line = serde_json::json!({ "type": "error", "message": err }).to_string();
            let _ = jobs::append_event(&knowledge_root, &job_id, &line);
            let _ = jobs::finish_job(
                &knowledge_root,
                &job_id,
                jobs::JobStatus::Failed,
                -1,
                Some(err),
            );
            let _ = app.emit("arbor://progress", serde_json::json!({ "line": line }));
            release(&app, &job_id);
            return;
        }

        let env_refs: Vec<(&str, &str)> = env_pairs
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();
        let mut command = Command::new(&argv[0]);
        command
            .args(&argv[1..])
            .env("PATH", process_path())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        crate::secrets::apply_env_pairs(&mut command, &env_refs);
        let mut child = match command.spawn()
        {
            Ok(c) => c,
            Err(e) => {
                let line =
                    format!("{{\"type\":\"error\",\"message\":\"failed to launch worker: {e}\"}}");
                let _ = jobs::append_event(&knowledge_root, &job_id, &line);
                let _ = jobs::finish_job(
                    &knowledge_root,
                    &job_id,
                    jobs::JobStatus::Failed,
                    -1,
                    Some(format!("failed to launch worker: {e}")),
                );
                let _ = app.emit("arbor://progress", serde_json::json!({ "line": line }));
                release(&app, &job_id);
                return;
            }
        };

        let mut last_line = String::new();
        let mut terminal_status = None::<jobs::JobStatus>;
        let mut terminal_summary = None::<String>;
        let mut skill_failure = None::<String>;
        if let Some(stdout) = child.stdout.take() {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                last_line = line.clone();
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                    if let Some(summary) = jobs::skill_failure_summary(&value) {
                        skill_failure = Some(summary);
                    }
                    match value.get("type").and_then(|t| t.as_str()) {
                        Some("cancelled") => terminal_status = Some(jobs::JobStatus::Cancelled),
                        Some("auth_failed") => {
                            terminal_status = Some(jobs::JobStatus::Failed);
                            terminal_summary = value
                                .get("reason")
                                .and_then(|r| r.as_str())
                                .map(str::to_string)
                                .or_else(|| {
                                    Some(format!("{provider_label} is not authenticated"))
                                });
                            if let Some(ref id) = provider_id {
                                crate::auth_cache::invalidate_auth(id);
                            }
                        }
                        Some("error") => {
                            terminal_status = Some(jobs::JobStatus::Failed);
                            terminal_summary = value
                                .get("message")
                                .and_then(|m| m.as_str())
                                .map(str::to_string);
                        }
                        _ => {}
                    }
                }
                let _ = jobs::append_event(&knowledge_root, &job_id, &line);
                let _ = app.emit("arbor://progress", serde_json::json!({ "line": line }));
            }
        }

        let code = child.wait().ok().and_then(|s| s.code()).unwrap_or(-1);
        let exit_line = format!("{{\"type\":\"worker_exit\",\"code\":{code}}}");
        let _ = jobs::append_event(&knowledge_root, &job_id, &exit_line);
        let (status, summary) = terminal_status
            .map(|s| (s, terminal_summary))
            .unwrap_or_else(|| {
                jobs::prefer_skill_failure(
                    jobs::resolve_terminal_status(&last_line, code, &provider_label),
                    code,
                    skill_failure,
                )
            });
        let _ = jobs::finish_job(&knowledge_root, &job_id, status, code, summary.clone());
        if let Some(ref id) = provider_id {
            crate::auth_cache::invalidate_if_auth_failure(summary.as_deref(), id);
        }
        let _ = app.emit("arbor://progress", serde_json::json!({ "line": exit_line }));
        release(&app, &job_id);
        let _ = app.emit(
            "arbor://job-finished",
            serde_json::json!({
                "job_id": job_id,
                "status": status.as_str(),
                "summary": summary,
                "operation": operation,
                "root": root,
            }),
        );
        notify_terminal(&app, operation, status, summary.as_deref());
    });
}

#[cfg(feature = "desktop-runtime")]
pub fn run_remote_worker_lines(
    app_data_dir: &Path,
    transport: &WorkerTransport,
    request_tokens: &[String],
    on_line: &mut dyn FnMut(&str),
) -> Result<(), String> {
    use crate::remote_job::RemoteOps;
    let endpoint = validate_ssh(transport)?;
    let mut ops = crate::remote_job::SystemRemoteOps::new(endpoint.clone(), app_data_dir)?;
    let mut tokens = endpoint.worker_tokens;
    tokens.extend_from_slice(request_tokens);
    match ops.run(&tokens, on_line, None) {
        Ok(0) => Ok(()),
        Ok(code) => Err(map_ssh_error("", code)),
        Err(stderr) => Err(map_ssh_error(&stderr, 255)),
    }
}

#[cfg(feature = "desktop-runtime")]
pub fn run_remote_check_auth(
    app: &tauri::AppHandle,
    transport: &WorkerTransport,
    provider_id: &str,
) -> Result<serde_json::Value, String> {
    use tauri::Manager;
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let mut stdout = String::new();
    run_remote_worker_lines(
        &app_data,
        transport,
        &[
            "check-auth".to_string(),
            "--provider".to_string(),
            effective_provider_id(provider_id).to_string(),
        ],
        &mut |line| stdout = line.to_string(),
    )?;
    parse_worker_json_output(&stdout, "", None)
}

#[cfg(feature = "desktop-runtime")]
fn run_local_commit_written(
    app_dir: &Path,
    knowledge_root: &Path,
    job_id: &str,
    root: &str,
    paths: &[String],
    message: &str,
    index: bool,
    app: &tauri::AppHandle,
) -> Result<(), String> {
    use crate::jobs;
    use tauri::Emitter;

    let mut sub_args = vec![
        "commit-written".to_string(),
        "--root".to_string(),
        root.to_string(),
        "--message".to_string(),
        message.to_string(),
    ];
    if index {
        sub_args.push("--index".to_string());
    }
    sub_args.push("--".to_string());
    sub_args.extend(paths.iter().cloned());
    let sub_refs: Vec<&str> = sub_args.iter().map(String::as_str).collect();
    let sidecar = packaged_sidecar();
    let argv = resolve_worker_argv(
        &|k| std::env::var(k).ok(),
        &default_python_dir(app_dir),
        &sub_refs,
        sidecar.as_deref(),
    );
    if let Some(err) = uv_project_missing_error(&argv) {
        return Err(err);
    }
    let output = Command::new(&argv[0])
        .args(&argv[1..])
        .env("PATH", process_path())
        .output()
        .map_err(|e| format!("commit-written failed: {e}"))?;
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let _ = jobs::append_event(knowledge_root, job_id, line);
        let _ = app.emit("arbor://progress", serde_json::json!({ "line": line }));
    }
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err(format!(
                "commit-written exited with {}",
                output.status.code().unwrap_or(-1)
            ))
        } else {
            Err(stderr)
        }
    }
}

#[cfg(feature = "desktop-runtime")]
fn spawn_remote_job_stream(
    app: tauri::AppHandle,
    app_dir: PathBuf,
    app_data_dir: PathBuf,
    root: String,
    job_id: String,
    operation: &'static str,
    provider_id: String,
    _provider_label: String,
    transport: WorkerTransport,
    courses: Vec<String>,
    remote_tokens: Vec<String>,
    plan_path: Option<PathBuf>,
    message: String,
    index: bool,
) {
    use crate::auth_cache;
    use crate::jobs::{self, JobStatus, SharedCoordinator};
    use crate::remote_job::{run_remote_job, RemoteJobRequest, SystemRemoteOps};
    use tauri::{Emitter, Manager};

    let auth_cache_key = auth_cache::auth_cache_key(&transport, &provider_id);
    std::thread::spawn(move || {
        let release = |app: &tauri::AppHandle, job_id: &str| {
            if let Some(state) = app.try_state::<SharedCoordinator>() {
                if let Ok(mut guard) = state.lock() {
                    guard.finish(job_id);
                }
            }
        };
        let knowledge_root = PathBuf::from(&root);
        let endpoint = match validate_ssh(&transport) {
            Ok(e) => e,
            Err(e) => {
                let _ = jobs::finish_job(
                    &knowledge_root,
                    &job_id,
                    JobStatus::Failed,
                    -1,
                    Some(e.clone()),
                );
                release(&app, &job_id);
                return;
            }
        };
        let mut ops = match SystemRemoteOps::new(endpoint.clone(), &app_data_dir) {
            Ok(o) => o,
            Err(e) => {
                let _ = jobs::finish_job(
                    &knowledge_root,
                    &job_id,
                    JobStatus::Failed,
                    -1,
                    Some(e.clone()),
                );
                release(&app, &job_id);
                return;
            }
        };
        let req = RemoteJobRequest {
            endpoint,
            local_root: knowledge_root.clone(),
            courses,
            remote_tokens,
            plan_file: plan_path,
            message,
            index,
            cancel_after_first_line: false,
        };
        let app_commit = app.clone();
        let app_dir_commit = app_dir.clone();
        let job_id_commit = job_id.clone();
        let root_commit = root.clone();
        let emit_app = app.clone();
        let emit_root = knowledge_root.clone();
        let emit_job = job_id.clone();
        let auth_key = auth_cache_key.clone();
        let mut emit_line = move |line: &str| {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(line) {
                if value.get("type").and_then(|t| t.as_str()) == Some("auth_failed") {
                    auth_cache::invalidate_auth_cache_key(&auth_key);
                }
            }
            let _ = jobs::append_event(&emit_root, &emit_job, line);
            let _ = emit_app.emit("arbor://progress", serde_json::json!({ "line": line }));
        };
        let outcome = run_remote_job(
            &mut ops,
            &req,
            &mut |paths, msg, idx| {
                run_local_commit_written(
                    &app_dir_commit,
                    &knowledge_root,
                    &job_id_commit,
                    &root_commit,
                    paths,
                    msg,
                    idx,
                    &app_commit,
                )
            },
            Some(&mut emit_line),
        );

        let (status, summary) = if outcome.killed {
            (JobStatus::Cancelled, None)
        } else if let Some(err) = outcome.error {
            (JobStatus::Failed, Some(err))
        } else {
            (JobStatus::Succeeded, None)
        };
        let code = if status == JobStatus::Failed {
            -1
        } else {
            0
        };
        let _ = jobs::finish_job(&knowledge_root, &job_id, status, code, summary.clone());
        auth_cache::invalidate_if_auth_failure_for_key(summary.as_deref(), &auth_cache_key);
        release(&app, &job_id);
        let _ = app.emit(
            "arbor://job-finished",
            serde_json::json!({
                "job_id": job_id,
                "status": status.as_str(),
                "summary": summary,
                "operation": operation,
                "root": root,
            }),
        );
        notify_terminal(&app, operation, status, summary.as_deref());
    });
}

#[cfg(feature = "desktop-runtime")]
pub fn spawn_remote_update_stream(
    app: tauri::AppHandle,
    app_dir: PathBuf,
    app_data_dir: PathBuf,
    root: String,
    provider_id: String,
    job_id: String,
    transport: WorkerTransport,
    courses: Vec<String>,
    remote_tokens: Vec<String>,
    plan_path: PathBuf,
    message: String,
) {
    let effective = effective_provider_id(&provider_id);
    let label = crate::settings::provider_label(effective);
    spawn_remote_job_stream(
        app,
        app_dir,
        app_data_dir,
        root,
        job_id,
        "update",
        effective.to_string(),
        label,
        transport,
        courses,
        remote_tokens,
        Some(plan_path),
        message,
        true,
    );
}

#[cfg(feature = "desktop-runtime")]
pub fn spawn_remote_generate_stream(
    app: tauri::AppHandle,
    app_dir: PathBuf,
    app_data_dir: PathBuf,
    root: String,
    provider_id: String,
    job_id: String,
    transport: WorkerTransport,
    course: String,
    skill: String,
    remote_tokens: Vec<String>,
) {
    let effective = effective_provider_id(&provider_id);
    let label = crate::settings::provider_label(effective);
    let message = format!("study: {course} {skill}");
    spawn_remote_job_stream(
        app,
        app_dir,
        app_data_dir,
        root,
        job_id,
        "generate",
        effective.to_string(),
        label,
        transport,
        vec![course],
        remote_tokens,
        None,
        message,
        false,
    );
}

#[cfg(feature = "desktop-runtime")]
fn notify_terminal(
    app: &tauri::AppHandle,
    operation: &str,
    status: crate::jobs::JobStatus,
    summary: Option<&str>,
) {
    use tauri_plugin_notification::NotificationExt;
    let title = match status {
        crate::jobs::JobStatus::Succeeded => format!("Arbor {operation} finished"),
        crate::jobs::JobStatus::Cancelled => format!("Arbor {operation} cancelled"),
        crate::jobs::JobStatus::Failed => format!("Arbor {operation} failed"),
        _ => format!("Arbor {operation}"),
    };
    let body = summary.unwrap_or(status.as_str());
    let _ = app.notification().builder().title(title).body(body).show();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_env(_: &str) -> Option<String> {
        None
    }

    #[test]
    fn default_uses_uv_run() {
        let argv = resolve_worker_argv(&no_env, "/repo/python", &["check-auth"], None);
        assert_eq!(
            argv,
            vec![
                "uv",
                "run",
                "--project",
                "/repo/python",
                "arbor-worker",
                "check-auth"
            ]
        );
    }

    #[test]
    fn env_override_splits_and_appends() {
        let env = |k: &str| {
            if k == "ARBOR_WORKER_CMD" {
                Some("arbor-worker".to_string())
            } else {
                None
            }
        };
        let argv = resolve_worker_argv(&env, "/repo/python", &["update", "--root", "/k"], None);
        assert_eq!(argv, vec!["arbor-worker", "update", "--root", "/k"]);
    }

    #[test]
    fn python_dir_env_override() {
        let env = |k: &str| {
            if k == "ARBOR_PYTHON_DIR" {
                Some("/custom/py".to_string())
            } else {
                None
            }
        };
        let argv = resolve_worker_argv(&env, "/repo/python", &["list-models"], None);
        assert_eq!(argv[3], "/custom/py");
    }

    #[test]
    fn sidecar_path_used_when_file_exists() {
        let path = std::env::temp_dir().join("arbor-worker-sidecar-test");
        std::fs::write(&path, b"x").unwrap();
        let argv = resolve_worker_argv(&no_env, "/repo/python", &["check-auth"], Some(&path));
        assert_eq!(argv[0], path.to_string_lossy());
        assert_eq!(argv[1], "check-auth");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn sidecar_wins_over_env_override() {
        let path = std::env::temp_dir().join("arbor-worker-sidecar-wins");
        std::fs::write(&path, b"x").unwrap();
        let env = |k: &str| {
            if k == "ARBOR_WORKER_CMD" {
                Some("arbor-worker".to_string())
            } else {
                None
            }
        };
        let argv = resolve_worker_argv(&env, "/repo/python", &["check-auth"], Some(&path));
        assert_eq!(argv[0], path.to_string_lossy());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn missing_sidecar_falls_back_to_uv() {
        let missing = PathBuf::from("/no/such/arbor-worker-sidecar");
        let argv = resolve_worker_argv(&no_env, "/repo/python", &["check-auth"], Some(&missing));
        assert_eq!(
            argv,
            vec![
                "uv",
                "run",
                "--project",
                "/repo/python",
                "arbor-worker",
                "check-auth"
            ]
        );
    }

    #[test]
    fn generate_args_use_fake_without_a_model() {
        let args = generate_sub_args("/knowledge", "Biology", "flashcards", false, None, "grok");
        assert!(args.ends_with(&["--provider".into(), "fake".into()]));
        assert!(!args.contains(&"--model".to_string()));
    }

    #[test]
    fn generate_args_use_codex_and_model_when_selected() {
        let args = generate_sub_args(
            "/knowledge",
            "Biology",
            "flashcards",
            true,
            Some("gpt-5.6-sol".into()),
            "codex",
        );
        assert!(args.contains(&"--force".to_string()));
        assert!(args.ends_with(&[
            "--provider".into(),
            "codex".into(),
            "--model".into(),
            "gpt-5.6-sol".into(),
        ]));
    }

    #[test]
    fn generate_args_treat_an_empty_model_as_fake() {
        let args = generate_sub_args(
            "/knowledge",
            "Biology",
            "flashcards",
            false,
            Some("  ".into()),
            "grok",
        );
        assert!(args.ends_with(&["--provider".into(), "fake".into()]));
    }

    #[test]
    fn generate_args_use_grok_and_model_when_selected() {
        let args = generate_sub_args(
            "/knowledge",
            "Biology",
            "flashcards",
            false,
            Some("grok-4.7".into()),
            "grok",
        );
        assert!(args.ends_with(&[
            "--provider".into(),
            "grok".into(),
            "--model".into(),
            "grok-4.7".into(),
        ]));
    }

    #[test]
    fn update_sub_args_includes_grok_provider() {
        let args = update_sub_args("/k", "grok-4.7", "grok", "/cancel", "/plan");
        assert!(args.contains(&"--provider".to_string()));
        assert!(args.contains(&"grok".to_string()));
        assert!(!args.contains(&"codex".to_string()));
        assert!(args.contains(&"--model".to_string()));
        assert!(args.contains(&"grok-4.7".to_string()));
    }

    #[test]
    fn embed_args_use_the_hashed_provider() {
        assert_eq!(
            embed_sub_args("/Knowledge", false),
            vec!["embed", "--root", "/Knowledge", "--provider", "hashed",]
        );
    }

    #[test]
    fn forced_embed_args_include_force() {
        assert_eq!(
            embed_sub_args("/Knowledge", true),
            vec![
                "embed",
                "--root",
                "/Knowledge",
                "--provider",
                "hashed",
                "--force",
            ]
        );
    }

    #[test]
    fn parse_worker_json_uses_the_last_json_line() {
        let value = parse_worker_json_output(
            "warning: downloading\n{\"authenticated\":false,\"reason\":\"not found\"}\nerror: exit 1\n",
            "",
            None,
        )
        .unwrap();
        assert_eq!(value["authenticated"], false);
        assert_eq!(value["reason"], "not found");
    }

    #[test]
    fn parse_worker_json_reports_stderr_when_stdout_is_empty() {
        let err = parse_worker_json_output("", "failed to launch uv", None).unwrap_err();
        assert!(err.contains("failed to launch uv"));
    }

    #[test]
    fn parse_worker_json_startup_failure_includes_exit_and_stderr() {
        let err = parse_worker_json_output("", "Python shared library load failed", Some(255))
            .unwrap_err();
        assert!(err.contains("worker failed to start (exit 255)"));
        assert!(err.contains("Python shared library load failed"));
    }

    #[test]
    fn parse_worker_json_startup_tail_does_not_split_a_char() {
        let stderr = format!("{}{}", "é", "a".repeat(599));
        assert_eq!(stderr.len(), 601);
        assert!(!stderr.is_char_boundary(1));
        let err = parse_worker_json_output("", &stderr, Some(255)).unwrap_err();
        assert!(err.contains("worker failed to start (exit 255)"));
        assert!(err.contains('é') || err.contains('a'));
    }

    #[test]
    fn augmented_path_puts_homebrew_ahead_of_usr_bin() {
        let path = augmented_path_from(Some("/Users/ada"), None, Some("/usr/bin:/bin"));
        let text = path.to_string_lossy();
        let brew = text.find("/opt/homebrew/bin").expect("homebrew");
        let usr = text.find("/usr/bin").expect("usr");
        assert!(brew < usr);
        assert!(text.contains("/Users/ada/.local/bin"));
    }

    #[test]
    fn augmented_path_prefers_login_shell_and_dedupes() {
        let path = augmented_path_from(
            Some("/Users/ada"),
            Some("/custom/bin:/opt/homebrew/bin"),
            Some("/usr/bin:/custom/bin"),
        );
        let binding = path.to_string_lossy();
        let parts: Vec<&str> = binding.split(':').collect();
        assert_eq!(parts[0], "/custom/bin");
        assert_eq!(parts.iter().filter(|p| **p == "/custom/bin").count(), 1);
        let brew = parts.iter().position(|p| *p == "/opt/homebrew/bin").unwrap();
        let usr = parts.iter().position(|p| *p == "/usr/bin").unwrap();
        assert!(brew < usr);
    }

    #[test]
    fn augmented_path_handles_empty_optional_inputs() {
        let path = augmented_path_from(None, None, None);
        let text = path.to_string_lossy();
        assert!(text.contains("/opt/homebrew/bin"));
        assert!(text.contains("/usr/local/bin"));
    }

    #[test]
    fn extract_login_shell_path_parses_markers() {
        assert_eq!(
            extract_login_shell_path("noise __ARBOR_PATH__/a:/b__ARBOR_PATH__ tail"),
            Some("/a:/b".to_string())
        );
        assert_eq!(extract_login_shell_path("__ARBOR_PATH____ARBOR_PATH__"), None);
    }

    #[test]
    fn sidecar_candidates_prefers_onedir_layout() {
        let root = unique_dir("arbor-sidecar-layout");
        let macos = root.join("Contents/MacOS");
        let resources = root.join("Contents/Resources/arbor-worker");
        std::fs::create_dir_all(&macos).unwrap();
        std::fs::create_dir_all(&resources).unwrap();
        let onedir_worker = resources.join("arbor-worker");
        std::fs::write(&onedir_worker, b"x").unwrap();
        let onefile = macos.join("arbor-worker-x86_64-apple-darwin");
        std::fs::write(&onefile, b"y").unwrap();

        let candidates = sidecar_candidates(macos.as_path());
        assert_eq!(
            first_existing_sidecar(&candidates),
            Some(onedir_worker.canonicalize().unwrap())
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn sidecar_candidates_falls_back_to_onefile_in_exe_dir() {
        let dir = unique_dir("arbor-sidecar-onefile");
        let triple = dir.join("arbor-worker-aarch64-unknown-linux-gnu");
        std::fs::write(&triple, b"x").unwrap();
        let candidates = sidecar_candidates(dir.as_path());
        assert_eq!(
            first_existing_sidecar(&candidates),
            Some(triple.canonicalize().unwrap())
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn sidecar_candidates_linux_onedir_next_to_exe() {
        let dir = unique_dir("arbor-sidecar-linux-onedir");
        let nested = dir.join("arbor-worker");
        std::fs::create_dir_all(&nested).unwrap();
        let worker = nested.join("arbor-worker");
        std::fs::write(&worker, b"x").unwrap();
        let candidates = sidecar_candidates(dir.as_path());
        assert_eq!(
            first_existing_sidecar(&candidates),
            Some(worker.canonicalize().unwrap())
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn sidecar_in_dir_finds_triple_suffixed_binary() {
        let dir = std::env::temp_dir().join(format!(
            "arbor-sidecar-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let triple = dir.join("arbor-worker-aarch64-apple-darwin");
        std::fs::write(&triple, b"x").unwrap();
        assert_eq!(sidecar_path_in(&dir).as_deref(), Some(triple.as_path()));
        let plain = dir.join("arbor-worker");
        std::fs::write(&plain, b"x").unwrap();
        assert_eq!(sidecar_path_in(&dir).as_deref(), Some(plain.as_path()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn unique_dir(prefix: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "{prefix}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn fake_arbor_layout() -> PathBuf {
        let repo = unique_dir("arbor-repo");
        std::fs::create_dir_all(repo.join("python")).unwrap();
        std::fs::write(
            repo.join("python/pyproject.toml"),
            "[project]\nname = \"arbor-worker\"\n",
        )
        .unwrap();
        std::fs::create_dir_all(repo.join("desktop/src-tauri/target/debug")).unwrap();
        repo
    }

    #[test]
    fn tauri_dev_does_not_resolve_python_under_target() {
        let repo = fake_arbor_layout();
        let src_tauri = repo.join("desktop/src-tauri");
        let resource_dir = src_tauri.join("target/debug");
        let exe = resource_dir.join("arbor");

        // The previous fallback used resource_dir.parent(), which is `target`
        // and produced `uv --project target/python`.
        assert_eq!(
            default_python_dir(resource_dir.parent().unwrap()),
            resource_dir
                .parent()
                .unwrap()
                .join("python")
                .to_string_lossy()
        );

        let resolved = resolve_repo_dir(
            &no_env,
            Some(resource_dir.as_path()),
            Some(src_tauri.as_path()),
            Some(exe.as_path()),
            Some(src_tauri.as_path()),
        );
        assert_eq!(resolved, repo);
        assert_eq!(
            default_python_dir(&resolved),
            repo.join("python").to_string_lossy()
        );
        let _ = std::fs::remove_dir_all(&repo);
    }

    #[test]
    fn relative_resource_dir_still_finds_repo_via_cwd() {
        let repo = fake_arbor_layout();
        let src_tauri = repo.join("desktop/src-tauri");
        let resolved = resolve_repo_dir(
            &no_env,
            Some(Path::new("target/debug")),
            Some(src_tauri.as_path()),
            None,
            None,
        );
        assert_eq!(resolved, repo);
        assert_eq!(
            default_python_dir(&PathBuf::from("target")),
            "target/python"
        );
        let _ = std::fs::remove_dir_all(&repo);
    }

    #[test]
    fn arbor_repo_dir_env_wins_over_walk() {
        let repo = fake_arbor_layout();
        let other = unique_dir("arbor-other");
        let env = |k: &str| {
            if k == "ARBOR_REPO_DIR" {
                Some(other.to_string_lossy().into_owned())
            } else {
                None
            }
        };
        let resource = repo.join("desktop/src-tauri/target/debug");
        let src_tauri = repo.join("desktop/src-tauri");
        let resolved = resolve_repo_dir(
            &env,
            Some(resource.as_path()),
            Some(src_tauri.as_path()),
            None,
            Some(src_tauri.as_path()),
        );
        assert_eq!(resolved, other);
        let _ = std::fs::remove_dir_all(&repo);
        let _ = std::fs::remove_dir_all(&other);
    }

    #[test]
    fn resolve_repo_dir_returns_dot_when_nothing_matches() {
        let isolated = unique_dir("arbor-empty");
        let exe = isolated.join("bin/app");
        let resolved = resolve_repo_dir(
            &no_env,
            Some(isolated.as_path()),
            Some(isolated.as_path()),
            Some(exe.as_path()),
            Some(isolated.as_path()),
        );
        assert_eq!(resolved, PathBuf::from("."));
        let _ = std::fs::remove_dir_all(&isolated);
    }

    #[test]
    fn uv_project_missing_error_names_arbor_repo_dir() {
        let argv = vec![
            "uv".into(),
            "run".into(),
            "--project".into(),
            "target/python".into(),
            "arbor-worker".into(),
            "list-models".into(),
        ];
        let err = uv_project_missing_error(&argv).expect("missing project");
        assert!(err.contains("target/python"));
        assert!(err.contains("ARBOR_REPO_DIR"));
    }

    #[test]
    fn uv_project_missing_error_silent_when_pyproject_exists() {
        let repo = fake_arbor_layout();
        let python = repo.join("python").to_string_lossy().into_owned();
        let argv = vec![
            "uv".into(),
            "run".into(),
            "--project".into(),
            python,
            "arbor-worker".into(),
            "list-models".into(),
        ];
        assert_eq!(uv_project_missing_error(&argv), None);
        let _ = std::fs::remove_dir_all(&repo);
    }

    #[test]
    fn worker_deadline_mapping() {
        assert_eq!(worker_deadline(&["check-auth"]), Duration::from_secs(15));
        assert_eq!(worker_deadline(&["list-models"]), Duration::from_secs(20));
        assert_eq!(worker_deadline(&["list-providers"]), Duration::from_secs(30));
        assert_eq!(
            worker_deadline(&["sync", "--root", "/k", "--show"]),
            Duration::from_secs(30)
        );
        assert_eq!(
            worker_deadline(&["sync", "--root", "/k"]),
            Duration::from_secs(120)
        );
        assert_eq!(worker_deadline(&["reindex"]), Duration::from_secs(300));
        assert_eq!(
            worker_deadline(&["skill-install"]),
            Duration::from_secs(300)
        );
        assert_eq!(worker_deadline(&["library-show"]), Duration::from_secs(30));
    }

    #[cfg(unix)]
    fn fake_worker_script(name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;

        let path = std::env::temp_dir().join(format!("arbor-fake-worker-{name}-{}", std::process::id()));
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[cfg(unix)]
    #[test]
    fn run_worker_json_times_out_and_kills_slow_child() {
        let _guard = crate::worker::WORKER_ENV_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let start = Instant::now();
        let script = fake_worker_script("slow", "exec sleep 30");
        std::env::set_var("ARBOR_WORKER_CMD", script.to_string_lossy().as_ref());
        std::env::set_var("ARBOR_WORKER_NO_SIDECAR", "1");
        let err = run_worker_json_with_deadline(
            Path::new("/tmp"),
            &["probe"],
            &[],
            Duration::from_secs(1),
        )
        .unwrap_err();
        std::env::remove_var("ARBOR_WORKER_CMD");
        std::env::remove_var("ARBOR_WORKER_NO_SIDECAR");
        let _ = std::fs::remove_file(script);
        assert!(err.contains("worker timed out after 1s"));
        assert!(start.elapsed() < Duration::from_secs(3));
    }

    #[cfg(unix)]
    #[test]
    fn run_worker_json_timeout_kills_grandchild_holding_pipes() {
        let _guard = crate::worker::WORKER_ENV_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let start = Instant::now();
        // The shell forks a grandchild that inherits stdout, then waits on it.
        let script = fake_worker_script("grandchild", "sleep 30 &\nwait");
        std::env::set_var("ARBOR_WORKER_CMD", script.to_string_lossy().as_ref());
        std::env::set_var("ARBOR_WORKER_NO_SIDECAR", "1");
        let err = run_worker_json_with_deadline(
            Path::new("/tmp"),
            &["probe"],
            &[],
            Duration::from_secs(1),
        )
        .unwrap_err();
        std::env::remove_var("ARBOR_WORKER_CMD");
        std::env::remove_var("ARBOR_WORKER_NO_SIDECAR");
        let _ = std::fs::remove_file(script);
        assert!(err.contains("worker timed out after 1s"));
        assert!(start.elapsed() < Duration::from_secs(3));
    }

    #[cfg(unix)]
    #[test]
    fn run_worker_json_parses_json_from_fake_worker() {
        let _guard = crate::worker::WORKER_ENV_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let script = fake_worker_script("json", "echo '{\"ok\":true}'");
        std::env::set_var("ARBOR_WORKER_CMD", script.to_string_lossy().as_ref());
        std::env::set_var("ARBOR_WORKER_NO_SIDECAR", "1");
        let value = run_worker_json_with_deadline(
            Path::new("/tmp"),
            &["probe"],
            &[],
            Duration::from_secs(5),
        )
        .expect("json");
        std::env::remove_var("ARBOR_WORKER_CMD");
        std::env::remove_var("ARBOR_WORKER_NO_SIDECAR");
        let _ = std::fs::remove_file(script);
        assert_eq!(value["ok"], true);
    }

    #[cfg(unix)]
    #[test]
    fn run_worker_json_limits_concurrent_spawns() {
        let _guard = crate::worker::WORKER_ENV_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        TEST_SPAWN_HIGH_WATER.store(0, Ordering::SeqCst);
        let script = fake_worker_script("sleep-json", "sleep 2; echo '{\"ok\":true}'");
        std::env::set_var("ARBOR_WORKER_CMD", script.to_string_lossy().as_ref());
        std::env::set_var("ARBOR_WORKER_NO_SIDECAR", "1");
        let app_dir = Path::new("/tmp");
        let handles: Vec<_> = (0..5)
            .map(|_| {
                thread::spawn(move || {
                    run_worker_json_with_deadline(
                        app_dir,
                        &["probe"],
                        &[],
                        Duration::from_secs(30),
                    )
                })
            })
            .collect();
        for handle in handles {
            handle.join().expect("thread").expect("worker");
        }
        std::env::remove_var("ARBOR_WORKER_CMD");
        std::env::remove_var("ARBOR_WORKER_NO_SIDECAR");
        let _ = std::fs::remove_file(script);
        assert!(
            TEST_SPAWN_HIGH_WATER.load(Ordering::SeqCst) <= 3,
            "high water {}",
            TEST_SPAWN_HIGH_WATER.load(Ordering::SeqCst)
        );
    }
}
