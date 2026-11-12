use crate::commands::{git_user_dirname, is_reserved_course_name, validate_path_component};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

static READING_STATE_WRITE_LOCK: Mutex<()> = Mutex::new(());
static READING_STATE_TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

const READ_FRACTION: f64 = 0.9;
const STATE_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DigestRecord {
    fraction: f64,
    last_opened: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ReadingStateFile {
    version: u32,
    #[serde(default)]
    digests: HashMap<String, DigestRecord>,
}

fn reading_state_path(root: &str) -> Result<PathBuf, String> {
    let dirname = git_user_dirname(root)?;
    Ok(Path::new(root)
        .join(".arbor")
        .join("users")
        .join(dirname)
        .join("local")
        .join("reading.json"))
}

pub(crate) fn validate_digest_path(digest: &str) -> Result<(), String> {
    if digest.is_empty() {
        return Err("Invalid digest path".into());
    }
    if digest.starts_with('/') || digest.starts_with('\\') {
        return Err("Invalid digest path".into());
    }
    let path = Path::new(digest);
    if path.is_absolute() {
        return Err("Invalid digest path".into());
    }
    for component in path.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err("Invalid digest path".into());
        }
    }
    let parts: Vec<&str> = digest.split('/').collect();
    if parts.len() != 3 {
        return Err("Invalid digest path".into());
    }
    let [course, digests_dir, file] = [parts[0], parts[1], parts[2]];
    if digests_dir != "digests" {
        return Err("Invalid digest path".into());
    }
    validate_path_component(course, "course name")?;
    if is_reserved_course_name(course) {
        return Err(format!(
            "\"{course}\" is reserved. Choose a different class name."
        ));
    }
    validate_path_component(file, "digest file")?;
    if !file.ends_with(".md") {
        return Err("Invalid digest path".into());
    }
    Ok(())
}

fn clamp_fraction(fraction: f64) -> f64 {
    if fraction < 0.0 {
        0.0
    } else if fraction > 1.0 {
        1.0
    } else {
        fraction
    }
}

fn load_state_file(path: &Path) -> ReadingStateFile {
    if !path.is_file() {
        return ReadingStateFile {
            version: STATE_VERSION,
            digests: HashMap::new(),
        };
    }
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(_) => {
            return ReadingStateFile {
                version: STATE_VERSION,
                digests: HashMap::new(),
            };
        }
    };
    let parsed: Result<ReadingStateFile, _> = serde_json::from_slice(&bytes);
    match parsed {
        Ok(state) => {
            if state.version != STATE_VERSION {
                return ReadingStateFile {
                    version: STATE_VERSION,
                    digests: HashMap::new(),
                };
            }
            state
        }
        Err(_) => ReadingStateFile {
            version: STATE_VERSION,
            digests: HashMap::new(),
        },
    }
}

fn digest_is_read(fraction: f64) -> bool {
    fraction >= READ_FRACTION
}

pub(crate) fn read_reading_state_sync(root: &str) -> Result<Value, String> {
    let path = reading_state_path(root)?;
    let state = load_state_file(&path);
    let mut out = Map::new();
    for (digest, record) in state.digests {
        out.insert(
            digest,
            json!({
                "fraction": record.fraction,
                "last_opened": record.last_opened,
                "read": digest_is_read(record.fraction),
            }),
        );
    }
    Ok(Value::Object(out))
}

fn unique_temp_path(parent: &Path) -> PathBuf {
    let pid = std::process::id();
    let counter = READING_STATE_TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    parent.join(format!("reading.json.{pid}.{counter}.{nanos}.tmp"))
}

fn write_state_atomically(path: &Path, state: &ReadingStateFile) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid reading state path".to_string())?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut bytes = serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    let temp = unique_temp_path(parent);
    fs::write(&temp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&temp, path).map_err(|e| e.to_string())
}

pub(crate) fn write_reading_state_sync(
    root: &str,
    digest: String,
    fraction: f64,
) -> Result<(), String> {
    validate_digest_path(&digest)?;
    let fraction = clamp_fraction(fraction);
    let path = reading_state_path(root)?;
    let _write_guard = READING_STATE_WRITE_LOCK
        .lock()
        .map_err(|e| format!("reading state write lock poisoned: {e}"))?;
    let mut state = load_state_file(&path);
    state.version = STATE_VERSION;
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let entry = state.digests.entry(digest).or_insert(DigestRecord {
        fraction: 0.0,
        last_opened: now.clone(),
    });
    if fraction > entry.fraction {
        entry.fraction = fraction;
    }
    entry.last_opened = now;
    write_state_atomically(&path, &state)
}

