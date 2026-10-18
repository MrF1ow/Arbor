use crate::jobs::{self, JobTrigger, SharedCoordinator};
use crate::search::{self, SearchHit};
use crate::secrets::{self, OsSecretStore};
use crate::settings::{self, Settings};
use crate::watch::WatchState;
use crate::worker;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::Manager;

fn non_empty_provider(provider: Option<String>) -> Option<String> {
    provider
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn default_provider_id(provider: Option<String>) -> String {
    non_empty_provider(provider).unwrap_or_else(|| "codex".to_string())
}

fn worker_env_pairs(app: &tauri::AppHandle, sub_args: &[&str]) -> Vec<(String, String)> {
    let settings = settings::load(app);
    let store = OsSecretStore;
    secrets::worker_env_for_sub_args(sub_args, &store, &settings)
}

fn run_worker_json_app(
    app: &tauri::AppHandle,
    sub_args: &[&str],
) -> Result<serde_json::Value, String> {
    let pairs = worker_env_pairs(app, sub_args);
    let refs: Vec<(&str, &str)> = pairs
        .iter()
        .map(|(key, value)| (key.as_str(), value.as_str()))
        .collect();
    worker::run_worker_json(&repo_dir(app), sub_args, &refs)
}

fn run_worker_json_inherit(
    app: &tauri::AppHandle,
    sub_args: &[&str],
) -> Result<serde_json::Value, String> {
    worker::run_worker_json(&repo_dir(app), sub_args, &[])
}

fn default_skill_index_source(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut dir = repo_dir(app);
    loop {
        let candidate = dir.join("marketplace").join("index.json");
        if candidate.is_file() {
            return Ok(candidate);
        }
        if !dir.pop() {
            break;
        }
    }
    Err("default marketplace index was not found".to_string())
}

fn skill_index_source_path(app: &tauri::AppHandle, settings: &Settings) -> Result<PathBuf, String> {
    let explicit = settings.skill_index_source.trim();
    if explicit.is_empty() {
        default_skill_index_source(app)
    } else {
        Ok(PathBuf::from(explicit))
    }
}

fn fetch_skill_index(app: &tauri::AppHandle) -> Result<serde_json::Value, String> {
    let settings = settings::load(app);
    let source = skill_index_source_path(app, &settings)?;
    let source_str = source.to_string_lossy().into_owned();
    let ref_str = settings.skill_index_ref.trim();
    if ref_str.is_empty() {
        run_worker_json_inherit(
            app,
            &["skill-index", "--source", source_str.as_str()],
        )
    } else {
        run_worker_json_inherit(
            app,
            &[
                "skill-index",
                "--source",
                source_str.as_str(),
                "--ref",
                ref_str,
            ],
        )
    }
}

fn index_package_by_id<'a>(
    index: &'a serde_json::Value,
    id: &str,
) -> Result<&'a serde_json::Value, String> {
    let packages = index
        .get("packages")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "invalid skill index".to_string())?;
    packages
        .iter()
        .find(|p| p.get("id").and_then(|v| v.as_str()) == Some(id))
        .ok_or_else(|| format!("skill package not in index: {id}"))
}

fn permission_sets_equal(grant: &[String], index: &[serde_json::Value]) -> bool {
    let mut a: Vec<&str> = grant.iter().map(String::as_str).collect();
    let mut b: Vec<&str> = index
        .iter()
        .filter_map(|v| v.as_str())
        .collect();
    a.sort_unstable();
    b.sort_unstable();
    a == b
}

fn repo_dir(app: &tauri::AppHandle) -> PathBuf {
    let resource_dir = app.path().resource_dir().ok();
    let current_dir = std::env::current_dir().ok();
    let current_exe = std::env::current_exe().ok();
    #[cfg(debug_assertions)]
    let cargo_manifest_dir = Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    #[cfg(not(debug_assertions))]
    let cargo_manifest_dir = None::<PathBuf>;
    worker::resolve_repo_dir(
        &|k| std::env::var(k).ok(),
        resource_dir.as_deref(),
        current_dir.as_deref(),
        current_exe.as_deref(),
        cargo_manifest_dir.as_deref(),
    )
}

#[tauri::command]
pub fn check_auth(
    app: tauri::AppHandle,
    provider: Option<String>,
) -> Result<serde_json::Value, String> {
    match non_empty_provider(provider) {
        Some(id) => run_worker_json_app(&app, &["check-auth", "--provider", &id]),
        None => run_worker_json_app(&app, &["check-auth"]),
    }
}

#[tauri::command]
pub fn list_models(
    app: tauri::AppHandle,
    root: Option<String>,
    provider: Option<String>,
) -> Result<serde_json::Value, String> {
    let provider_id = non_empty_provider(provider);
    let mut args: Vec<&str> = vec!["list-models"];
    if let Some(r) = root.as_deref() {
        args.push("--root");
        args.push(r);
    }
    if let Some(id) = provider_id.as_deref() {
        args.push("--provider");
        args.push(id);
    }
    run_worker_json_app(&app, &args)
}

#[tauri::command]
pub fn list_providers(
    app: tauri::AppHandle,
    root: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut args: Vec<&str> = vec!["list-providers"];
    if let Some(r) = root.as_deref() {
        args.push("--root");
        args.push(r);
    }
    run_worker_json_app(&app, &args)
}

#[tauri::command]
pub fn plan_update(app: tauri::AppHandle, root: String) -> Result<serde_json::Value, String> {
    run_worker_json_app(&app, &["plan-update", "--root", &root])
}

#[tauri::command]
pub fn sync_show(app: tauri::AppHandle, root: String) -> Result<serde_json::Value, String> {
    run_worker_json_app(&app, &["sync", "--root", &root, "--show"])
}

#[tauri::command]
pub fn sync_set_remote(
    app: tauri::AppHandle,
    root: String,
    url: String,
) -> Result<serde_json::Value, String> {
    run_worker_json_app(
        &app,
        &["sync", "--root", &root, "--set-remote", url.as_str()],
    )
}

#[tauri::command]
pub fn sync_set_shared(
    app: tauri::AppHandle,
    root: String,
    shared: bool,
) -> Result<serde_json::Value, String> {
    let flag = if shared { "--shared" } else { "--no-shared" };
    run_worker_json_app(&app, &["sync", "--root", &root, flag])
}

#[tauri::command]
pub fn create_shared_library(
    app: tauri::AppHandle,
    root: String,
    name: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut args = vec!["library-create", "--root", root.as_str()];
    let name_arg;
    if let Some(ref n) = name {
        name_arg = n.as_str();
        args.push("--name");
        args.push(name_arg);
    }
    run_worker_json_app(&app, &args)
}

#[tauri::command]
pub fn join_library(
    app: tauri::AppHandle,
    url: String,
    dest: String,
) -> Result<serde_json::Value, String> {
    run_worker_json_app(
        &app,
        &["library-join", "--url", url.as_str(), "--dest", dest.as_str()],
    )
}

#[tauri::command]
pub fn library_show(app: tauri::AppHandle, root: String) -> Result<serde_json::Value, String> {
    run_worker_json_app(&app, &["library-show", "--root", &root])
}

#[tauri::command]
pub fn library_set_members(
    app: tauri::AppHandle,
    root: String,
    members: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let members_json = serde_json::to_string(&members).map_err(|e| e.to_string())?;
    run_worker_json_app(
        &app,
        &[
            "library-members",
            "--root",
            root.as_str(),
            "--members",
            members_json.as_str(),
        ],
    )
}

#[tauri::command]
pub fn library_set_provider(
    app: tauri::AppHandle,
    root: String,
    id: Option<String>,
    model: Option<String>,
    clear: bool,
) -> Result<serde_json::Value, String> {
    if clear {
        return run_worker_json_app(&app, &["library-provider", "--root", &root, "--clear"]);
    }
    let id = id.ok_or_else(|| "provider id is required".to_string())?;
    let model = model.ok_or_else(|| "provider model is required".to_string())?;
    run_worker_json_app(
        &app,
        &[
            "library-provider",
            "--root",
            &root,
            "--id",
            id.as_str(),
            "--model",
            model.as_str(),
        ],
    )
}

#[tauri::command]
pub fn sync_now(app: tauri::AppHandle, root: String) -> Result<serde_json::Value, String> {
    run_worker_json_app(&app, &["sync", "--root", &root])
}

