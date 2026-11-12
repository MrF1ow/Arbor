use serde_json::{json, Map, Value};
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

pub fn read_course_meta_sync(root: &str) -> Value {
    let path = courses_json_path(root);
    read_courses_map_from_disk(&path)
}

/// Builds `--fields` JSON for `course-meta set`.
///
/// When only icon/color are in play (`exam_date` and `units` are both `None`), icon and color
/// are always sent (null means clear) to match today's frontend.
///
/// When `exam_date` or `units` is `Some`, only keys that are `Some` are sent so partial updates
/// do not wipe other fields. `exam_date: Some("")` clears; `units: Some({})` clears.
pub(crate) fn course_meta_fields_for_command(
    icon: Option<&str>,
    color: Option<&str>,
    exam_date: Option<&str>,
    units: Option<&Map<String, Value>>,
) -> Result<String, String> {
    let mut obj = Map::new();
    let extended = exam_date.is_some() || units.is_some();
    if extended {
        if let Some(v) = icon {
            obj.insert("icon".into(), json!(v));
        }
        if let Some(v) = color {
            obj.insert("color".into(), json!(v));
        }
        if let Some(v) = exam_date {
            obj.insert("exam_date".into(), json!(v));
        }
        if let Some(v) = units {
            obj.insert("units".into(), json!(v));
        }
    } else {
        obj.insert("icon".into(), json!(icon));
        obj.insert("color".into(), json!(color));
    }
    serde_json::to_string(&Value::Object(obj)).map_err(|e| e.to_string())
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
    exam_date: Option<String>,
    units: Option<Map<String, Value>>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let fields_json = course_meta_fields_for_command(
            icon.as_deref(),
            color.as_deref(),
            exam_date.as_deref(),
            units.as_ref(),
        )?;
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
    fn fields_json_sends_only_exam_date_when_only_exam_date_given() {
        let json = course_meta_fields_for_command(None, None, Some("2026-12-01"), None).unwrap();
        let parsed: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.get("exam_date"), Some(&json!("2026-12-01")));
        assert!(parsed.get("icon").is_none());
        assert!(parsed.get("color").is_none());
    }

    #[test]
    fn fields_json_icon_color_when_frontend_shape() {
        let json = course_meta_fields_for_command(Some("leaf"), None, None, None).unwrap();
        let parsed: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.get("icon"), Some(&json!("leaf")));
        assert!(parsed.get("color").unwrap().is_null());
        assert!(parsed.get("exam_date").is_none());
    }

    #[test]
    fn fields_json_clears_exam_date_with_empty_string() {
        let json = course_meta_fields_for_command(None, None, Some(""), None).unwrap();
        let parsed: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.get("exam_date"), Some(&json!("")));
    }

    #[test]
    fn fields_json_clears_units_with_empty_object() {
        let empty = Map::new();
        let json = course_meta_fields_for_command(None, None, None, Some(&empty)).unwrap();
        let parsed: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.get("units"), Some(&json!({})));
    }
}
