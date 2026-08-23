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

#[derive(serde::Deserialize, serde::Serialize, Clone)]
pub struct KnowledgeSettings {
    #[serde(default)]
    pub delete_sources_after_digest: bool,
    #[serde(default)]
    pub auto_update: bool,
    #[serde(default = "default_true")]
    pub watch_enabled: bool,
}

impl Default for KnowledgeSettings {
    fn default() -> Self {
        Self {
            delete_sources_after_digest: false,
            auto_update: false,
            watch_enabled: default_true(),
        }
    }
}

fn default_true() -> bool {
    true
}

#[derive(serde::Serialize)]
pub struct DigestInfo {
    pub name: String,
    pub path: String,
}

#[tauri::command]
pub fn list_courses(root: String) -> Result<Vec<String>, String> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("Not a folder: {root}"));
    }
    let mut courses = Vec::new();
    for entry in std::fs::read_dir(root_path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        courses.push(name);
    }
    courses.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    Ok(courses)
}

#[tauri::command]
pub fn list_digests(root: String, course: String) -> Result<Vec<DigestInfo>, String> {
    if course.contains('/') || course.contains('\\') || course.contains("..") {
        return Err("Invalid course name".into());
    }
    let digests_dir = Path::new(&root).join(&course).join("digests");
    if !digests_dir.is_dir() {
        return Ok(vec![]);
    }
    let mut digests = Vec::new();
    for entry in std::fs::read_dir(&digests_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().map_err(|e| e.to_string())?.is_file()
            && entry.path().extension().and_then(|e| e.to_str()) == Some("md")
        {
            let file_name = entry.file_name().to_string_lossy().into_owned();
            let stem = file_name.strip_suffix(".md").unwrap_or(&file_name).to_string();
            digests.push(DigestInfo {
                name: stem.clone(),
                path: format!("{course}/digests/{file_name}"),
            });
        }
    }
    digests.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(digests)
}

#[tauri::command]
pub fn read_markdown(root: String, relative_path: String) -> Result<String, String> {
    if relative_path.contains("..") {
        return Err("Invalid path".into());
    }
    let path = Path::new(&root).join(&relative_path);
    if !path.is_file() {
        return Err(format!("File not found: {relative_path}"));
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_knowledge_settings(root: String, settings: KnowledgeSettings) -> Result<(), String> {
    let arbor_dir = Path::new(&root).join(".arbor");
    std::fs::create_dir_all(&arbor_dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(arbor_dir.join("settings.json"), text).map_err(|e| e.to_string())
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
    trigger: Option<String>,
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
    let job_id = jobs::create_job(
        knowledge_root,
        JobTrigger::from_arg(trigger.as_deref()),
        &model,
        &plan_json,
    )?;

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
pub fn start_study_job(
    app: tauri::AppHandle,
    coordinator: tauri::State<'_, SharedCoordinator>,
    root: String,
    course: String,
    skill: String,
    force: Option<bool>,
) -> Result<String, String> {
    let force = force.unwrap_or(false);
    let plan_json = serde_json::to_string(&serde_json::json!({
        "course": course,
        "skill": skill,
        "force": force,
    }))
    .map_err(|e| e.to_string())?;
    let knowledge_root = Path::new(&root);
    let job_id = jobs::create_job(
        knowledge_root,
        JobTrigger::Study,
        "fake",
        &plan_json,
    )?;

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

    let app_dir = repo_dir(&app);
    worker::spawn_generate_stream(
        app,
        app_dir,
        root,
        course,
        skill,
        force,
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
