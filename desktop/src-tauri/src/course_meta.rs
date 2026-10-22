use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use crate::commands::validate_path_component;

static COURSE_META_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn meta_lock() -> &'static Mutex<()> {
    COURSE_META_LOCK.get_or_init(|| Mutex::new(()))
}

fn courses_json_path(root: &str) -> PathBuf {
    Path::new(root).join(".arbor").join("courses.json")
}

fn validate_meta_token(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 40 {
        return Err(format!("Invalid {label}"));
    }
    if !value
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(format!("Invalid {label}"));
    }
    Ok(())
}

fn empty_courses_map() -> Value {
    json!({})
}

fn read_courses_map_from_disk(path: &Path) -> Value {
    if !path.is_file() {
        return empty_courses_map();
    }
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(_) => return empty_courses_map(),
    };
    let doc: Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return empty_courses_map(),
    };
    doc.get("courses")
        .and_then(|c| c.as_object())
        .cloned()
        .map(|m| Value::Object(m))
        .unwrap_or_else(empty_courses_map)
}

fn read_full_document(path: &Path) -> Value {
    if !path.is_file() {
        return json!({ "version": 1, "courses": {} });
    }
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(_) => return json!({ "version": 1, "courses": {} }),
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(mut doc) => {
            if !doc.get("courses").and_then(|c| c.as_object()).is_some() {
                doc["courses"] = json!({});
            }
            if doc.get("version").is_none() {
                doc["version"] = json!(1);
            }
            doc
        }
        Err(_) => json!({ "version": 1, "courses": {} }),
    }
}

fn write_courses_atomic(path: &Path, doc: &Value) -> Result<(), String> {
    let dir = path.parent().ok_or_else(|| "Invalid courses path".to_string())?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(".courses.json.tmp");
    let bytes = serde_json::to_vec_pretty(doc).map_err(|e| e.to_string())?;
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

fn entry_has_icon_or_color(entry: &Map<String, Value>) -> bool {
    entry.contains_key("icon") || entry.contains_key("color")
}

pub fn read_course_meta_sync(root: &str) -> Value {
    let path = courses_json_path(root);
    read_courses_map_from_disk(&path)
}

pub fn set_course_meta_sync(
    root: &str,
    course: &str,
    icon: Option<String>,
    color: Option<String>,
) -> Result<Value, String> {
    validate_path_component(course, "course name")?;
    if let Some(ref v) = icon {
        validate_meta_token(v, "icon")?;
    }
    if let Some(ref v) = color {
        validate_meta_token(v, "color")?;
    }

    let _guard = meta_lock().lock().map_err(|e| e.to_string())?;
    let path = courses_json_path(root);
    let mut doc = read_full_document(&path);
    let courses = doc
        .as_object_mut()
        .and_then(|d| d.get_mut("courses"))
        .and_then(|c| c.as_object_mut())
        .ok_or_else(|| "Invalid courses document".to_string())?;

    let mut entry = courses
        .remove(course)
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();

    match icon {
        None => {
            entry.remove("icon");
        }
        Some(v) => {
            entry.insert("icon".into(), Value::String(v));
        }
    }
    match color {
        None => {
            entry.remove("color");
        }
        Some(v) => {
            entry.insert("color".into(), Value::String(v));
        }
    }

    if entry_has_icon_or_color(&entry) {
        courses.insert(course.into(), Value::Object(entry));
    }

    write_courses_atomic(&path, &doc)?;
    Ok(read_courses_map_from_disk(&path))
}

#[tauri::command]
pub async fn read_course_meta(root: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(read_course_meta_sync(&root)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_course_meta(
    root: String,
    course: String,
    icon: Option<String>,
    color: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        set_course_meta_sync(&root, &course, icon, color)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("arbor-course-meta-{label}-{nanos}"))
    }

    #[test]
    fn round_trip_icon_and_color() {
        let root = temp_root("round");
        fs::create_dir_all(root.join(".arbor")).unwrap();
        let root_s = root.to_string_lossy().into_owned();
        let map = set_course_meta_sync(
            &root_s,
            "cell-biology",
            Some("flask-conical".into()),
            Some("olive".into()),
        )
        .unwrap();
        assert_eq!(
            map.get("cell-biology")
                .and_then(|e| e.get("icon"))
                .and_then(|v| v.as_str()),
            Some("flask-conical")
        );
        let again = read_course_meta_sync(&root_s);
        assert_eq!(map, again);
    }

    #[test]
    fn clear_removes_entry() {
        let root = temp_root("clear");
        fs::create_dir_all(root.join(".arbor")).unwrap();
        let root_s = root.to_string_lossy().into_owned();
        set_course_meta_sync(
            &root_s,
            "bio",
            Some("leaf".into()),
            Some("moss".into()),
        )
        .unwrap();
        let cleared = set_course_meta_sync(&root_s, "bio", None, None).unwrap();
        assert!(cleared.as_object().unwrap().get("bio").is_none());
    }

    #[test]
    fn invalid_course_and_icon_rejected() {
        let root = temp_root("invalid");
        fs::create_dir_all(root.join(".arbor")).unwrap();
        let root_s = root.to_string_lossy().into_owned();
        assert!(set_course_meta_sync(
            &root_s,
            "../evil",
            Some("leaf".into()),
            None,
        )
        .is_err());
        assert!(set_course_meta_sync(
            &root_s,
            "bio",
            Some("Bad Icon".into()),
            None,
        )
        .is_err());
    }

    #[test]
    fn corrupt_file_reads_empty() {
        let root = temp_root("corrupt");
        let path = root.join(".arbor");
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("courses.json"), b"{not json").unwrap();
        let root_s = root.to_string_lossy().into_owned();
        assert_eq!(read_course_meta_sync(&root_s), empty_courses_map());
    }

    #[test]
    fn preserves_other_courses_and_unknown_keys() {
        let root = temp_root("preserve");
        fs::create_dir_all(root.join(".arbor")).unwrap();
        let root_s = root.to_string_lossy().into_owned();
        set_course_meta_sync(
            &root_s,
            "a",
            Some("atom".into()),
            Some("sky".into()),
        )
        .unwrap();
        let path = courses_json_path(&root_s);
        let mut doc = read_full_document(&path);
        doc["courses"]["a"]["note"] = json!("keep");
        write_courses_atomic(&path, &doc).unwrap();
        set_course_meta_sync(
            &root_s,
            "b",
            Some("dna".into()),
            None,
        )
        .unwrap();
        let map = read_course_meta_sync(&root_s);
        assert_eq!(
            map.get("a").and_then(|e| e.get("note")).and_then(|v| v.as_str()),
            Some("keep")
        );
        assert_eq!(
            map.get("b").and_then(|e| e.get("icon")).and_then(|v| v.as_str()),
            Some("dna")
        );
    }
}