#[tauri::command]
pub fn sync_resolve(
    app: tauri::AppHandle,
    root: String,
    path: String,
    side: String,
    content: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut owned = vec![
        "sync-resolve".to_string(),
        "--root".to_string(),
        root,
        "--path".to_string(),
        path,
        "--side".to_string(),
        side,
    ];
    if let Some(text) = content {
        owned.push("--content".to_string());
        owned.push(text);
    }
    let refs: Vec<&str> = owned.iter().map(String::as_str).collect();
    run_worker_json_app(&app, &refs)
}

#[tauri::command]
pub fn sync_continue(app: tauri::AppHandle, root: String) -> Result<serde_json::Value, String> {
    run_worker_json_app(&app, &["sync-continue", "--root", &root])
}

#[tauri::command]
pub fn skill_index(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    fetch_skill_index(&app)
}

#[tauri::command]
pub fn skill_install(app: tauri::AppHandle, id: String) -> Result<serde_json::Value, String> {
    let index = fetch_skill_index(&app)?;
    let entry = index_package_by_id(&index, &id)?;
    let kind = entry
        .get("kind")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "invalid skill index entry".to_string())?;
    if kind != "skill" {
        return Err("provider packages are not installed".to_string());
    }
    let git = entry
        .get("git")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "invalid skill index entry".to_string())?;
    let commit = entry
        .get("commit")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "invalid skill index entry".to_string())?;
    let mut owned = vec![
        "skill-install".to_string(),
        "--git".to_string(),
        git.to_string(),
        "--commit".to_string(),
        commit.to_string(),
        "--id".to_string(),
        id,
    ];
    if let Some(subdir) = entry.get("subdir").and_then(|v| v.as_str()) {
        if !subdir.is_empty() {
            owned.push("--subdir".to_string());
            owned.push(subdir.to_string());
        }
    }
    let refs: Vec<&str> = owned.iter().map(String::as_str).collect();
    run_worker_json_inherit(&app, &refs)
}

#[tauri::command]
pub fn skill_uninstall(app: tauri::AppHandle, id: String) -> Result<serde_json::Value, String> {
    run_worker_json_inherit(
        &app,
        &["skill-uninstall", "--id", id.as_str()],
    )
}

#[tauri::command]
pub fn skill_run(
    app: tauri::AppHandle,
    root: String,
    id: String,
    commit: String,
    course: String,
    export_dir: String,
    confirmed: bool,
) -> Result<serde_json::Value, String> {
    if !confirmed {
        return Err("permissions not confirmed".to_string());
    }
    let settings = settings::load(&app);
    let grant = settings
        .skill_grants
        .iter()
        .find(|g| g.id == id && g.commit == commit)
        .ok_or_else(|| "permissions not confirmed".to_string())?;
    let index = fetch_skill_index(&app)?;
    let entry = index_package_by_id(&index, &id)?;
    let index_perms = entry
        .get("permissions")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "invalid skill index entry".to_string())?;
    if !permission_sets_equal(&grant.permissions, index_perms) {
        return Err("permissions not confirmed".to_string());
    }
    let mut owned = vec![
        "skill-run".to_string(),
        "--root".to_string(),
        root,
        "--course".to_string(),
        course,
        "--export-dir".to_string(),
        export_dir,
        "--id".to_string(),
        id,
        "--commit".to_string(),
        commit,
        "--confirmed".to_string(),
    ];
    for perm in &grant.permissions {
        owned.push("--grant".to_string());
        owned.push(perm.clone());
    }
    let refs: Vec<&str> = owned.iter().map(String::as_str).collect();
    run_worker_json_inherit(&app, &refs)
}

#[tauri::command]
pub fn read_sync_conflict(root: String) -> Result<serde_json::Value, String> {
    let relative = ".arbor/sync-conflict.json";
    let path = resolve_in_root(&root, relative)?;
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
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
pub fn set_provider_secret(provider_id: String, secret: String) -> Result<(), String> {
    let store = OsSecretStore;
    secrets::set_provider_secret_logic(&store, &provider_id, &secret)
}

#[tauri::command]
pub fn clear_provider_secret(provider_id: String) -> Result<(), String> {
    let store = OsSecretStore;
    secrets::clear_provider_secret_logic(&store, &provider_id)
}

#[tauri::command]
pub fn provider_secret_status(provider_id: String) -> Result<String, String> {
    let store = OsSecretStore;
    secrets::provider_secret_status_logic(&store, &provider_id)
}

#[derive(serde::Deserialize, serde::Serialize, Clone)]
pub struct AutoGenerate {
    #[serde(default)]
    pub flashcards: bool,
    #[serde(default)]
    pub quiz: bool,
}

impl Default for AutoGenerate {
    fn default() -> Self {
        Self {
            flashcards: false,
            quiz: false,
        }
    }
}

#[derive(serde::Deserialize, serde::Serialize, Clone)]
pub struct KnowledgeSettings {
    #[serde(default)]
    pub delete_sources_after_digest: bool,
    #[serde(default)]
    pub auto_update: bool,
    #[serde(default)]
    pub auto_embed: bool,
    #[serde(default = "default_true")]
    pub watch_enabled: bool,
    #[serde(default)]
    pub auto_generate: AutoGenerate,
    #[serde(default)]
    pub sync_after_commit: bool,
}

impl Default for KnowledgeSettings {
    fn default() -> Self {
        Self {
            delete_sources_after_digest: false,
            auto_update: false,
            auto_embed: false,
            watch_enabled: default_true(),
            auto_generate: AutoGenerate::default(),
            sync_after_commit: false,
        }
    }
}

fn default_true() -> bool {
    true
}

#[derive(serde::Serialize)]
pub struct DigestInfo {
    pub title: String,
    pub date: String,
    pub path: String,
}

fn markdown_title(text: &str) -> Option<String> {
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("<!--") {
            continue;
        }
        return trimmed
            .strip_prefix("# ")
            .map(str::trim)
            .filter(|title| !title.is_empty())
            .map(str::to_string);
    }
    None
}

pub(crate) fn is_reserved_course_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower == "_arbor_cache"
        || lower == "study"
        || lower == "digests"
        || name.starts_with('.')
}

fn is_course_dir_name(name: &str) -> bool {
    !name.is_empty() && !is_reserved_course_name(name)
}

fn date_from_stem(stem: &str) -> String {
    if let Some((day, clock)) = stem.split_once('T') {
        if clock.len() >= 4 && clock[..4].chars().all(|c| c.is_ascii_digit()) {
            let hh = &clock[..2];
            let mm = &clock[2..4];
            return format!("{day} · {hh}:{mm}");
        }
    }
    stem.to_string()
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
        if !is_course_dir_name(&name) {
            continue;
        }
        courses.push(name);
    }
    courses.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    Ok(courses)
}

const SOURCE_EXTENSIONS: &[&str] = &["pdf", "pptx", "docx"];

fn unique_dest(dir: &Path, file_name: &std::ffi::OsStr) -> PathBuf {
    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".into());
    let ext = path.extension().map(|s| s.to_string_lossy().into_owned());
    let mut n = 2u32;
    loop {
        let name = match &ext {
            Some(ext) => format!("{stem}-{n}.{ext}"),
            None => format!("{stem}-{n}"),
        };
        let candidate = dir.join(name);
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}

fn path_is_under(path: &Path, dir: &Path) -> bool {
    match (path.canonicalize(), dir.canonicalize()) {
        (Ok(path), Ok(dir)) => path.starts_with(dir),
        _ => false,
    }
}

fn dest_file_name(path: &Path) -> Result<String, String> {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| !n.is_empty())
        .ok_or_else(|| format!("Invalid path: {}", path.display()))
}

#[tauri::command]
pub fn create_course(root: String, name: String) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Class name cannot be empty".into());
    }
    validate_path_component(name, "course name")?;
    if is_reserved_course_name(name) {
        return Err(format!(
            "\"{name}\" is reserved. Choose a different class name."
        ));
    }
    let path = Path::new(&root).join(name);
    if path.exists() {
        return Err(format!("A class named {name} already exists"));
    }
    std::fs::create_dir(&path).map_err(|e| e.to_string())?;
    Ok(name.to_string())
}

