use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

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
    let candidate = exe.parent()?.join("arbor-worker");
    candidate.is_file().then_some(candidate)
}

#[allow(dead_code)]
pub fn default_python_dir(app_dir: &Path) -> String {
    // Dev assumption: the repo's `python/` dir sits next to `desktop/`.
    app_dir.join("python").to_string_lossy().to_string()
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
    let output = Command::new(&argv[0])
        .args(&argv[1..])
        .output()
        .map_err(|e| format!("failed to launch worker: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let last = stdout
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .ok_or_else(|| {
            format!(
                "worker produced no output (stderr: {})",
                String::from_utf8_lossy(&output.stderr)
            )
        })?;
    serde_json::from_str(last).map_err(|e| format!("invalid worker json: {e}: {last}"))
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

        let mut child = match Command::new(&argv[0])
            .args(&argv[1..])
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
        let _ = app.emit(
            "arbor://job-finished",
            serde_json::json!({ "job_id": job_id, "status": status.as_str(), "summary": summary }),
        );
        notify_terminal(&app, operation, status, summary.as_deref());
        release(&app, &job_id);
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
}
