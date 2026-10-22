use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs::{self, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use crate::commands::{
    chat_history_path, git_user_dirname, validate_chat_course, validate_chat_line_role,
    validate_chat_mode,
};

static THREAD_ID_COUNTER: AtomicU64 = AtomicU64::new(0);

static CHAT_INDEX_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn index_lock() -> &'static Mutex<()> {
    CHAT_INDEX_LOCK.get_or_init(|| Mutex::new(()))
}

async fn spawn_blocking_cmd<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

async fn spawn_blocking_cmd_unit<F>(f: F) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String> + Send + 'static,
{
    spawn_blocking_cmd(f).await
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ThreadMeta {
    pub id: String,
    pub title: String,
    pub mode: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct ChatIndex {
    version: u32,
    threads: Vec<ThreadMeta>,
}

pub fn title_from_user_message(content: &str) -> String {
    let collapsed = content.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= 60 {
        return collapsed;
    }
    let mut char_count = 0;
    let mut cut_byte = 0;
    for (idx, ch) in collapsed.char_indices() {
        if char_count >= 60 {
            break;
        }
        char_count += 1;
        cut_byte = idx + ch.len_utf8();
    }
    let cut = &collapsed[..cut_byte];
    if let Some(last_space) = cut.rfind(' ') {
        if last_space > 0 {
            return format!("{}…", &cut[..last_space]);
        }
    }
    format!("{cut}…")
}

fn validate_thread_id(thread: &str) -> Result<(), String> {
    if thread.contains("..") || thread.contains('/') || thread.contains('\\') {
        return Err("Invalid thread id".into());
    }
    let bytes = thread.as_bytes();
    if bytes.len() != 25 {
        return Err("Invalid thread id".into());
    }
    if !thread.starts_with("t-") {
        return Err("Invalid thread id".into());
    }
    let body = &thread[2..];
    let parts: Vec<&str> = body.split('-').collect();
    if parts.len() != 2 || parts[1].len() != 6 {
        return Err("Invalid thread id".into());
    }
    let stamp = parts[0];
    if stamp.len() != 16 || !stamp.ends_with('Z') {
        return Err("Invalid thread id".into());
    }
    let digits = &stamp[..15];
    if digits.as_bytes()[8] != b'T' {
        return Err("Invalid thread id".into());
    }
    for (i, ch) in digits.chars().enumerate() {
        if i == 8 {
            if ch != 'T' {
                return Err("Invalid thread id".into());
            }
        } else if !ch.is_ascii_digit() {
            return Err("Invalid thread id".into());
        }
    }
    if !parts[1].chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()) {
        return Err("Invalid thread id".into());
    }
    Ok(())
}

fn random_hex6() -> String {
    let mut hasher = DefaultHasher::new();
    std::time::SystemTime::now().hash(&mut hasher);
    std::process::id().hash(&mut hasher);
    THREAD_ID_COUNTER
        .fetch_add(1, Ordering::Relaxed)
        .hash(&mut hasher);
    format!("{:06x}", (hasher.finish() as u32) & 0xffffff)
}

fn utc_now_rfc3339() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%SZ%.3f").to_string()
}

fn sort_threads(threads: &mut [ThreadMeta]) {
    threads.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| b.created_at.cmp(&a.created_at))
            .then_with(|| b.id.cmp(&a.id))
    });
}

fn thread_jsonl_exists(course_dir: &Path, id: &str) -> bool {
    course_dir.join(format!("{id}.jsonl")).is_file()
}

fn allocate_thread_id(
    index: &ChatIndex,
    course_dir: &Path,
    ts: Option<&str>,
    reserved: &HashSet<String>,
) -> Result<String, String> {
    for _ in 0..128 {
        let id = if let Some(ts) = ts {
            new_thread_id_from_ts(ts)
        } else {
            new_thread_id_now()
        };
        if reserved.contains(&id) || index.threads.iter().any(|entry| entry.id == id) {
            continue;
        }
        if thread_jsonl_exists(course_dir, &id) {
            continue;
        }
        return Ok(id);
    }
    Err("Could not allocate a unique thread id".into())
}