#[tauri::command]
pub fn import_sources(
    root: String,
    course: String,
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    validate_path_component(&course, "course name")?;
    let dest_dir = Path::new(&root).join(&course);
    if !dest_dir.is_dir() {
        return Err(format!("Class not found: {course}"));
    }
    let mut imported = Vec::new();
    let mut used_names: HashSet<String> = HashSet::new();
    for src in paths {
        let src_path = Path::new(&src);
        if !src_path.is_file() {
            return Err(format!("File not found: {src}"));
        }
        let ext = src_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !SOURCE_EXTENSIONS.contains(&ext.as_str()) {
            return Err(format!("Unsupported file type: {src}"));
        }
        let file_name = src_path
            .file_name()
            .ok_or_else(|| format!("Invalid path: {src}"))?;
        let name_key = file_name.to_string_lossy().to_ascii_lowercase();
        if path_is_under(src_path, &dest_dir) {
            imported.push(file_name.to_string_lossy().into_owned());
            used_names.insert(name_key);
            continue;
        }
        let dest = if used_names.contains(&name_key) {
            unique_dest(&dest_dir, file_name)
        } else {
            dest_dir.join(file_name)
        };
        std::fs::copy(src_path, &dest).map_err(|e| e.to_string())?;
        let out_name = dest_file_name(&dest)?;
        used_names.insert(name_key);
        imported.push(out_name);
    }
    Ok(imported)
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
            let stem = file_name
                .strip_suffix(".md")
                .unwrap_or(&file_name)
                .to_string();
            let date = date_from_stem(&stem);
            let title = std::fs::read_to_string(entry.path())
                .ok()
                .and_then(|text| markdown_title(&text))
                .unwrap_or_else(|| date.clone());
            digests.push(DigestInfo {
                title,
                date,
                path: format!("{course}/digests/{file_name}"),
            });
        }
    }
    digests.sort_by(|a, b| b.path.cmp(&a.path));
    Ok(digests)
}

fn resolve_in_root(root: &str, relative: &str) -> Result<PathBuf, String> {
    let relative_path = Path::new(relative);
    if relative_path.is_absolute()
        || relative_path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Invalid path".into());
    }
    let root_path = Path::new(root);
    let joined = root_path.join(relative_path);
    let canon_root = root_path
        .canonicalize()
        .map_err(|_| "Invalid path".to_string())?;
    let canon_joined = match joined.canonicalize() {
        Ok(path) => path,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(format!("File not found: {relative}"));
        }
        Err(_) => return Err("Invalid path".into()),
    };
    if !canon_joined.starts_with(&canon_root) {
        return Err("Invalid path".into());
    }
    Ok(canon_joined)
}

