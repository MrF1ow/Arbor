use crate::settings::{self, Settings};
use crate::worker;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

fn repo_dir(app: &tauri::AppHandle) -> PathBuf {
    // Dev: resolve the repo root as the current working directory's parent of `desktop`.
    // ARBOR_PYTHON_DIR / ARBOR_WORKER_CMD override this entirely in resolve_worker_argv.
    std::env::var("ARBOR_REPO_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            app.path()
                .resource_dir()
                .ok()
                .and_then(|d| d.parent().map(|p| p.to_path_buf()))
                .unwrap_or_else(|| PathBuf::from("."))
        })
}

#[tauri::command]
pub fn check_auth(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    worker::run_worker_json(&repo_dir(&app), &["check-auth"])
}

#[tauri::command]
pub fn list_models(app: tauri::AppHandle, root: Option<String>) -> Result<serde_json::Value, String> {
    let mut args: Vec<&str> = vec!["list-models"];
    if let Some(r) = root.as_deref() {
        args.push("--root");
        args.push(r);
    }
    worker::run_worker_json(&repo_dir(&app), &args)
}

#[tauri::command]
pub fn plan_update(app: tauri::AppHandle, root: String) -> Result<serde_json::Value, String> {
    worker::run_worker_json(&repo_dir(&app), &["plan-update", "--root", &root])
}

#[derive(serde::Deserialize, serde::Serialize, Clone)]
pub struct Selection {
    pub path: String,
    pub ranges: Option<Vec<[u32; 2]>>,
}

#[tauri::command]
pub fn get_settings(app: tauri::AppHandle) -> Settings {
    settings::load(&app)
}

#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    settings::save(&app, &settings)
}

#[tauri::command]
pub fn start_update(
    app: tauri::AppHandle,
    root: String,
    model: String,
    selections: Vec<Selection>,
) -> Result<(), String> {
    let auth = worker::run_worker_json(&repo_dir(&app), &["check-auth"])?;
    let authenticated = auth
        .get("authenticated")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !authenticated {
        let reason = auth
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("Codex CLI is not authenticated");
        return Err(reason.to_string());
    }

    let cancel = worker::cancel_file_path();
    let _ = std::fs::remove_file(&cancel); // clear stale cancel

    let plan_path = worker::plan_file_path();
    let body = serde_json::json!({ "selections": selections });
    std::fs::write(
        &plan_path,
        serde_json::to_vec(&body).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let app_dir = repo_dir(&app);
    worker::spawn_update_stream(app, app_dir, root, model, cancel, plan_path);
    Ok(())
}

#[tauri::command]
pub fn cancel_update(_app: tauri::AppHandle) -> Result<(), String> {
    let cancel = worker::cancel_file_path();
    std::fs::write(&cancel, b"stop").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "linux")]
    let program = "xdg-open";
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    return Err("open_folder not supported on this platform".into());

    Command::new(program)
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn init_knowledge_repo(path: String) -> Result<bool, String> {
    let root = Path::new(&path);
    if !root.is_dir() {
        return Err(format!("Not a folder: {path}"));
    }
    if root.join(".git").exists() {
        return Ok(false);
    }
    let run = |args: &[&str]| -> Result<(), String> {
        let out = Command::new("git")
            .arg("-C")
            .arg(&path)
            .args(args)
            .output()
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    };
    run(&["init"])?;
    run(&["commit", "--allow-empty", "-m", "Initialize Arbor knowledge library"])?;
    Ok(true)
}
