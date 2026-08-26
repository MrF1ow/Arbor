use std::ffi::OsString;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub fn parse_worker_json_output(stdout: &str, stderr: &str) -> Result<serde_json::Value, String> {
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
    Err(format!("worker produced no output (stderr: {stderr})"))
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

pub fn augmented_path_from(home: Option<&str>, current: Option<&str>) -> OsString {
    let mut parts: Vec<OsString> = Vec::new();
    if let Some(home) = home {
        parts.push(Path::new(home).join(".local/bin").into_os_string());
    }
    parts.push(OsString::from("/opt/homebrew/bin"));
    parts.push(OsString::from("/usr/local/bin"));
    if let Some(current) = current.filter(|path| !path.is_empty()) {
        parts.push(OsString::from(current));
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

fn process_path() -> OsString {
    augmented_path_from(
        std::env::var("HOME").ok().as_deref(),
        std::env::var("PATH").ok().as_deref(),
    )
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
    sidecar_path_in(exe.parent()?)
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

#[cfg(feature = "desktop-runtime")]
pub fn run_worker_json(app_dir: &Path, sub_args: &[&str]) -> Result<serde_json::Value, String> {
    use std::process::Command;

    let sidecar = packaged_sidecar();
    let argv = resolve_worker_argv(
        &|k| std::env::var(k).ok(),
        &default_python_dir(app_dir),
        sub_args,
        sidecar.as_deref(),
    );
    if let Some(err) = uv_project_missing_error(&argv) {
        return Err(err);
    }
    let output = Command::new(&argv[0])
        .args(&argv[1..])
        .env("PATH", process_path())
        .output()
        .map_err(|e| format!("failed to launch worker: {e}"))?;
    parse_worker_json_output(
        &String::from_utf8_lossy(&output.stdout),
        &String::from_utf8_lossy(&output.stderr),
    )
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

pub fn generate_sub_args(
    root: &str,
    course: &str,
    skill: &str,
    force: bool,
    model: Option<String>,
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
            "codex".to_string(),
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
    cancel_file: PathBuf,
    plan_file: PathBuf,
    job_id: String,
) {
    let cancel_str = cancel_file.to_string_lossy().into_owned();
    let plan_str = plan_file.to_string_lossy().into_owned();
    let sub_args = vec![
        "update".to_string(),
        "--root".to_string(),
        root.clone(),
        "--model".to_string(),
        model,
        "--cancel-file".to_string(),
        cancel_str,
        "--plan".to_string(),
        plan_str,
    ];
    spawn_worker_stream(app, app_dir, root, sub_args, job_id, "update");
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
    job_id: String,
) {
    let sub_args = generate_sub_args(&root, &course, &skill, force, model);
    spawn_worker_stream(app, app_dir, root, sub_args, job_id, "generate");
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
    spawn_worker_stream(app, app_dir, root, sub_args, job_id, "embed");
}

#[cfg(feature = "desktop-runtime")]
fn spawn_worker_stream(
    app: tauri::AppHandle,
    app_dir: PathBuf,
    root: String,
    sub_args: Vec<String>,
    job_id: String,
    operation: &'static str,
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

        let mut child = match Command::new(&argv[0])
            .args(&argv[1..])
            .env("PATH", process_path())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
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
        if let Some(stdout) = child.stdout.take() {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                last_line = line.clone();
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                    match value.get("type").and_then(|t| t.as_str()) {
                        Some("cancelled") => terminal_status = Some(jobs::JobStatus::Cancelled),
                        Some("auth_failed") => {
                            terminal_status = Some(jobs::JobStatus::Failed);
                            terminal_summary = value
                                .get("reason")
                                .and_then(|r| r.as_str())
                                .map(str::to_string);
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
            .unwrap_or_else(|| jobs::resolve_terminal_status(&last_line, code));
        let _ = jobs::finish_job(&knowledge_root, &job_id, status, code, summary.clone());
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
        let args = generate_sub_args("/knowledge", "Biology", "flashcards", false, None);
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
        );
        assert!(args.ends_with(&["--provider".into(), "fake".into()]));
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
        )
        .unwrap();
        assert_eq!(value["authenticated"], false);
        assert_eq!(value["reason"], "not found");
    }

    #[test]
    fn parse_worker_json_reports_stderr_when_stdout_is_empty() {
        let err = parse_worker_json_output("", "failed to launch uv").unwrap_err();
        assert!(err.contains("failed to launch uv"));
    }

    #[test]
    fn augmented_path_puts_homebrew_ahead_of_usr_bin() {
        let path = augmented_path_from(Some("/Users/ada"), Some("/usr/bin:/bin"));
        let text = path.to_string_lossy();
        let brew = text.find("/opt/homebrew/bin").expect("homebrew");
        let usr = text.find("/usr/bin").expect("usr");
        assert!(brew < usr);
        assert!(text.contains("/Users/ada/.local/bin"));
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
}