#[tauri::command]
pub fn read_markdown(root: String, relative_path: String) -> Result<String, String> {
    let path = resolve_in_root(&root, &relative_path)?;
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

fn validate_path_component(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty() || value.contains('/') || value.contains('\\') || value.contains("..") {
        return Err(format!("Invalid {label}"));
    }
    Ok(())
}

fn is_safe_user_dir(email: &str) -> bool {
    !email.is_empty()
        && email != "."
        && email != ".."
        && !email.contains('/')
        && !email.contains('\\')
        && !email.contains("..")
}

fn git_user_dirname(root: &str) -> Result<String, String> {
    let output = Command::new("git")
        .args(["-C", root, "config", "--get", "user.email"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .map_err(|e| e.to_string())?;
    let email = if output.status.success() {
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    } else {
        String::new()
    };
    Ok(if is_safe_user_dir(&email) {
        email
    } else {
        "arbor@localhost".to_string()
    })
}

fn migrate_derived_file(old: &Path, new: &Path, bak: &Path) -> Result<(), String> {
    if new.is_file() {
        return Ok(());
    }
    if !old.is_file() {
        return Ok(());
    }
    if let Some(parent) = new.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::copy(old, new).map_err(|e| e.to_string())?;
    if !bak.is_file() {
        std::fs::rename(old, bak).map_err(|e| e.to_string())?;
    } else {
        std::fs::remove_file(old).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn read_study_json(
    root: String,
    course: String,
    file: String,
) -> Result<serde_json::Value, String> {
    validate_path_component(&course, "course name")?;
    validate_path_component(&file, "study file")?;
    let path = Path::new(&root).join(course).join("study").join(file);
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

fn flashcard_progress_path(root: &str, course: &str) -> Result<PathBuf, String> {
    validate_path_component(course, "course name")?;
    let dirname = git_user_dirname(root)?;
    let new_path = Path::new(root)
        .join(".arbor")
        .join("users")
        .join(&dirname)
        .join("local")
        .join(format!("{course}.flashcards.json"));
    let old_path = Path::new(root)
        .join(".arbor")
        .join("progress")
        .join(format!("{course}.flashcards.json"));
    let bak_path = old_path.with_extension("json.bak");
    migrate_derived_file(&old_path, &new_path, &bak_path)?;
    Ok(new_path)
}

#[tauri::command]
pub fn read_flashcard_progress(root: String, course: String) -> Result<serde_json::Value, String> {
    let path = flashcard_progress_path(&root, &course)?;
    if !path.is_file() {
        return Ok(serde_json::json!({}));
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if !value.is_object() {
        return Err("Flashcard progress must be a JSON object".into());
    }
    Ok(value)
}

#[tauri::command]
pub fn write_flashcard_progress(
    root: String,
    course: String,
    data: serde_json::Value,
) -> Result<(), String> {
    if !data.is_object() {
        return Err("Flashcard progress must be a JSON object".into());
    }
    let path = flashcard_progress_path(&root, &course)?;
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid progress path".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut bytes = serde_json::to_vec_pretty(&data).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(temp, path).map_err(|e| e.to_string())
}

fn quiz_progress_path(root: &str, course: &str) -> Result<PathBuf, String> {
    validate_path_component(course, "course name")?;
    let dirname = git_user_dirname(root)?;
    let new_path = Path::new(root)
        .join(".arbor")
        .join("users")
        .join(&dirname)
        .join("local")
        .join(format!("{course}.quiz.json"));
    let old_path = Path::new(root)
        .join(".arbor")
        .join("progress")
        .join(format!("{course}.quiz.json"));
    let bak_path = old_path.with_extension("json.bak");
    migrate_derived_file(&old_path, &new_path, &bak_path)?;
    Ok(new_path)
}

#[tauri::command]
pub fn read_quiz_progress(root: String, course: String) -> Result<serde_json::Value, String> {
    let path = quiz_progress_path(&root, &course)?;
    if !path.is_file() {
        return Ok(serde_json::json!({}));
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if !value.is_object() {
        return Err("Quiz progress must be a JSON object".into());
    }
    Ok(value)
}

pub fn build_study_progress_argv(
    root: &str,
    course: &str,
    action: &str,
    id: Option<&str>,
    result: Option<&str>,
    digest: Option<&str>,
    heading: Option<&str>,
) -> Result<Vec<String>, String> {
    let mut argv = vec![
        "study-progress".to_string(),
        "--root".to_string(),
        root.to_string(),
        "--course".to_string(),
        course.to_string(),
    ];
    match action {
        "due" | "weak" | "recommend" => {
            argv.push(action.to_string());
        }
        "grade" | "quiz" => {
            let card_id = id.ok_or_else(|| format!("{action} requires id"))?;
            let outcome = result.ok_or_else(|| format!("{action} requires result"))?;
            argv.push(action.to_string());
            argv.push("--id".to_string());
            argv.push(card_id.to_string());
            argv.push("--result".to_string());
            argv.push(outcome.to_string());
            if let Some(d) = digest {
                if !d.is_empty() {
                    argv.push("--digest".to_string());
                    argv.push(d.to_string());
                }
            }
            argv.push("--heading".to_string());
            argv.push(heading.unwrap_or("").to_string());
        }
        _ => return Err(format!("unknown study-progress action: {action}")),
    }
    Ok(argv)
}

fn study_progress_argv_refs(argv: &[String]) -> Vec<&str> {
    argv.iter().map(String::as_str).collect()
}

#[tauri::command]
pub fn study_progress(
    app: tauri::AppHandle,
    root: String,
    course: String,
    action: String,
    id: Option<String>,
    result: Option<String>,
    digest: Option<String>,
    heading: Option<String>,
) -> Result<serde_json::Value, String> {
    let argv = build_study_progress_argv(
        &root,
        &course,
        &action,
        id.as_deref(),
        result.as_deref(),
        digest.as_deref(),
        heading.as_deref(),
    )?;
    let refs = study_progress_argv_refs(&argv);
    run_worker_json_app(&app, &refs)
}

fn validate_exam_date(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.len() != 10 {
        return Err("exam date must be YYYY-MM-DD".into());
    }
    let bytes = trimmed.as_bytes();
    if bytes[4] != b'-' || bytes[7] != b'-' {
        return Err("exam date must be YYYY-MM-DD".into());
    }
    for (index, byte) in bytes.iter().enumerate() {
        if index == 4 || index == 7 {
            continue;
        }
        if !byte.is_ascii_digit() {
            return Err("exam date must be YYYY-MM-DD".into());
        }
    }
    Ok(trimmed.to_string())
}

pub fn build_study_plan_argv(
    root: &str,
    course: &str,
    provider: &str,
    model: &str,
    exam_date: Option<&str>,
) -> Result<Vec<String>, String> {
    if model.trim().is_empty() {
        return Err("model is required".into());
    }
    let mut argv = vec![
        "study-plan".to_string(),
        "--root".to_string(),
        root.to_string(),
        "--course".to_string(),
        course.to_string(),
        "--provider".to_string(),
        provider.to_string(),
        "--model".to_string(),
        model.to_string(),
    ];
    if let Some(date) = exam_date {
        let trimmed = date.trim();
        if !trimmed.is_empty() {
            let validated = validate_exam_date(trimmed)?;
            argv.push("--exam-date".to_string());
            argv.push(validated);
        }
    }
    Ok(argv)
}

#[tauri::command]
pub fn study_plan(
    app: tauri::AppHandle,
    root: String,
    course: String,
    provider: Option<String>,
    model: String,
    exam_date: Option<String>,
) -> Result<serde_json::Value, String> {
    let provider_id = default_provider_id(provider);
    let argv = build_study_plan_argv(
        &root,
        &course,
        &provider_id,
        &model,
        exam_date.as_deref(),
    )?;
    let refs = study_progress_argv_refs(&argv);
    run_worker_json_app(&app, &refs)
}

pub fn build_append_card_argv(
    root: &str,
    course: &str,
    front: &str,
    back: &str,
    digest: &str,
    heading: Option<&str>,
    page: Option<&str>,
) -> Result<Vec<String>, String> {
    if front.trim().is_empty() {
        return Err("front is required".into());
    }
    if back.trim().is_empty() {
        return Err("back is required".into());
    }
    if digest.trim().is_empty() {
        return Err("digest is required".into());
    }
    let mut argv = vec![
        "append-card".to_string(),
        "--root".to_string(),
        root.to_string(),
        "--course".to_string(),
        course.to_string(),
        "--front".to_string(),
        front.to_string(),
        "--back".to_string(),
        back.to_string(),
        "--digest".to_string(),
        digest.to_string(),
    ];
    if let Some(h) = heading {
        let trimmed = h.trim();
        if !trimmed.is_empty() {
            argv.push("--heading".to_string());
            argv.push(trimmed.to_string());
        }
    }
    if let Some(p) = page {
        let trimmed = p.trim();
        if !trimmed.is_empty() {
            argv.push("--page".to_string());
            argv.push(trimmed.to_string());
        }
    }
    Ok(argv)
}

#[tauri::command]
pub fn append_card(
    app: tauri::AppHandle,
    root: String,
    course: String,
    front: String,
    back: String,
    digest: String,
    heading: Option<String>,
    page: Option<String>,
) -> Result<serde_json::Value, String> {
    let argv = build_append_card_argv(
        &root,
        &course,
        &front,
        &back,
        &digest,
        heading.as_deref(),
        page.as_deref(),
    )?;
    let refs = study_progress_argv_refs(&argv);
    run_worker_json_app(&app, &refs)
}

#[tauri::command]
pub fn write_quiz_progress(
    root: String,
    course: String,
    data: serde_json::Value,
) -> Result<(), String> {
    if !data.is_object() {
        return Err("Quiz progress must be a JSON object".into());
    }
    let path = quiz_progress_path(&root, &course)?;
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid progress path".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut bytes = serde_json::to_vec_pretty(&data).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(temp, path).map_err(|e| e.to_string())
}

#[derive(serde::Deserialize)]
struct StaleManifest {
    artifacts: HashMap<String, StaleArtifact>,
}

#[derive(serde::Deserialize)]
struct StaleArtifact {
    content_sha256: String,
}

#[tauri::command]
pub fn study_artifact_stale(root: String, course: String, skill: String) -> Result<bool, String> {
    validate_path_component(&course, "course name")?;
    validate_path_component(&skill, "skill name")?;
    let course_dir = Path::new(&root).join(course);
    let manifest_path = course_dir.join("study").join("manifest.json");
    if !manifest_path.is_file() {
        return Ok(false);
    }
    let manifest: StaleManifest =
        serde_json::from_slice(&std::fs::read(manifest_path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let Some(artifact) = manifest.artifacts.get(&skill) else {
        return Ok(false);
    };
    let digests_dir = course_dir.join("digests");
    let mut paths = std::fs::read_dir(digests_dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("md"))
        .collect::<Vec<_>>();
    paths.sort();
    let mut hasher = Sha256::new();
    for path in paths {
        hasher.update(std::fs::read(path).map_err(|e| e.to_string())?);
    }
    let current = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(current != artifact.content_sha256)
}

fn validate_chat_course(course: &str) -> Result<(), String> {
    validate_path_component(course, "course name")?;
    if is_reserved_course_name(course) {
        return Err(format!(
            "{course} is a reserved name and cannot be used as a class"
        ));
    }
    Ok(())
}

fn chat_history_path(root: &str, course: &str) -> Result<PathBuf, String> {
    validate_chat_course(course)?;
    let dirname = git_user_dirname(root)?;
    let new_path = Path::new(root)
        .join(".arbor")
        .join("users")
        .join(&dirname)
        .join("chat")
        .join(format!("{course}.jsonl"));
    if new_path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("Invalid course name".into());
    }
    let old_path = Path::new(root)
        .join(".arbor")
        .join("chat")
        .join(format!("{course}.jsonl"));
    let bak_path = old_path.with_file_name(format!("{course}.jsonl.bak"));
    migrate_derived_file(&old_path, &new_path, &bak_path)?;
    Ok(new_path)
}

fn kill_and_reap_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn validate_chat_line_role(line: &serde_json::Value) -> Result<(), String> {
    let role = line
        .get("role")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Chat line must have a role".to_string())?;
    if role == "user" || role == "assistant" || role == "session" {
        Ok(())
    } else {
        Err(format!("Invalid chat line role: {role}"))
    }
}

fn validate_chat_mode(mode: &str) -> Result<(), String> {
    if mode == "ask" || mode == "explain" || mode == "quiz" {
        Ok(())
    } else {
        Err(format!("Invalid chat mode: {mode}"))
    }
}

pub(crate) fn chat_worker_stdin_payload(
    root: &str,
    course: &str,
    question: &str,
    mode: &str,
    provider: &str,
    model: &str,
    history: &[serde_json::Value],
) -> serde_json::Value {
    serde_json::json!({
        "root": root,
        "course": course,
        "question": question,
        "mode": mode,
        "provider": provider,
        "model": model,
        "history": history,
    })
}

#[tauri::command]
pub fn read_chat_history(root: String, course: String) -> Result<Vec<serde_json::Value>, String> {
    let path = chat_history_path(&root, &course)?;
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut lines = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str(line) {
            lines.push(value);
        }
    }
    Ok(lines)
}

#[tauri::command]
pub fn append_chat_lines(
    root: String,
    course: String,
    lines: Vec<serde_json::Value>,
) -> Result<(), String> {
    let path = chat_history_path(&root, &course)?;
    for line in &lines {
        validate_chat_line_role(line)?;
    }
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid chat history path".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    for line in lines {
        let mut bytes = serde_json::to_vec(&line).map_err(|e| e.to_string())?;
        bytes.push(b'\n');
        file.write_all(&bytes).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn clear_chat_history(root: String, course: String) -> Result<(), String> {
    let path = chat_history_path(&root, &course)?;
    if path.is_file() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn start_chat(
    app: tauri::AppHandle,
    on_event: Channel<serde_json::Value>,
    root: String,
    course: String,
    question: String,
    mode: String,
    provider: Option<String>,
    model: String,
    history: Vec<serde_json::Value>,
) -> Result<(), String> {
    validate_chat_course(&course)?;
    validate_chat_mode(&mode)?;
    if model.trim().is_empty() {
        return Err("Model is required".into());
    }
    let provider_id = default_provider_id(provider);
    let label = settings::provider_label(&provider_id);
    let auth = run_worker_json_app(
        &app,
        &["check-auth", "--provider", &provider_id],
    )?;
    let authenticated = auth
        .get("authenticated")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    if !authenticated {
        return Err(
            auth
                .get("reason")
                .and_then(|value| value.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| format!("{label} is not authenticated")),
        );
    }

    let app_dir = repo_dir(&app);
    let chat_env_pairs = {
        let settings = settings::load(&app);
        let store = OsSecretStore;
        secrets::worker_env_for_provider_id(&provider_id, &store, &settings)
    };
    let sidecar = worker::packaged_sidecar();
    let argv = worker::resolve_worker_argv(
        &|key| std::env::var(key).ok(),
        &worker::default_python_dir(&app_dir),
        &["chat"],
        sidecar.as_deref(),
    );
    if let Some(err) = worker::uv_project_missing_error(&argv) {
        return Err(err);
    }

    let payload = chat_worker_stdin_payload(
        &root,
        &course,
        &question,
        &mode,
        &provider_id,
        model.trim(),
        &history,
    );
    let stdin_body = serde_json::to_string(&payload).map_err(|e| e.to_string())?;

    std::thread::spawn(move || {
        let send_exit = |code: i32| {
            let _ = on_event.send(serde_json::json!({
                "type": "worker_exit",
                "code": code,
            }));
        };
        if let Some(err) = worker::uv_project_missing_error(&argv) {
            let _ = on_event.send(serde_json::json!({
                "type": "error",
                "message": err,
            }));
            send_exit(-1);
            return;
        }
        let env_refs: Vec<(&str, &str)> = chat_env_pairs
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str()))
            .collect();
        let mut command = Command::new(&argv[0]);
        command
            .args(&argv[1..])
            .env(
                "PATH",
                worker::augmented_path_from(
                    std::env::var("HOME").ok().as_deref(),
                    std::env::var("PATH").ok().as_deref(),
                ),
            )
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        secrets::apply_env_pairs(&mut command, &env_refs);
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let _ = on_event.send(serde_json::json!({
                    "type": "error",
                    "message": format!("failed to launch worker: {error}"),
                }));
                send_exit(-1);
                return;
            }
        };
        if let Some(mut stdin) = child.stdin.take() {
            if stdin.write_all(stdin_body.as_bytes()).is_err() {
                let _ = on_event.send(serde_json::json!({
                    "type": "error",
                    "message": "failed to write chat request to worker",
                }));
                kill_and_reap_child(&mut child);
                send_exit(-1);
                return;
            }
        }
        if let Some(stdout) = child.stdout.take() {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                    let _ = on_event.send(value);
                }
            }
        }
        let code = child.wait().ok().and_then(|status| status.code()).unwrap_or(-1);
        send_exit(code);
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::{Mutex, MutexGuard};

    static GIT_IDENTITY_TEST_LOCK: Mutex<()> = Mutex::new(());

    struct IsolatedGitIdentityGuard {
        _mutex: MutexGuard<'static, ()>,
        saved_home: Option<String>,
        saved_git_config_global: Option<String>,
        saved_git_config_nosystem: Option<String>,
        _temp_home: PathBuf,
        _temp_gitconfig: PathBuf,
    }

    fn restore_optional_env(key: &str, value: Option<String>) {
        match value {
            Some(v) => unsafe { std::env::set_var(key, v) },
            None => unsafe { std::env::remove_var(key) },
        }
    }

    impl IsolatedGitIdentityGuard {
        fn with_empty_identity() -> Self {
            let mutex = GIT_IDENTITY_TEST_LOCK.lock().unwrap();
            let saved_home = std::env::var("HOME").ok();
            let saved_git_config_global = std::env::var("GIT_CONFIG_GLOBAL").ok();
            let saved_git_config_nosystem = std::env::var("GIT_CONFIG_NOSYSTEM").ok();

            let temp_home = temp_root("git-identity-home");
            let gitconfig_path = temp_home.join("gitconfig");
            fs::write(&gitconfig_path, "").unwrap();

            unsafe {
                std::env::set_var("HOME", &temp_home);
                std::env::set_var("GIT_CONFIG_GLOBAL", &gitconfig_path);
                std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
            }

            Self {
                _mutex: mutex,
                saved_home,
                saved_git_config_global,
                saved_git_config_nosystem,
                _temp_home: temp_home,
                _temp_gitconfig: gitconfig_path,
            }
        }

        fn with_global_email() -> Self {
            let mutex = GIT_IDENTITY_TEST_LOCK.lock().unwrap();
            let saved_home = std::env::var("HOME").ok();
            let saved_git_config_global = std::env::var("GIT_CONFIG_GLOBAL").ok();
            let saved_git_config_nosystem = std::env::var("GIT_CONFIG_NOSYSTEM").ok();

            let temp_home = temp_root("git-identity-home");
            let gitconfig_path = temp_home.join("gitconfig");
            fs::write(
                &gitconfig_path,
                "[user]\n\temail = global-only@example.com\n\tname = Global Only\n",
            )
            .unwrap();

            unsafe {
                std::env::set_var("HOME", &temp_home);
                std::env::set_var("GIT_CONFIG_GLOBAL", &gitconfig_path);
                std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
            }

            Self {
                _mutex: mutex,
                saved_home,
                saved_git_config_global,
                saved_git_config_nosystem,
                _temp_home: temp_home,
                _temp_gitconfig: gitconfig_path,
            }
        }
    }

    impl Drop for IsolatedGitIdentityGuard {
        fn drop(&mut self) {
            restore_optional_env("HOME", self.saved_home.take());
            restore_optional_env("GIT_CONFIG_GLOBAL", self.saved_git_config_global.take());
            restore_optional_env("GIT_CONFIG_NOSYSTEM", self.saved_git_config_nosystem.take());
        }
    }

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
        assert!(!ks.auto_embed);
        assert!(!ks.delete_sources_after_digest);
        assert!(!ks.auto_generate.flashcards);
        assert!(!ks.auto_generate.quiz);
        assert!(!ks.sync_after_commit);
    }

    #[test]
    fn empty_json_matches_struct_default() {
        let empty: KnowledgeSettings = serde_json::from_str("{}").unwrap();
        let default = KnowledgeSettings::default();
        assert_eq!(empty.watch_enabled, default.watch_enabled);
        assert_eq!(empty.auto_update, default.auto_update);
        assert_eq!(empty.auto_embed, default.auto_embed);
        assert_eq!(
            empty.delete_sources_after_digest,
            default.delete_sources_after_digest
        );
        assert_eq!(
            empty.auto_generate.flashcards,
            default.auto_generate.flashcards
        );
        assert_eq!(empty.auto_generate.quiz, default.auto_generate.quiz);
        assert_eq!(empty.sync_after_commit, default.sync_after_commit);
    }

    #[test]
    fn sync_after_commit_round_trips() {
        let settings: KnowledgeSettings =
            serde_json::from_str(r#"{"sync_after_commit":true}"#).unwrap();
        assert!(settings.sync_after_commit);
        let text = serde_json::to_string(&settings).unwrap();
        let again: KnowledgeSettings = serde_json::from_str(&text).unwrap();
        assert!(again.sync_after_commit);
    }

    #[test]
    fn nested_auto_generate_flashcards_is_loaded() {
        let settings: KnowledgeSettings =
            serde_json::from_str(r#"{"auto_generate":{"flashcards":true}}"#).unwrap();
        assert!(settings.auto_generate.flashcards);
    }

    #[test]
    fn nested_auto_generate_quiz_is_loaded() {
        let settings: KnowledgeSettings =
            serde_json::from_str(r#"{"auto_generate":{"quiz":true}}"#).unwrap();
        assert!(settings.auto_generate.quiz);
        assert!(!settings.auto_generate.flashcards);
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

    #[test]
    fn study_json_reads_artifacts_and_rejects_traversal() {
        let root = temp_root("study-json");
        let study = root.join("Biology").join("study");
        fs::create_dir_all(&study).unwrap();
        fs::write(
            study.join("flashcards.json"),
            r#"{"schema_version":1,"course":"Biology","cards":[]}"#,
        )
        .unwrap();

        let value = read_study_json(
            root.to_string_lossy().into_owned(),
            "Biology".into(),
            "flashcards.json".into(),
        )
        .unwrap();

        assert_eq!(value["course"], "Biology");
        assert!(read_study_json(
            root.to_string_lossy().into_owned(),
            "Biology".into(),
            "../course.md".into(),
        )
        .is_err());
    }

    #[test]
    fn study_progress_argv_due_and_weak() {
        assert_eq!(
            build_study_progress_argv("/root", "Bio", "due", None, None, None, None).unwrap(),
            vec![
                "study-progress",
                "--root",
                "/root",
                "--course",
                "Bio",
                "due",
            ]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
        );
        assert_eq!(
            build_study_progress_argv("/root", "Bio", "weak", None, None, None, None).unwrap()[5],
            "weak"
        );
        assert_eq!(
            build_study_progress_argv("/root", "Bio", "recommend", None, None, None, None)
                .unwrap()[5],
            "recommend"
        );
    }

    #[test]
    fn study_plan_argv_builds_and_validates() {
        assert_eq!(
            build_study_plan_argv("/root", "Bio", "codex", "gpt-5", None).unwrap(),
            vec![
                "study-plan",
                "--root",
                "/root",
                "--course",
                "Bio",
                "--provider",
                "codex",
                "--model",
                "gpt-5",
            ]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
        );
        assert_eq!(
            build_study_plan_argv("/root", "Bio", "codex", "gpt-5", Some(" 2026-12-01 "))
                .unwrap()
                .last()
                .map(String::as_str),
            Some("2026-12-01")
        );
        assert!(build_study_plan_argv("/r", "C", "codex", "  ", None).is_err());
        assert!(build_study_plan_argv("/r", "C", "codex", "m", Some("bad")).is_err());
    }

    #[test]
    fn append_card_argv_builds_and_validates() {
        assert_eq!(
            build_append_card_argv(
                "/root",
                "Bio",
                "Q?",
                "A",
                "digests/a.md",
                None,
                None,
            )
            .unwrap(),
            vec![
                "append-card",
                "--root",
                "/root",
                "--course",
                "Bio",
                "--front",
                "Q?",
                "--back",
                "A",
                "--digest",
                "digests/a.md",
            ]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
        );
        assert_eq!(
            build_append_card_argv(
                "/root",
                "Bio",
                "Q",
                "A",
                "digests/a.md",
                Some(" Cells "),
                Some(" 4-5 "),
            )
            .unwrap(),
            vec![
                "append-card",
                "--root",
                "/root",
                "--course",
                "Bio",
                "--front",
                "Q",
                "--back",
                "A",
                "--digest",
                "digests/a.md",
                "--heading",
                "Cells",
                "--page",
                "4-5",
            ]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
        );
        assert!(build_append_card_argv("/r", "C", " ", "A", "d.md", None, None).is_err());
        assert!(build_append_card_argv("/r", "C", "Q", "", "d.md", None, None).is_err());
        assert!(build_append_card_argv("/r", "C", "Q", "A", "  ", None, None).is_err());
    }

    #[test]
    fn study_progress_argv_grade_and_quiz() {
        assert_eq!(
            build_study_progress_argv(
                "/root",
                "Bio",
                "grade",
                Some("fc_1"),
                Some("mastered"),
                Some("digests/a.md"),
                Some("Cells"),
            )
            .unwrap(),
            vec![
                "study-progress",
                "--root",
                "/root",
                "--course",
                "Bio",
                "grade",
                "--id",
                "fc_1",
                "--result",
                "mastered",
                "--digest",
                "digests/a.md",
                "--heading",
                "Cells",
            ]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
        );
        assert_eq!(
            build_study_progress_argv(
                "/root",
                "Bio",
                "quiz",
                Some("q_1"),
                Some("wrong"),
                None,
                None,
            )
            .unwrap(),
            vec![
                "study-progress",
                "--root",
                "/root",
                "--course",
                "Bio",
                "quiz",
                "--id",
                "q_1",
                "--result",
                "wrong",
                "--heading",
                "",
            ]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
        );
        assert!(build_study_progress_argv("/r", "C", "nope", None, None, None, None).is_err());
        assert!(build_study_progress_argv("/r", "C", "grade", None, Some("x"), None, None).is_err());
        assert!(build_study_progress_argv("/r", "C", "grade", Some("id"), None, None, None).is_err());
    }

    #[test]
    fn flashcard_progress_defaults_empty_and_round_trips() {
        let _guard = IsolatedGitIdentityGuard::with_empty_identity();
        let root = temp_root("progress");
        let root_string = root.to_string_lossy().into_owned();
        let empty = read_flashcard_progress(root_string.clone(), "Biology".into()).unwrap();
        assert_eq!(empty, serde_json::json!({}));

        let progress = serde_json::json!({
            "fc_12345678": {"seen": 2, "correct": 1, "wrong": 0}
        });
        write_flashcard_progress(root_string.clone(), "Biology".into(), progress.clone()).unwrap();

        assert_eq!(
            read_flashcard_progress(root_string, "Biology".into()).unwrap(),
            progress
        );
        assert!(root
            .join(".arbor")
            .join("users")
            .join("arbor@localhost")
            .join("local")
            .join("Biology.flashcards.json")
            .is_file());
    }

    #[test]
    fn quiz_progress_defaults_empty_and_round_trips() {
        let _guard = IsolatedGitIdentityGuard::with_empty_identity();
        let root = temp_root("quiz-progress");
        let root_string = root.to_string_lossy().into_owned();
        let empty = read_quiz_progress(root_string.clone(), "Biology".into()).unwrap();
        assert_eq!(empty, serde_json::json!({}));

        let progress = serde_json::json!({
            "q_12345678": {"seen": 2, "correct": 1, "wrong": 0}
        });
        write_quiz_progress(root_string.clone(), "Biology".into(), progress.clone()).unwrap();

        assert_eq!(
            read_quiz_progress(root_string, "Biology".into()).unwrap(),
            progress
        );
        assert!(root
            .join(".arbor")
            .join("users")
            .join("arbor@localhost")
            .join("local")
            .join("Biology.quiz.json")
            .is_file());
    }

    #[test]
    fn git_user_dirname_uses_effective_global_email() {
        let _guard = IsolatedGitIdentityGuard::with_global_email();

        let root = temp_root("git-user-global-email");
        let root_str = root.to_string_lossy().into_owned();
        let status = Command::new("git")
            .args(["-C", &root_str, "init"])
            .status()
            .expect("git init");
        assert!(status.success());

        let dirname = git_user_dirname(&root_str).unwrap();
        assert_eq!(dirname, "global-only@example.com");
    }

    #[test]
    fn chat_history_uses_fallback_user_dir_without_git_email() {
        let _guard = IsolatedGitIdentityGuard::with_empty_identity();
        let root = temp_root("chat-fallback-user");
        let root_string = root.to_string_lossy().into_owned();
        let line = serde_json::json!({
            "ts": "2026-10-17T12:00:00Z",
            "role": "user",
            "mode": "ask",
            "content": "Hello"
        });
        append_chat_lines(root_string.clone(), "Biology".into(), vec![line.clone()]).unwrap();
        let expected = root
            .join(".arbor")
            .join("users")
            .join("arbor@localhost")
            .join("chat")
            .join("Biology.jsonl");
        assert!(expected.is_file());
        assert_eq!(read_chat_history(root_string, "Biology".into()).unwrap().len(), 1);
    }

    #[test]
    fn study_artifact_stale_compares_sorted_raw_digest_bytes() {
        let root = temp_root("stale");
        let course = root.join("Biology");
        fs::create_dir_all(course.join("digests")).unwrap();
        fs::create_dir_all(course.join("study")).unwrap();
        fs::write(course.join("digests").join("b.md"), b"second").unwrap();
        fs::write(course.join("digests").join("a.md"), b"first").unwrap();
        fs::write(
            course.join("study").join("manifest.json"),
            r#"{
                "version": 1,
                "artifacts": {
                    "flashcards": {
                        "file": "flashcards.json",
                        "content_sha256": "da83f63e1a473003712c18f5afc5a79044221943d1083c7c5a7ac7236d85e8d2",
                        "generated_at": "2026-08-23T00:00:00Z"
                    }
                }
            }"#,
        )
        .unwrap();
        let root_string = root.to_string_lossy().into_owned();

        assert!(
            !study_artifact_stale(root_string.clone(), "Biology".into(), "flashcards".into(),)
                .unwrap()
        );

        fs::write(course.join("digests").join("b.md"), b"changed").unwrap();
        assert!(study_artifact_stale(root_string, "Biology".into(), "flashcards".into(),).unwrap());
    }

    #[test]
    fn list_digests_uses_h1_title_and_filename_date() {
        let root = temp_root("digest-title");
        let digests = root.join("Biology").join("digests");
        fs::create_dir_all(&digests).unwrap();
        fs::write(
            digests.join("2026-08-12.md"),
            "<!-- arbor-pages:1-4 -->\n# Glycolysis net yield\n## Overview\nNotes.\n",
        )
        .unwrap();

        let listed = list_digests(root.to_string_lossy().into_owned(), "Biology".into()).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].title, "Glycolysis net yield");
        assert_eq!(listed[0].date, "2026-08-12");
        assert_eq!(listed[0].path, "Biology/digests/2026-08-12.md");
    }

    #[test]
    fn list_courses_skips_cache_and_dot_dirs() {
        let root = temp_root("list-courses");
        fs::create_dir(root.join("Biology")).unwrap();
        fs::create_dir(root.join("Organic Chem")).unwrap();
        fs::create_dir(root.join("_arbor_cache")).unwrap();
        if !root.join("_ARBOR_CACHE").exists() {
            fs::create_dir(root.join("_ARBOR_CACHE")).unwrap();
        }
        fs::create_dir(root.join(".arbor")).unwrap();
        fs::create_dir(root.join(".git")).unwrap();
        fs::create_dir(root.join("study")).unwrap();
        fs::create_dir(root.join("digests")).unwrap();
        fs::write(root.join("notes.md"), b"# not a course\n").unwrap();

        let listed = list_courses(root.to_string_lossy().into_owned()).unwrap();
        assert_eq!(listed, vec!["Biology", "Organic Chem"]);
    }

    #[test]
    fn create_course_makes_a_folder_and_rejects_invalid_names() {
        let root = temp_root("create-course");
        let root_string = root.to_string_lossy().into_owned();
        let name =
            create_course(root_string.clone(), " Organic Chem ".into()).unwrap();
        assert_eq!(name, "Organic Chem");
        assert!(root.join("Organic Chem").is_dir());

        assert_eq!(
            create_course(root_string.clone(), "Organic Chem".into()).unwrap_err(),
            "A class named Organic Chem already exists"
        );
        assert_eq!(
            create_course(root_string.clone(), "../x".into()).unwrap_err(),
            "Invalid course name"
        );
        assert_eq!(
            create_course(root_string.clone(), " ".into()).unwrap_err(),
            "Class name cannot be empty"
        );

        for reserved in ["study", "digests", "_arbor_cache", "_ARBOR_CACHE", ".private"] {
            let error = create_course(root_string.clone(), reserved.into()).unwrap_err();
            assert!(error.contains("reserved"), "{error}");
            assert!(error.contains(reserved), "{error}");
        }
    }

    #[test]
    fn import_sources_copies_supported_files_and_replaces_same_name() {
        let root = temp_root("import");
        let course = root.join("Biology");
        fs::create_dir_all(&course).unwrap();
        let src_dir = root.join("inbox");
        fs::create_dir_all(&src_dir).unwrap();
        let first = src_dir.join("lecture.pdf");
        fs::write(&first, b"%PDF").unwrap();

        let imported = import_sources(
            root.to_string_lossy().into_owned(),
            "Biology".into(),
            vec![first.to_string_lossy().into_owned()],
        )
        .unwrap();
        assert_eq!(imported, vec!["lecture.pdf"]);
        assert!(course.join("lecture.pdf").is_file());

        fs::write(&first, b"%PDF-v2").unwrap();
        let again = import_sources(
            root.to_string_lossy().into_owned(),
            "Biology".into(),
            vec![first.to_string_lossy().into_owned()],
        )
        .unwrap();
        assert_eq!(again, vec!["lecture.pdf"]);
        assert_eq!(fs::read(course.join("lecture.pdf")).unwrap(), b"%PDF-v2");
        assert!(!course.join("lecture-2.pdf").exists());
        assert!(import_sources(
            root.to_string_lossy().into_owned(),
            "Biology".into(),
            vec![src_dir.join("notes.txt").to_string_lossy().into_owned()],
        )
        .is_err());
    }

    #[test]
    fn import_sources_replaces_existing_same_named_file() {
        let root = temp_root("import-replace");
        let course = root.join("Clin Med 2");
        fs::create_dir_all(&course).unwrap();
        fs::write(course.join("Clin Med 1.pdf"), b"%PDF-old").unwrap();

        let inbox = root.join("inbox");
        fs::create_dir_all(&inbox).unwrap();
        let incoming = inbox.join("Clin Med 1.pdf");
        fs::write(&incoming, b"%PDF-new").unwrap();

        let imported = import_sources(
            root.to_string_lossy().into_owned(),
            "Clin Med 2".into(),
            vec![incoming.to_string_lossy().into_owned()],
        )
        .unwrap();

        assert_eq!(imported, vec!["Clin Med 1.pdf"]);
        assert_eq!(
            fs::read(course.join("Clin Med 1.pdf")).unwrap(),
            b"%PDF-new"
        );
        assert!(!course.join("Clin Med 1-2.pdf").exists());
    }

    #[test]
    fn import_sources_skips_copy_when_file_already_in_course() {
        let root = temp_root("import-inplace");
        let course = root.join("Clin Med 2");
        fs::create_dir_all(&course).unwrap();
        let existing = course.join("Clin Med 1.pdf");
        fs::write(&existing, b"%PDF-existing").unwrap();

        let imported = import_sources(
            root.to_string_lossy().into_owned(),
            "Clin Med 2".into(),
            vec![existing.to_string_lossy().into_owned()],
        )
        .unwrap();

        assert_eq!(imported, vec!["Clin Med 1.pdf"]);
        assert_eq!(fs::read(&existing).unwrap(), b"%PDF-existing");
        assert!(!course.join("Clin Med 1-2.pdf").exists());
        let pdf_count = fs::read_dir(&course)
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .ok()
                    .and_then(|e| e.path().extension().map(|x| x == "pdf"))
                    .unwrap_or(false)
            })
            .count();
        assert_eq!(pdf_count, 1);
    }

    #[test]
    fn import_sources_skips_nested_file_already_in_course() {
        let root = temp_root("import-nested");
        let course = root.join("Biology");
        let nested = course.join("inbox");
        fs::create_dir_all(&nested).unwrap();
        let existing = nested.join("lecture.pdf");
        fs::write(&existing, b"%PDF-nested").unwrap();

        let imported = import_sources(
            root.to_string_lossy().into_owned(),
            "Biology".into(),
            vec![existing.to_string_lossy().into_owned()],
        )
        .unwrap();

        assert_eq!(imported, vec!["lecture.pdf"]);
        assert!(!course.join("lecture.pdf").exists());
        assert_eq!(fs::read(&existing).unwrap(), b"%PDF-nested");
    }

    #[test]
    fn import_sources_unique_names_only_for_same_batch() {
        let root = temp_root("import-batch");
        let course = root.join("Biology");
        fs::create_dir_all(&course).unwrap();
        let a = root.join("a");
        let b = root.join("b");
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();
        fs::write(a.join("lecture.pdf"), b"%PDF-a").unwrap();
        fs::write(b.join("lecture.pdf"), b"%PDF-b").unwrap();

        let imported = import_sources(
            root.to_string_lossy().into_owned(),
            "Biology".into(),
            vec![
                a.join("lecture.pdf").to_string_lossy().into_owned(),
                b.join("lecture.pdf").to_string_lossy().into_owned(),
            ],
        )
        .unwrap();

        assert_eq!(imported, vec!["lecture.pdf", "lecture-2.pdf"]);
        assert_eq!(fs::read(course.join("lecture.pdf")).unwrap(), b"%PDF-a");
        assert_eq!(fs::read(course.join("lecture-2.pdf")).unwrap(), b"%PDF-b");
    }

    #[test]
    fn import_sources_unique_names_ignore_case_in_same_batch() {
        let root = temp_root("import-case");
        let course = root.join("Biology");
        fs::create_dir_all(&course).unwrap();
        let a = root.join("a");
        let b = root.join("b");
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();
        fs::write(a.join("Lecture.pdf"), b"%PDF-a").unwrap();
        fs::write(b.join("lecture.pdf"), b"%PDF-b").unwrap();

        let imported = import_sources(
            root.to_string_lossy().into_owned(),
            "Biology".into(),
            vec![
                a.join("Lecture.pdf").to_string_lossy().into_owned(),
                b.join("lecture.pdf").to_string_lossy().into_owned(),
            ],
        )
        .unwrap();

        assert_eq!(imported, vec!["Lecture.pdf", "lecture-2.pdf"]);
        assert_eq!(fs::read(course.join("Lecture.pdf")).unwrap(), b"%PDF-a");
        assert_eq!(fs::read(course.join("lecture-2.pdf")).unwrap(), b"%PDF-b");
    }

    #[test]
    fn read_markdown_rejects_absolute_path() {
        let root = temp_root("md-abs");
        let err =
            read_markdown(root.to_string_lossy().into_owned(), "/etc/passwd".into()).unwrap_err();
        assert_eq!(err, "Invalid path");
    }

    #[test]
    fn read_markdown_rejects_parent_segments() {
        let root = temp_root("md-dotdot");
        let err = read_markdown(
            root.to_string_lossy().into_owned(),
            "Biology/../../etc/passwd".into(),
        )
        .unwrap_err();
        assert_eq!(err, "Invalid path");
    }

    #[cfg(unix)]
    #[test]
    fn read_markdown_rejects_symlink_escape() {
        let root = temp_root("md-link");
        let outside = temp_root("md-outside");
        let secret = outside.join("secret.md");
        fs::write(&secret, "secret").unwrap();
        std::os::unix::fs::symlink(&secret, root.join("leak.md")).unwrap();
        let err = read_markdown(root.to_string_lossy().into_owned(), "leak.md".into()).unwrap_err();
        assert_eq!(err, "Invalid path");
    }

    #[test]
    fn read_markdown_reads_nested_file() {
        let root = temp_root("md-ok");
        let dir = root.join("Biology").join("digests");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("note.md"), "hello").unwrap();
        let text = read_markdown(
            root.to_string_lossy().into_owned(),
            "Biology/digests/note.md".into(),
        )
        .unwrap();
        assert_eq!(text, "hello");
        let missing = read_markdown(
            root.to_string_lossy().into_owned(),
            "Biology/digests/missing.md".into(),
        )
        .unwrap_err();
        assert_eq!(missing, "File not found: Biology/digests/missing.md");
    }

    #[test]
    fn kill_and_reap_child_terminates_running_process() {
        let mut child = Command::new("sleep")
            .arg("600")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn sleep");
        kill_and_reap_child(&mut child);
        assert!(child.try_wait().unwrap().is_some());
    }

    #[test]
    fn chat_history_round_trips_and_keeps_session_line() {
        let _guard = IsolatedGitIdentityGuard::with_empty_identity();
        let root = temp_root("chat-history");
        let root_string = root.to_string_lossy().into_owned();
        let empty = read_chat_history(root_string.clone(), "Biology".into()).unwrap();
        assert!(empty.is_empty());

        let user = serde_json::json!({
            "ts": "2026-10-17T12:00:00Z",
            "role": "user",
            "mode": "ask",
            "content": "What is ATP?"
        });
        let assistant = serde_json::json!({
            "ts": "2026-10-17T12:00:01Z",
            "role": "assistant",
            "mode": "ask",
            "content": "Energy currency.",
            "supported": true,
            "citations": []
        });
        let session = serde_json::json!({
            "ts": "2026-10-17T12:01:00Z",
            "role": "session",
            "content": ""
        });
        append_chat_lines(
            root_string.clone(),
            "Biology".into(),
            vec![user.clone(), assistant.clone()],
        )
        .unwrap();
        append_chat_lines(root_string.clone(), "Biology".into(), vec![session.clone()]).unwrap();

        let read_back = read_chat_history(root_string.clone(), "Biology".into()).unwrap();
        assert_eq!(read_back.len(), 3);
        assert_eq!(read_back[2]["role"], "session");

        clear_chat_history(root_string.clone(), "Biology".into()).unwrap();
        assert!(read_chat_history(root_string.clone(), "Biology".into())
            .unwrap()
            .is_empty());
        assert!(root
            .join(".arbor")
            .join("chat")
            .join("Chemistry.jsonl")
            .exists()
            == false);
    }

    #[test]
    fn chat_history_clear_only_removes_one_course() {
        let _guard = IsolatedGitIdentityGuard::with_empty_identity();
        let root = temp_root("chat-clear");
        let root_string = root.to_string_lossy().into_owned();
        let line = serde_json::json!({
            "ts": "2026-10-17T12:00:00Z",
            "role": "user",
            "mode": "ask",
            "content": "Hi"
        });
        append_chat_lines(root_string.clone(), "Biology".into(), vec![line.clone()]).unwrap();
        append_chat_lines(root_string.clone(), "Chemistry".into(), vec![line.clone()]).unwrap();
        clear_chat_history(root_string.clone(), "Biology".into()).unwrap();
        assert!(read_chat_history(root_string.clone(), "Biology".into())
            .unwrap()
            .is_empty());
        assert_eq!(read_chat_history(root_string.clone(), "Chemistry".into()).unwrap().len(), 1);
    }

    #[test]
    fn chat_history_rejects_invalid_course_names() {
        let root = temp_root("chat-reject");
        let root_string = root.to_string_lossy().into_owned();
        let line = serde_json::json!({
            "ts": "2026-10-17T12:00:00Z",
            "role": "user",
            "mode": "ask",
            "content": "Hi"
        });
        for bad in ["../x", "foo/bar", "/abs", "study"] {
            assert!(read_chat_history(root_string.clone(), bad.into()).is_err());
            assert!(append_chat_lines(root_string.clone(), bad.into(), vec![line.clone()]).is_err());
            assert!(clear_chat_history(root_string.clone(), bad.into()).is_err());
        }
    }

    #[test]
    fn chat_worker_stdin_has_required_keys_without_write_paths() {
        let payload = chat_worker_stdin_payload(
            "/knowledge",
            "Biology",
            "What is DNA?",
            "ask",
            "fake",
            "fake-model",
            &[serde_json::json!({"role": "user", "content": "Hi"})],
        );
        assert_eq!(payload["root"], "/knowledge");
        assert_eq!(payload["course"], "Biology");
        assert_eq!(payload["question"], "What is DNA?");
        assert_eq!(payload["mode"], "ask");
        assert_eq!(payload["provider"], "fake");
        assert_eq!(payload["model"], "fake-model");
        assert!(payload.get("budget_chars").is_none());
        let text = payload.to_string();
        assert!(!text.contains("plan"));
        assert!(!text.contains(".arbor/chat"));
    }
}

#[tauri::command]
pub fn search_knowledge(
    root: String,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<SearchHit>, String> {
    search::search_documents(Path::new(&root), &query, limit.unwrap_or(25))
}

#[tauri::command]
pub fn search_semantic(
    app: tauri::AppHandle,
    root: String,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<SearchHit>, String> {
    let limit_value = limit.unwrap_or(25).to_string();
    let sub_args = [
        "embed-search",
        "--root",
        root.as_str(),
        "--query",
        query.as_str(),
        "--limit",
        limit_value.as_str(),
        "--provider",
        "hashed",
    ];
    let pairs = worker_env_pairs(&app, &sub_args);
    let refs: Vec<(&str, &str)> = pairs
        .iter()
        .map(|(key, value)| (key.as_str(), value.as_str()))
        .collect();
    search::search_semantic_documents(
        &repo_dir(&app),
        Path::new(&root),
        &query,
        limit.unwrap_or(25),
        &refs,
    )
}

#[tauri::command]
pub fn reindex_knowledge(app: tauri::AppHandle, root: String) -> Result<serde_json::Value, String> {
    run_worker_json_app(&app, &["reindex", "--root", &root])
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
    provider: Option<String>,
) -> Result<String, String> {
    let provider_id = default_provider_id(provider);
    let label = settings::provider_label(&provider_id);
    let auth = run_worker_json_app(
        &app,
        &["check-auth", "--provider", &provider_id],
    )?;
    let authenticated = auth
        .get("authenticated")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !authenticated {
        let reason = auth
            .get("reason")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| format!("{label} is not authenticated"));
        return Err(reason);
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
        provider_id,
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
    model: Option<String>,
    provider: Option<String>,
) -> Result<String, String> {
    let force = force.unwrap_or(false);
    let model = worker::normalize_study_model(model);
    let provider_id = default_provider_id(provider);
    let label = settings::provider_label(&provider_id);
    if model.is_some() {
        let auth = run_worker_json_app(
            &app,
            &["check-auth", "--provider", &provider_id],
        )?;
        let authenticated = auth
            .get("authenticated")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        if !authenticated {
            return Err(auth
                .get("reason")
                .and_then(|value| value.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| format!("{label} is not authenticated")));
        }
    }
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
        model.as_deref().unwrap_or("fake"),
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
        model,
        provider_id,
        job_id.clone(),
    );
    Ok(job_id)
}

#[tauri::command]
pub fn start_embed_job(
    app: tauri::AppHandle,
    coordinator: tauri::State<'_, SharedCoordinator>,
    root: String,
    force: Option<bool>,
) -> Result<String, String> {
    let force = force.unwrap_or(false);
    let plan_json = serde_json::to_string(&serde_json::json!({
        "op": "embed",
        "force": force,
    }))
    .map_err(|error| error.to_string())?;
    let knowledge_root = Path::new(&root);
    let job_id = jobs::create_job(knowledge_root, JobTrigger::Manual, "hashed", &plan_json)?;

    {
        let mut guard = coordinator.lock().map_err(|error| error.to_string())?;
        if let Err(error) = guard.try_begin(&job_id, &root) {
            let _ = jobs::finish_job(
                knowledge_root,
                &job_id,
                jobs::JobStatus::Failed,
                -1,
                Some(error.clone()),
            );
            return Err(error);
        }
    }

    worker::spawn_embed_stream(app.clone(), repo_dir(&app), root, force, job_id.clone());
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
    run(&[
        "commit",
        "--allow-empty",
        "-m",
        "Initialize Arbor knowledge library",
    ])?;
    Ok(true)
}
