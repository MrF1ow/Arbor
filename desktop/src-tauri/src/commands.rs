use crate::jobs::{self, JobTrigger, SharedCoordinator};
use crate::search::{self, SearchHit};
use crate::settings::{self, Settings};
use crate::watch::WatchState;
use crate::worker;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use tauri::Manager;

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
pub fn check_auth(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    worker::run_worker_json(&repo_dir(&app), &["check-auth"])
}

#[tauri::command]
pub fn list_models(
    app: tauri::AppHandle,
    root: Option<String>,
) -> Result<serde_json::Value, String> {
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
}

impl Default for KnowledgeSettings {
    fn default() -> Self {
        Self {
            delete_sources_after_digest: false,
            auto_update: false,
            auto_embed: false,
            watch_enabled: default_true(),
            auto_generate: AutoGenerate::default(),
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

const CACHE_DIR_NAME: &str = "_arbor_cache";

fn is_course_dir_name(name: &str) -> bool {
    !name.is_empty() && !name.starts_with('.') && !name.eq_ignore_ascii_case(CACHE_DIR_NAME)
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
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
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

#[tauri::command]
pub fn create_course(root: String, name: String) -> Result<String, String> {
    let name = name.trim();
    if !is_course_dir_name(name) {
        return Err("Invalid course name".into());
    }
    validate_path_component(name, "course name")?;
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
        let dest = unique_dest(&dest_dir, file_name);
        std::fs::copy(src_path, &dest).map_err(|e| e.to_string())?;
        imported.push(
            dest.file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
        );
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

fn validate_path_component(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty() || value.contains('/') || value.contains('\\') || value.contains("..") {
        return Err(format!("Invalid {label}"));
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
    Ok(Path::new(root)
        .join(".arbor")
        .join("progress")
        .join(format!("{course}.flashcards.json")))
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
    Ok(Path::new(root)
        .join(".arbor")
        .join("progress")
        .join(format!("{course}.quiz.json")))
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
        assert!(!ks.auto_embed);
        assert!(!ks.delete_sources_after_digest);
        assert!(!ks.auto_generate.flashcards);
        assert!(!ks.auto_generate.quiz);
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
    fn flashcard_progress_defaults_empty_and_round_trips() {
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
            .join("progress")
            .join("Biology.flashcards.json")
            .is_file());
    }

    #[test]
    fn quiz_progress_defaults_empty_and_round_trips() {
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
            .join("progress")
            .join("Biology.quiz.json")
            .is_file());
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
        fs::write(root.join("notes.md"), b"# not a course\n").unwrap();

        let listed = list_courses(root.to_string_lossy().into_owned()).unwrap();
        assert_eq!(listed, vec!["Biology", "Organic Chem"]);
    }

    #[test]
    fn create_course_makes_a_folder_and_rejects_duplicates() {
        let root = temp_root("create-course");
        let name =
            create_course(root.to_string_lossy().into_owned(), " Organic Chem ".into()).unwrap();
        assert_eq!(name, "Organic Chem");
        assert!(root.join("Organic Chem").is_dir());
        assert!(create_course(root.to_string_lossy().into_owned(), "Organic Chem".into()).is_err());
        assert!(create_course(root.to_string_lossy().into_owned(), "../x".into()).is_err());
        assert!(create_course(root.to_string_lossy().into_owned(), "_arbor_cache".into()).is_err());
        assert!(create_course(root.to_string_lossy().into_owned(), "_ARBOR_CACHE".into()).is_err());
    }

    #[test]
    fn import_sources_copies_supported_files_with_unique_names() {
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

        let again = import_sources(
            root.to_string_lossy().into_owned(),
            "Biology".into(),
            vec![first.to_string_lossy().into_owned()],
        )
        .unwrap();
        assert_eq!(again, vec!["lecture-2.pdf"]);
        assert!(course.join("lecture-2.pdf").is_file());
        assert!(import_sources(
            root.to_string_lossy().into_owned(),
            "Biology".into(),
            vec![src_dir.join("notes.txt").to_string_lossy().into_owned()],
        )
        .is_err());
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
    search::search_semantic_documents(
        &repo_dir(&app),
        Path::new(&root),
        &query,
        limit.unwrap_or(25),
    )
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
    model: Option<String>,
) -> Result<String, String> {
    let force = force.unwrap_or(false);
    let model = worker::normalize_study_model(model);
    if model.is_some() {
        let auth = worker::run_worker_json(&repo_dir(&app), &["check-auth"])?;
        let authenticated = auth
            .get("authenticated")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        if !authenticated {
            return Err(auth
                .get("reason")
                .and_then(|value| value.as_str())
                .unwrap_or("Codex CLI is not authenticated")
                .to_string());
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
