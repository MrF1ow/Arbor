use crate::jobs::{self, JobTrigger, SharedCoordinator};
use crate::search::{self, SearchHit};
use crate::settings::{self, Settings};
use crate::watch::WatchState;
use crate::worker;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use tauri::Manager;

fn repo_dir(app: &tauri::AppHandle) -> PathBuf {
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

#[derive(serde::Deserialize, serde::Serialize, Clone, Default)]
pub struct KnowledgeSettings {
    #[serde(default)]
    pub delete_sources_after_digest: bool,
    #[serde(default)]
    pub auto_update: bool,
    #[serde(default = "default_true")]
    pub watch_enabled: bool,
}

fn default_true() -> bool {
    true
}

#[tauri::command]
pub fn get_knowledge_settings(root: String) -> Result<KnowledgeSettings, String> {
    let path = Path::new(&root).join(".arbor").join("settings.json");
    if !path.is_file() {
        return Ok(KnowledgeSettings::default());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "arbor-ks-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn knowledge_settings_enable_watch_by_default() {
        let ks = KnowledgeSettings::default();
        assert!(ks.watch_enabled);
        assert!(!ks.auto_update);
        assert!(!ks.delete_sources_after_digest);
    }

    #[test]
    fn empty_json_matches_struct_default() {
        let empty: KnowledgeSettings = serde_json::from_str("{}").unwrap();
        let default = KnowledgeSettings::default();
        assert_eq!(empty.watch_enabled, default.watch_enabled);
        assert_eq!(empty.auto_update, default.auto_update);
        assert_eq!(
            empty.delete_sources_after_digest,
            default.delete_sources_after_digest
        );
    }

    #[test]
    fn missing_settings_file_enables_watch() {
        let root = temp_root("missing");
        let ks = get_knowledge_settings(root.to_string_lossy().into_owned()).unwrap();
        assert!(ks.watch_enabled);
        assert!(!ks.auto_update);
    }

    #[test]
    fn partial_settings_keep_watch_enabled() {
        let root = temp_root("partial");
        fs::create_dir_all(root.join(".arbor")).unwrap();
        fs::write(
            root.join(".arbor").join("settings.json"),
            r#"{"auto_update": true}"#,
        )
        .unwrap();
        let ks = get_knowledge_settings(root.to_string_lossy().into_owned()).unwrap();
        assert!(ks.watch_enabled);
        assert!(ks.auto_update);
    }

    #[test]
    fn explicit_watch_disabled_is_honored() {
        let root = temp_root("disabled");
        fs::create_dir_all(root.join(".arbor")).unwrap();
        fs::write(
            root.join(".arbor").join("settings.json"),
            r#"{"watch_enabled": false}"#,
        )
        .unwrap();
        let ks = get_knowledge_settings(root.to_string_lossy().into_owned()).unwrap();
        assert!(!ks.watch_enabled);
    }
}

#[tauri::command]
pub fn search_knowledge(root: String, query: String, limit: Option<u32>) -> Result<Vec<SearchHit>, String> {
    search::search_documents(Path::new(&root), &query, limit.unwrap_or(25))
}

#[tauri::command]
pub fn reindex_knowledge(app: tauri::AppHandle, root: String) -> Result<serde_json::Value, String> {
    worker::run_worker_json(&repo_dir(&app), &["reindex", "--root", &root])
}

#[tauri::command]
pub fn start_folder_watch(app: tauri::AppHandle, root: String) -> Result<(), String> {
    let watch = app.state::<Arc<WatchState>>();
    watch.start(app.clone(), PathBuf::from(root));
    Ok(())
}

#[tauri::command]
pub fn init_arbor_db(root: String) -> Result<(), String> {
    jobs::ensure_db(Path::new(&root))
}

#[tauri::command]
pub fn list_jobs(root: String, limit: Option<u32>) -> Result<Vec<jobs::JobSummary>, String> {
    jobs::list_jobs(Path::new(&root), limit.unwrap_or(20))
}

#[tauri::command]
pub fn get_job_events(root: String, job_id: String) -> Result<Vec<jobs::JobEventRow>, String> {
    jobs::job_events(Path::new(&root), &job_id)
}

#[tauri::command]
pub fn start_update(
    app: tauri::AppHandle,
    coordinator: tauri::State<'_, SharedCoordinator>,
    root: String,
    model: String,
    selections: Vec<Selection>,
) -> Result<String, String> {
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

    let plan_json = serde_json::to_string(&serde_json::json!({ "selections": selections }))
        .map_err(|e| e.to_string())?;
    let knowledge_root = Path::new(&root);
    let job_id = jobs::create_job(knowledge_root, JobTrigger::Manual, &model, &plan_json)?;

    {
        let mut guard = coordinator.lock().map_err(|e| e.to_string())?;
        if let Err(e) = guard.try_begin(&job_id, &root) {
            let _ = jobs::finish_job(
                knowledge_root,
                &job_id,
                jobs::JobStatus::Failed,
                -1,
                Some(e.clone()),
            );
            return Err(e);
        }
    }

    let cancel = worker::cancel_file_path();
    let _ = std::fs::remove_file(&cancel);

    let plan_path = worker::plan_file_path();
    std::fs::write(&plan_path, plan_json.as_bytes()).map_err(|e| e.to_string())?;

    let app_dir = repo_dir(&app);
    worker::spawn_update_stream(
        app,
        app_dir,
        root.clone(),
        model,
        cancel,
        plan_path,
        job_id.clone(),
    );
    Ok(job_id)
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
    jobs::ensure_db(root)?;
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