#[tauri::command]
pub async fn read_reading_state(root: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || read_reading_state_sync(&root))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn write_reading_state(
    root: String,
    digest: String,
    fraction: f64,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || write_reading_state_sync(&root, digest, fraction))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::MutexGuard;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct GitIdentityTestGuard {
        _lock: MutexGuard<'static, ()>,
    }

    impl GitIdentityTestGuard {
        fn new() -> Self {
            Self {
                _lock: crate::GIT_IDENTITY_TEST_LOCK.lock().unwrap(),
            }
        }
    }

    fn temp_root(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("arbor-reading-state-{label}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn root_str(root: &Path) -> String {
        root.to_string_lossy().into_owned()
    }

    #[test]
    fn write_keeps_furthest_fraction() {
        let _git = GitIdentityTestGuard::new();
        let root = temp_root("furthest");
        let root_s = root_str(&root);
        let digest = "Biology/digests/lec.md";
        write_reading_state_sync(&root_s, digest.into(), 0.4).unwrap();
        write_reading_state_sync(&root_s, digest.into(), 0.2).unwrap();
        let state = read_reading_state_sync(&root_s).unwrap();
        let entry = state.get(digest).unwrap();
        assert_eq!(entry.get("fraction").and_then(|v| v.as_f64()), Some(0.4));
    }

    #[test]
    fn fraction_at_least_ninety_marks_read() {
        let _git = GitIdentityTestGuard::new();
        let root = temp_root("read-flag");
        let root_s = root_str(&root);
        let digest = "Bio/digests/a.md";
        write_reading_state_sync(&root_s, digest.into(), 0.95).unwrap();
        let state = read_reading_state_sync(&root_s).unwrap();
        assert_eq!(
            state
                .get(digest)
                .and_then(|v| v.get("read"))
                .and_then(|v| v.as_bool()),
            Some(true)
        );
    }

    #[test]
    fn rejects_invalid_digest_paths() {
        let bad = [
            "../x.md",
            "/abs.md",
            "Bio/notes/a.md",
            "Bio/digests/../a.md",
        ];
        for digest in bad {
            assert!(
                validate_digest_path(digest).is_err(),
                "expected rejection for {digest}"
            );
        }
    }

    #[test]
    fn file_under_user_local_reading_json() {
        let _git = GitIdentityTestGuard::new();
        let root = temp_root("path");
        let root_s = root_str(&root);
        let digest = "Chem/digests/w1.md";
        write_reading_state_sync(&root_s, digest.into(), 0.1).unwrap();
        let dirname = git_user_dirname(&root_s).unwrap();
        let expected = root
            .join(".arbor")
            .join("users")
            .join(&dirname)
            .join("local")
            .join("reading.json");
        assert!(expected.is_file());
    }

    #[test]
    fn missing_or_corrupt_file_reads_empty() {
        let _git = GitIdentityTestGuard::new();
        let root = temp_root("empty");
        let root_s = root_str(&root);
        let state = read_reading_state_sync(&root_s).unwrap();
        assert!(state.as_object().unwrap().is_empty());
        let path = reading_state_path(&root_s).unwrap();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&path, b"{not json").unwrap();
        let state = read_reading_state_sync(&root_s).unwrap();
        assert!(state.as_object().unwrap().is_empty());
    }

    #[test]
    fn concurrent_writes_preserve_max_fraction_per_digest() {
        let _git = GitIdentityTestGuard::new();
        let root = temp_root("concurrent");
        let root_s = root_str(&root);
        let same_digest = "Physics/digests/ch1.md";
        let digests = [
            "Biology/digests/a.md",
            "Chem/digests/b.md",
            same_digest,
            "Math/digests/c.md",
        ];
        let mut handles = Vec::new();
        for round in 0..50u32 {
            for (i, digest) in digests.iter().enumerate() {
                let root_s = root_s.clone();
                let digest = digest.to_string();
                let fraction = if digest == same_digest {
                    if round % 2 == 0 {
                        (round as f64 + 1.0) / 100.0
                    } else {
                        0.01
                    }
                } else {
                    ((round + i as u32) as f64 + 1.0) / 50.0
                };
                handles.push(std::thread::spawn(move || {
                    write_reading_state_sync(&root_s, digest, fraction)
                }));
            }
        }
        let mut max_by_digest: HashMap<String, f64> = HashMap::new();
        for round in 0..50u32 {
            for (i, digest) in digests.iter().enumerate() {
                let fraction = if *digest == same_digest {
                    if round % 2 == 0 {
                        (round as f64 + 1.0) / 100.0
                    } else {
                        0.01
                    }
                } else {
                    ((round + i as u32) as f64 + 1.0) / 50.0
                };
                let fraction = clamp_fraction(fraction);
                let entry = max_by_digest.entry(digest.to_string()).or_insert(0.0);
                if fraction > *entry {
                    *entry = fraction;
                }
            }
        }
        for handle in handles {
            handle.join().unwrap().expect("concurrent write failed");
        }
        let state = read_reading_state_sync(&root_s).unwrap();
        let obj = state.as_object().unwrap();
        for digest in digests {
            let entry = obj
                .get(digest)
                .expect("digest missing after concurrent writes");
            let stored = entry.get("fraction").and_then(|v| v.as_f64()).unwrap();
            let expected = *max_by_digest.get(digest).unwrap();
            assert!(
                (stored - expected).abs() < 1e-9,
                "digest {digest}: stored {stored}, expected max {expected}"
            );
        }
    }
}