fn rename_legacy_chat_file(root: &str, course: &str) -> Result<(), String> {
    let legacy_path = chat_history_path(root, course)?;
    if !legacy_path.is_file() {
        return Ok(());
    }
    let migrated_name = format!("{course}.jsonl.migrated");
    let migrated_path = legacy_path
        .parent()
        .ok_or_else(|| "Invalid chat history path".to_string())?
        .join(migrated_name);
    fs::rename(&legacy_path, &migrated_path).map_err(|e| e.to_string())?;
    Ok(())
}

fn remove_orphan_thread_files(course_dir: &Path) -> Result<(), String> {
    if !course_dir.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(course_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with("t-") && name.ends_with(".jsonl") {
            fs::remove_file(entry.path()).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn compact_timestamp_for_id(ts: &str) -> Option<String> {
    let ts = ts.trim();
    if ts.len() < 19 {
        return None;
    }
    if ts.as_bytes().get(10) != Some(&b'T') {
        return None;
    }
    let y = &ts[0..4];
    let m = &ts[5..7];
    let d = &ts[8..10];
    let h = &ts[11..13];
    let min = &ts[14..16];
    let sec = &ts[17..19];
    if ![y, m, d, h, min, sec]
        .iter()
        .all(|part| part.chars().all(|c| c.is_ascii_digit()))
    {
        return None;
    }
    Some(format!("{y}{m}{d}T{h}{min}{sec}Z"))
}

fn new_thread_id_from_ts(ts: &str) -> String {
    let compact = compact_timestamp_for_id(ts).unwrap_or_else(|| {
        Utc::now().format("%Y%m%dT%H%M%SZ").to_string()
    });
    format!("t-{compact}-{}", random_hex6())
}

fn new_thread_id_now() -> String {
    let compact = Utc::now().format("%Y%m%dT%H%M%SZ");
    format!("t-{compact}-{}", random_hex6())
}

fn chat_course_dir(root: &str, course: &str) -> Result<PathBuf, String> {
    validate_chat_course(course)?;
    let dirname = git_user_dirname(root)?;
    let path = Path::new(root)
        .join(".arbor")
        .join("users")
        .join(&dirname)
        .join("chat")
        .join(course);
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("Invalid course name".into());
    }
    Ok(path)
}

fn index_path(root: &str, course: &str) -> Result<PathBuf, String> {
    Ok(chat_course_dir(root, course)?.join("index.json"))
}

fn thread_jsonl_path(root: &str, course: &str, thread: &str) -> Result<PathBuf, String> {
    validate_thread_id(thread)?;
    Ok(chat_course_dir(root, course)?.join(format!("{thread}.jsonl")))
}

fn read_index_file(path: &Path) -> Result<ChatIndex, String> {
    if !path.is_file() {
        return Ok(ChatIndex {
            version: 1,
            threads: Vec::new(),
        });
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

fn write_index_atomic(dir: &Path, index: &ChatIndex) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = dir.join("index.json");
    let tmp = dir.join(".index.json.tmp");
    let bytes = serde_json::to_vec(index).map_err(|e| e.to_string())?;
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

fn segment_has_dialogue(segment: &[serde_json::Value]) -> bool {
    segment
        .iter()
        .any(|line| line.get("role").and_then(|r| r.as_str()) == Some("user")
            || line.get("role").and_then(|r| r.as_str()) == Some("assistant"))
}

fn mode_from_segment(segment: &[serde_json::Value]) -> String {
    for line in segment.iter().rev() {
        if line.get("role").and_then(|r| r.as_str()) == Some("user") {
            if let Some(mode) = line.get("mode").and_then(|m| m.as_str()) {
                if mode == "ask" || mode == "explain" {
                    return mode.to_string();
                }
            }
        }
    }
    "ask".to_string()
}

fn title_from_segment(segment: &[serde_json::Value]) -> String {
    for line in segment {
        if line.get("role").and_then(|r| r.as_str()) == Some("user") {
            if let Some(content) = line.get("content").and_then(|c| c.as_str()) {
                return title_from_user_message(content);
            }
        }
    }
    "New chat".to_string()
}

fn ts_from_line(line: &serde_json::Value) -> Option<String> {
    line.get("ts")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn ensure_migrated(root: &str, course: &str) -> Result<(), String> {
    let _guard = index_lock().lock().map_err(|e| e.to_string())?;
    let course_dir = chat_course_dir(root, course)?;
    let index_file = course_dir.join("index.json");
    let legacy_path = chat_history_path(root, course)?;
    if index_file.is_file() {
        if legacy_path.is_file() {
            rename_legacy_chat_file(root, course)?;
        }
        return Ok(());
    }
    if !legacy_path.is_file() {
        return Ok(());
    }
    remove_orphan_thread_files(&course_dir)?;
    let text = fs::read_to_string(&legacy_path).map_err(|e| e.to_string())?;
    let mut all_lines: Vec<serde_json::Value> = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str(line) {
            all_lines.push(value);
        }
    }

    let mut segments: Vec<Vec<serde_json::Value>> = vec![];
    let mut current = Vec::new();
    for line in all_lines {
        if line.get("role").and_then(|r| r.as_str()) == Some("session") {
            if !current.is_empty() {
                segments.push(current);
                current = Vec::new();
            }
        } else {
            current.push(line);
        }
    }
    if !current.is_empty() {
        segments.push(current);
    }

    let mut threads = Vec::new();
    let mut reserved_ids = HashSet::new();
    for segment in segments {
        if !segment_has_dialogue(&segment) {
            continue;
        }
        let created_at = segment
            .first()
            .and_then(ts_from_line)
            .unwrap_or_else(utc_now_rfc3339);
        let updated_at = segment
            .last()
            .and_then(ts_from_line)
            .unwrap_or_else(|| created_at.clone());
        let id = allocate_thread_id(
            &ChatIndex {
                version: 1,
                threads: threads.clone(),
            },
            &course_dir,
            Some(&created_at),
            &reserved_ids,
        )?;
        reserved_ids.insert(id.clone());
        let mode = mode_from_segment(&segment);
        let title = title_from_segment(&segment);
        let meta = ThreadMeta {
            id: id.clone(),
            title,
            mode,
            created_at,
            updated_at,
        };
        let jsonl_path = course_dir.join(format!("{id}.jsonl"));
        fs::create_dir_all(&course_dir).map_err(|e| e.to_string())?;
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&jsonl_path)
            .map_err(|e| e.to_string())?;
        for line in segment {
            if line.get("role").and_then(|r| r.as_str()) == Some("user")
                || line.get("role").and_then(|r| r.as_str()) == Some("assistant")
            {
                let mut bytes = serde_json::to_vec(&line).map_err(|e| e.to_string())?;
                bytes.push(b'\n');
                file.write_all(&bytes).map_err(|e| e.to_string())?;
            }
        }
        threads.push(meta);
    }

    write_index_atomic(
        &course_dir,
        &ChatIndex {
            version: 1,
            threads,
        },
    )?;

    rename_legacy_chat_file(root, course)?;
    Ok(())
}

fn find_thread_mut<'a>(index: &'a mut ChatIndex, thread: &str) -> Result<&'a mut ThreadMeta, String> {
    index
        .threads
        .iter_mut()
        .find(|entry| entry.id == thread)
        .ok_or_else(|| "Thread not found".to_string())
}

fn read_thread_lines(path: &Path) -> Result<Vec<serde_json::Value>, String> {
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
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
pub async fn list_chat_threads(root: String, course: String) -> Result<Vec<ThreadMeta>, String> {
    spawn_blocking_cmd(move || {
        ensure_migrated(&root, &course)?;
        let _guard = index_lock().lock().map_err(|e| e.to_string())?;
        let index = read_index_file(&index_path(&root, &course)?)?;
        let mut threads = index.threads;
        sort_threads(&mut threads);
        Ok(threads)
    })
    .await
}

#[tauri::command]
pub async fn create_chat_thread(
    root: String,
    course: String,
    mode: String,
) -> Result<ThreadMeta, String> {
    spawn_blocking_cmd(move || {
        validate_chat_mode(&mode)?;
        ensure_migrated(&root, &course)?;
        let _guard = index_lock().lock().map_err(|e| e.to_string())?;
        let course_dir = chat_course_dir(&root, &course)?;
        let mut index = read_index_file(&course_dir.join("index.json"))?;
        let now = utc_now_rfc3339();
        let id = allocate_thread_id(&index, &course_dir, None, &HashSet::new())?;
        let meta = ThreadMeta {
            id,
            title: "New chat".to_string(),
            mode,
            created_at: now.clone(),
            updated_at: now,
        };
        index.threads.push(meta.clone());
        write_index_atomic(&course_dir, &index)?;
        Ok(meta)
    })
    .await
}

#[tauri::command]
pub async fn read_chat_thread(
    root: String,
    course: String,
    thread: String,
) -> Result<Vec<serde_json::Value>, String> {
    spawn_blocking_cmd(move || {
        validate_thread_id(&thread)?;
        ensure_migrated(&root, &course)?;
        let path = thread_jsonl_path(&root, &course, &thread)?;
        read_thread_lines(&path)
    })
    .await
}

#[tauri::command]
pub async fn append_chat_thread_lines(
    root: String,
    course: String,
    thread: String,
    lines: Vec<serde_json::Value>,
) -> Result<ThreadMeta, String> {
    spawn_blocking_cmd(move || {
        validate_thread_id(&thread)?;
        for line in &lines {
            validate_chat_line_role(line)?;
        }
        ensure_migrated(&root, &course)?;
        let _guard = index_lock().lock().map_err(|e| e.to_string())?;
        let course_dir = chat_course_dir(&root, &course)?;
        let mut index = read_index_file(&course_dir.join("index.json"))?;
        let entry = find_thread_mut(&mut index, &thread)?.clone();
        let mut entry = entry;
        let jsonl_path = course_dir.join(format!("{thread}.jsonl"));
        let parent = jsonl_path
            .parent()
            .ok_or_else(|| "Invalid chat thread path".to_string())?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&jsonl_path)
            .map_err(|e| e.to_string())?;
        for line in &lines {
            let mut bytes = serde_json::to_vec(line).map_err(|e| e.to_string())?;
            bytes.push(b'\n');
            file.write_all(&bytes).map_err(|e| e.to_string())?;
            if entry.title == "New chat" && line.get("role").and_then(|r| r.as_str()) == Some("user")
            {
                if let Some(content) = line.get("content").and_then(|c| c.as_str()) {
                    entry.title = title_from_user_message(content);
                }
            }
        }
        entry.updated_at = utc_now_rfc3339();
        let pos = index
            .threads
            .iter()
            .position(|t| t.id == thread)
            .ok_or_else(|| "Thread not found".to_string())?;
        index.threads[pos] = entry.clone();
        write_index_atomic(&course_dir, &index)?;
        Ok(entry)
    })
    .await
}

#[tauri::command]
pub async fn rename_chat_thread(
    root: String,
    course: String,
    thread: String,
    title: String,
) -> Result<ThreadMeta, String> {
    spawn_blocking_cmd(move || {
        validate_thread_id(&thread)?;
        let trimmed = title.trim();
        let char_count = trimmed.chars().count();
        if char_count < 1 || char_count > 120 {
            return Err("Title must be 1–120 characters".into());
        }
        ensure_migrated(&root, &course)?;
        let _guard = index_lock().lock().map_err(|e| e.to_string())?;
        let course_dir = chat_course_dir(&root, &course)?;
        let mut index = read_index_file(&course_dir.join("index.json"))?;
        let entry = find_thread_mut(&mut index, &thread)?;
        entry.title = trimmed.to_string();
        entry.updated_at = utc_now_rfc3339();
        let updated = entry.clone();
        write_index_atomic(&course_dir, &index)?;
        Ok(updated)
    })
    .await
}

#[tauri::command]
pub async fn set_chat_thread_mode(
    root: String,
    course: String,
    thread: String,
    mode: String,
) -> Result<ThreadMeta, String> {
    spawn_blocking_cmd(move || {
        validate_thread_id(&thread)?;
        validate_chat_mode(&mode)?;
        ensure_migrated(&root, &course)?;
        let _guard = index_lock().lock().map_err(|e| e.to_string())?;
        let course_dir = chat_course_dir(&root, &course)?;
        let mut index = read_index_file(&course_dir.join("index.json"))?;
        let entry = find_thread_mut(&mut index, &thread)?;
        entry.mode = mode;
        entry.updated_at = utc_now_rfc3339();
        let updated = entry.clone();
        write_index_atomic(&course_dir, &index)?;
        Ok(updated)
    })
    .await
}

#[tauri::command]
pub async fn delete_chat_thread(
    root: String,
    course: String,
    thread: String,
) -> Result<(), String> {
    spawn_blocking_cmd_unit(move || {
        validate_thread_id(&thread)?;
        ensure_migrated(&root, &course)?;
        let _guard = index_lock().lock().map_err(|e| e.to_string())?;
        let course_dir = chat_course_dir(&root, &course)?;
        let mut index = read_index_file(&course_dir.join("index.json"))?;
        let before = index.threads.len();
        index.threads.retain(|entry| entry.id != thread);
        if index.threads.len() == before {
            return Err("Thread not found".into());
        }
        write_index_atomic(&course_dir, &index)?;
        let jsonl = course_dir.join(format!("{thread}.jsonl"));
        if jsonl.is_file() {
            fs::remove_file(&jsonl).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn delete_all_chat_threads(root: String, course: String) -> Result<(), String> {
    spawn_blocking_cmd_unit(move || {
        ensure_migrated(&root, &course)?;
        let _guard = index_lock().lock().map_err(|e| e.to_string())?;
        let course_dir = chat_course_dir(&root, &course)?;
        if course_dir.is_dir() {
            fs::remove_dir_all(&course_dir).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::MutexGuard;

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
            let mutex = crate::GIT_IDENTITY_TEST_LOCK.lock().unwrap();
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
    }

    impl Drop for IsolatedGitIdentityGuard {
        fn drop(&mut self) {
            restore_optional_env("HOME", self.saved_home.take());
            restore_optional_env("GIT_CONFIG_GLOBAL", self.saved_git_config_global.take());
            restore_optional_env("GIT_CONFIG_NOSYSTEM", self.saved_git_config_nosystem.take());
        }
    }

    fn temp_root(label: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "arbor-chat-threads-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        base
    }

    fn block_on_cmd<T>(future: impl std::future::Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    #[test]
    fn title_from_user_message_collapses_and_truncates() {
        assert_eq!(title_from_user_message("  hello   world  "), "hello world");
        let long = "word ".repeat(20);
        let title = title_from_user_message(long.trim());
        assert!(title.chars().count() <= 61);
        assert!(title.ends_with('…'));
    }

    #[test]
    fn create_append_title_and_updated_at() {
        let _guard = IsolatedGitIdentityGuard::with_empty_identity();
        let root = temp_root("create-append");
        let root_string = root.to_string_lossy().into_owned();
        let created = block_on_cmd(create_chat_thread(
            root_string.clone(),
            "Biology".into(),
            "ask".into(),
        ))
        .unwrap();
        assert_eq!(created.title, "New chat");
        let user = serde_json::json!({
            "ts": "2026-10-17T12:00:00Z",
            "role": "user",
            "mode": "ask",
            "content": "What is ATP?"
        });
        let updated = block_on_cmd(append_chat_thread_lines(
            root_string.clone(),
            "Biology".into(),
            created.id.clone(),
            vec![user],
        ))
        .unwrap();
        assert_eq!(updated.title, "What is ATP?");
        assert!(updated.updated_at >= created.updated_at);
    }

    #[test]
    fn list_orders_by_updated_at_desc() {
        let _guard = IsolatedGitIdentityGuard::with_empty_identity();
        let root = temp_root("list-order");
        let root_string = root.to_string_lossy().into_owned();
        let a = block_on_cmd(create_chat_thread(
            root_string.clone(),
            "Biology".into(),
            "ask".into(),
        ))
        .unwrap();
        let b = block_on_cmd(create_chat_thread(
            root_string.clone(),
            "Biology".into(),
            "explain".into(),
        ))
        .unwrap();
        let user = serde_json::json!({
            "ts": "2026-10-17T12:00:00Z",
            "role": "user",
            "mode": "explain",
            "content": "Bump b"
        });
        block_on_cmd(append_chat_thread_lines(
            root_string.clone(),
            "Biology".into(),
            b.id.clone(),
            vec![user],
        ))
        .unwrap();
        let listed = block_on_cmd(list_chat_threads(root_string, "Biology".into())).unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].id, b.id);
        assert_eq!(listed[1].id, a.id);
    }

    #[test]
    fn rename_validation() {
        let _guard = IsolatedGitIdentityGuard::with_empty_identity();
        let root = temp_root("rename");
        let root_string = root.to_string_lossy().into_owned();
        let created = block_on_cmd(create_chat_thread(
            root_string.clone(),
            "Biology".into(),
            "ask".into(),
        ))
        .unwrap();
        assert!(block_on_cmd(rename_chat_thread(
            root_string.clone(),
            "Biology".into(),
            created.id.clone(),
            "   ".into(),
        ))
        .is_err());
        let long = "x".repeat(121);
        assert!(block_on_cmd(rename_chat_thread(
            root_string.clone(),
            "Biology".into(),
            created.id.clone(),
            long,
        ))
        .is_err());
        let renamed = block_on_cmd(rename_chat_thread(
            root_string.clone(),
            "Biology".into(),
            created.id.clone(),
            "  Membrane transport  ".into(),
        ))
        .unwrap();
        assert_eq!(renamed.title, "Membrane transport");
    }

    #[test]
    fn delete_and_delete_all() {
        let _guard = IsolatedGitIdentityGuard::with_empty_identity();
        let root = temp_root("delete");
        let root_string = root.to_string_lossy().into_owned();
        let created = block_on_cmd(create_chat_thread(
            root_string.clone(),
            "Biology".into(),
            "ask".into(),
        ))
        .unwrap();
        block_on_cmd(delete_chat_thread(
            root_string.clone(),
            "Biology".into(),
            created.id,
        ))
        .unwrap();
        assert!(block_on_cmd(list_chat_threads(root_string.clone(), "Biology".into()))
            .unwrap()
            .is_empty());
        let again = block_on_cmd(create_chat_thread(
            root_string.clone(),
            "Biology".into(),
            "ask".into(),
        ))
        .unwrap();
        assert!(!again.id.is_empty());
        block_on_cmd(delete_all_chat_threads(root_string.clone(), "Biology".into())).unwrap();
        assert!(!chat_course_dir(&root_string, "Biology").unwrap().exists());
    }

    #[test]
    fn invalid_thread_ids_rejected() {
        let _guard = IsolatedGitIdentityGuard::with_empty_identity();
        let root = temp_root("reject-id");
        let root_string = root.to_string_lossy().into_owned();
        for bad in [
            "../escape",
            "t-20261017T120000Z-abc",
            "t-20261017T120000Z-ABCDEF",
            "not-a-thread",
        ] {
            assert!(block_on_cmd(read_chat_thread(
                root_string.clone(),
                "Biology".into(),
                bad.into(),
            ))
            .is_err());
        }
        for bad in ["../x", "foo/bar", "/abs", "study"] {
            assert!(block_on_cmd(list_chat_threads(root_string.clone(), bad.into())).is_err());
        }
    }

    #[test]
    fn migration_splits_legacy_file() {
        let _guard = IsolatedGitIdentityGuard::with_empty_identity();
        let root = temp_root("migrate");
        let root_string = root.to_string_lossy().into_owned();
        let legacy = chat_history_path(&root_string, "Biology").unwrap();
        fs::create_dir_all(legacy.parent().unwrap()).unwrap();
        let lines = [
            serde_json::json!({"ts":"2026-10-17T10:00:00Z","role":"session","content":""}),
            serde_json::json!({"ts":"2026-10-17T10:00:01Z","role":"note","content":"orphan"}),
            serde_json::json!({"ts":"2026-10-17T11:00:00Z","role":"session","content":""}),
            serde_json::json!({"ts":"2026-10-17T11:00:01Z","role":"user","mode":"quiz","content":"Quiz mode question"}),
            serde_json::json!({"ts":"2026-10-17T11:00:02Z","role":"assistant","mode":"quiz","content":"Quiz answer"}),
            serde_json::json!({"ts":"2026-10-17T12:00:00Z","role":"session","content":""}),
            serde_json::json!({"ts":"2026-10-17T12:00:01Z","role":"user","mode":"explain","content":"Normal explain question"}),
            serde_json::json!({"ts":"2026-10-17T12:00:02Z","role":"assistant","mode":"explain","content":"Normal answer"}),
        ];
        let mut body = String::new();
        for line in lines {
            body.push_str(&serde_json::to_string(&line).unwrap());
            body.push('\n');
        }
        fs::write(&legacy, body).unwrap();

        let listed = block_on_cmd(list_chat_threads(root_string.clone(), "Biology".into())).unwrap();
        assert_eq!(listed.len(), 2);
        let titles: Vec<_> = listed.iter().map(|t| t.title.as_str()).collect();
        assert!(titles.contains(&"Quiz mode question"));
        assert!(titles.contains(&"Normal explain question"));
        let explain = listed
            .iter()
            .find(|t| t.title == "Normal explain question")
            .unwrap();
        assert_eq!(explain.mode, "explain");
        let quiz = listed.iter().find(|t| t.title == "Quiz mode question").unwrap();
        assert_eq!(quiz.mode, "ask");
        assert!(legacy.with_file_name("Biology.jsonl.migrated").is_file());
        assert!(!legacy.is_file());
        let again = block_on_cmd(list_chat_threads(root_string, "Biology".into())).unwrap();
        assert_eq!(again.len(), 2);
    }

    #[test]
    fn migration_renames_legacy_when_index_already_exists() {
        let _guard = IsolatedGitIdentityGuard::with_empty_identity();
        let root = temp_root("migrate-index-legacy");
        let root_string = root.to_string_lossy().into_owned();
        let course_dir = chat_course_dir(&root_string, "Biology").unwrap();
        fs::create_dir_all(&course_dir).unwrap();
        let legacy = chat_history_path(&root_string, "Biology").unwrap();
        fs::create_dir_all(legacy.parent().unwrap()).unwrap();
        fs::write(&legacy, "{\"role\":\"session\"}\n").unwrap();
        fs::write(
            course_dir.join("index.json"),
            r#"{"version":1,"threads":[]}"#,
        )
        .unwrap();

        block_on_cmd(list_chat_threads(root_string.clone(), "Biology".into())).unwrap();
        assert!(!legacy.is_file());
        assert!(legacy.with_file_name("Biology.jsonl.migrated").is_file());
    }

    #[test]
    fn migration_retry_does_not_duplicate_orphan_thread_files() {
        let _guard = IsolatedGitIdentityGuard::with_empty_identity();
        let root = temp_root("migrate-orphan-retry");
        let root_string = root.to_string_lossy().into_owned();
        let course_dir = chat_course_dir(&root_string, "Biology").unwrap();
        fs::create_dir_all(&course_dir).unwrap();
        let legacy = chat_history_path(&root_string, "Biology").unwrap();
        fs::create_dir_all(legacy.parent().unwrap()).unwrap();
        fs::write(
            &legacy,
            concat!(
                "{\"ts\":\"2026-10-17T10:00:00Z\",\"role\":\"session\"}\n",
                "{\"ts\":\"2026-10-17T10:00:01Z\",\"role\":\"user\",\"mode\":\"ask\",\"content\":\"One\"}\n",
                "{\"ts\":\"2026-10-17T10:00:02Z\",\"role\":\"assistant\",\"mode\":\"ask\",\"content\":\"A\"}\n",
            ),
        )
        .unwrap();
        fs::write(
            course_dir.join("t-20261017T100001Z-dead01.jsonl"),
            "{\"role\":\"user\",\"content\":\"orphan\"}\n",
        )
        .unwrap();

        let listed = block_on_cmd(list_chat_threads(root_string.clone(), "Biology".into())).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].title, "One");
        let jsonls: Vec<_> = fs::read_dir(&course_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".jsonl"))
            .collect();
        assert_eq!(jsonls.len(), 1);
    }
}
