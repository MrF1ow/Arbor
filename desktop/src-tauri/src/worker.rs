use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub fn resolve_worker_argv(
    env: &dyn Fn(&str) -> Option<String>,
    default_python_dir: &str,
    sub_args: &[&str],
) -> Vec<String> {
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

#[allow(dead_code)]
pub fn default_python_dir(app_dir: &Path) -> String {
    // Dev assumption: the repo's `python/` dir sits next to `desktop/`.
    app_dir.join("python").to_string_lossy().to_string()
}

#[cfg(feature = "desktop-runtime")]
pub fn run_worker_json(app_dir: &Path, sub_args: &[&str]) -> Result<serde_json::Value, String> {
    use std::process::Command;

    let argv = resolve_worker_argv(&|k| std::env::var(k).ok(), &default_python_dir(app_dir), sub_args);
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

#[cfg(feature = "desktop-runtime")]
pub fn spawn_update_stream(
    app: tauri::AppHandle,
    app_dir: PathBuf,
    root: String,
    model: String,
    cancel_file: PathBuf,
    plan_file: PathBuf,
) {
    use tauri::Emitter;

    let cancel_str = cancel_file.to_string_lossy().to_string();
    let plan_str = plan_file.to_string_lossy().to_string();
    let sub_args = [
        "update",
        "--root", &root,
        "--model", &model,
        "--cancel-file", &cancel_str,
        "--plan", &plan_str,
    ];
    let argv = resolve_worker_argv(&|k| std::env::var(k).ok(), &default_python_dir(&app_dir), &sub_args);

    std::thread::spawn(move || {
        let mut child = match Command::new(&argv[0])
            .args(&argv[1..])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                let _ = app.emit(
                    "arbor://progress",
                    serde_json::json!({ "line": format!("{{\"type\":\"error\",\"message\":\"failed to launch worker: {e}\"}}") }),
                );
                return;
            }
        };

        if let Some(stdout) = child.stdout.take() {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                let _ = app.emit("arbor://progress", serde_json::json!({ "line": line }));
            }
        }

        let code = child.wait().ok().and_then(|s| s.code()).unwrap_or(-1);
        let _ = app.emit(
            "arbor://progress",
            serde_json::json!({ "line": format!("{{\"type\":\"worker_exit\",\"code\":{code}}}") }),
        );
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_env(_: &str) -> Option<String> {
        None
    }

    #[test]
    fn default_uses_uv_run() {
        let argv = resolve_worker_argv(&no_env, "/repo/python", &["check-auth"]);
        assert_eq!(
            argv,
            vec!["uv", "run", "--project", "/repo/python", "arbor-worker", "check-auth"]
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
        let argv = resolve_worker_argv(&env, "/repo/python", &["update", "--root", "/k"]);
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
        let argv = resolve_worker_argv(&env, "/repo/python", &["list-models"]);
        assert_eq!(argv[3], "/custom/py");
    }
}
