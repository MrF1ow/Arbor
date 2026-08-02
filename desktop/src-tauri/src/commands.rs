use crate::settings::{self, Settings};
use crate::worker;
use std::path::PathBuf;
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
pub fn get_settings(app: tauri::AppHandle) -> Settings {
    settings::load(&app)
}

#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    settings::save(&app, &settings)
}

// Stubs for Tasks 5–7; replaced in follow-up tasks.
#[tauri::command]
pub fn start_update(
    _app: tauri::AppHandle,
    _root: String,
    _model: String,
) -> Result<(), String> {
    Err("start_update not implemented".into())
}

#[tauri::command]
pub fn cancel_update(_app: tauri::AppHandle) -> Result<(), String> {
    Err("cancel_update not implemented".into())
}

#[tauri::command]
pub fn open_folder(_path: String) -> Result<(), String> {
    Err("open_folder not implemented".into())
}

#[tauri::command]
pub fn init_knowledge_repo(_path: String) -> Result<bool, String> {
    Err("init_knowledge_repo not implemented".into())
}
