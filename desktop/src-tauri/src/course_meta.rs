use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

fn courses_json_path(root: &str) -> PathBuf {
    Path::new(root).join(".arbor").join("courses.json")
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

fn normalize_full_document(mut doc: Value) -> Value {
    if !doc.is_object() {
        return json!({ "version": 1, "courses": {} });
    }
    let obj = doc.as_object_mut().expect("object");
    match obj.get("courses").and_then(|c| c.as_object()) {
        Some(_) => {}
        _ => {
            obj.insert("courses".into(), json!({}));
        }
    }
    if obj.get("version").is_none() {
        obj.insert("version".into(), json!(1));
    }
    doc
}

pub fn read_course_meta_sync(root: &str) -> Value {
    let path = courses_json_path(root);
    read_courses_map_from_disk(&path)
}

#[tauri::command]
pub async fn read_course_meta(root: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(read_course_meta_sync(&root)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_course_meta(
    app: AppHandle,
    root: String,
    course: String,
    icon: Option<String>,
    color: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let fields = json!({ "icon": icon, "color": color });
        let fields_json = serde_json::to_string(&fields).map_err(|e| e.to_string())?;
        crate::commands::run_worker_json_app(
            &app,
            &[
                "course-meta",
                "set",
                "--root",
                root.as_str(),
                "--course",
                course.as_str(),
                "--fields",
                fields_json.as_str(),
            ],
        )
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
    fn corrupt_file_reads_empty() {
        let root = temp_root("corrupt");
        let path = root.join(".arbor");
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("courses.json"), b"{not json").unwrap();
        let root_s = root.to_string_lossy().into_owned();
        assert_eq!(read_course_meta_sync(&root_s), empty_courses_map());
    }

    #[test]
    fn non_object_json_reads_empty_courses() {
        let root = temp_root("array");
        let path = root.join(".arbor");
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("courses.json"), b"[]").unwrap();
        let root_s = root.to_string_lossy().into_owned();
        assert_eq!(read_course_meta_sync(&root_s), empty_courses_map());
    }

    #[test]
    fn normalize_repairs_non_object_courses() {
        let doc = normalize_full_document(json!({ "version": 1, "courses": [] }));
        assert_eq!(doc["courses"], json!({}));
    }
}
