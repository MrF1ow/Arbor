use rusqlite::Connection;
use std::path::{Path, PathBuf};

pub fn arbor_dir(knowledge_root: &Path) -> PathBuf {
    knowledge_root.join(".arbor")
}

pub fn db_path(knowledge_root: &Path) -> PathBuf {
    arbor_dir(knowledge_root).join("arbor.db")
}

/// The retired semantic index and its SQLite sidecar files, relative to `.arbor/`.
const STALE_VECTOR_FILES: [&str; 4] = [
    "vectors.sqlite",
    "vectors.sqlite-wal",
    "vectors.sqlite-shm",
    "vectors.sqlite-journal",
];

/// Delete the old semantic index when a library opens. Errors are logged and
/// ignored; nothing but those exact files is touched.
pub fn remove_stale_vector_index(knowledge_root: &Path) {
    let dir = arbor_dir(knowledge_root);
    for name in STALE_VECTOR_FILES {
        let path = dir.join(name);
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => eprintln!("could not remove {}: {error}", path.display()),
        }
    }
}

pub fn open(knowledge_root: &Path) -> Result<Connection, String> {
    // The library root is the user's folder: never recreate it. A deleted
    // library must surface as an error, not come back as an empty folder.
    if !knowledge_root.is_dir() {
        return Err(format!(
            "Library folder not found: {}",
            knowledge_root.display()
        ));
    }
    let dir = arbor_dir(knowledge_root);
    if !dir.is_dir() {
        std::fs::create_dir(&dir).map_err(|e| e.to_string())?;
    }
    let path = db_path(knowledge_root);
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r"
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY NOT NULL,
            knowledge_root TEXT NOT NULL,
            status TEXT NOT NULL,
            trigger_kind TEXT NOT NULL,
            model_id TEXT,
            plan_json TEXT,
            started_at TEXT NOT NULL,
            finished_at TEXT,
            error_summary TEXT,
            exit_code INTEGER
        );
        CREATE TABLE IF NOT EXISTS job_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL REFERENCES jobs(id),
            line TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_job_events_job_id ON job_events(job_id);
        CREATE INDEX IF NOT EXISTS idx_jobs_started_at ON jobs(started_at DESC);

        CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
            course,
            path,
            kind,
            title,
            body,
            page_range,
            source_path,
            tokenize='porter unicode61'
        );
        ",
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remove_stale_vector_index_deletes_only_the_vector_files() {
        let root = std::env::temp_dir().join(format!("arbor-db-vectors-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let dir = arbor_dir(&root);
        std::fs::create_dir_all(&dir).unwrap();
        for name in STALE_VECTOR_FILES {
            std::fs::write(dir.join(name), b"old").unwrap();
        }
        std::fs::write(dir.join("vectors.sqlite.bak"), b"keep").unwrap();
        std::fs::write(dir.join("settings.json"), b"{}").unwrap();
        open(&root).unwrap();

        remove_stale_vector_index(&root);

        for name in STALE_VECTOR_FILES {
            assert!(!dir.join(name).exists(), "{name} should be gone");
        }
        assert!(dir.join("vectors.sqlite.bak").is_file());
        assert!(dir.join("settings.json").is_file());
        assert!(db_path(&root).is_file());
        // A second call with nothing left is harmless.
        remove_stale_vector_index(&root);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn open_creates_db_under_arbor_dir() {
        let root = std::env::temp_dir().join(format!("arbor-db-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        open(&root).unwrap();
        assert!(db_path(&root).is_file());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn open_refuses_a_missing_root_and_does_not_create_it() {
        let root = std::env::temp_dir().join(format!("arbor-db-missing-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let err = open(&root).unwrap_err();
        assert!(
            err.starts_with("Library folder not found:")
                && err.contains(root.to_string_lossy().as_ref()),
            "unexpected error: {err}"
        );
        assert!(!root.exists(), "open must not recreate the library root");
    }

    #[test]
    fn open_refuses_a_root_that_is_a_file() {
        let root = std::env::temp_dir().join(format!("arbor-db-file-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_file(&root);
        std::fs::write(&root, b"not a folder").unwrap();
        let err = open(&root).unwrap_err();
        assert!(err.starts_with("Library folder not found:"), "unexpected error: {err}");
        assert!(root.is_file());
        assert_eq!(std::fs::read(&root).unwrap(), b"not a folder");
        let _ = std::fs::remove_file(&root);
    }

    #[test]
    fn open_twice_on_an_existing_root_works() {
        let root = std::env::temp_dir().join(format!("arbor-db-twice-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        open(&root).unwrap();
        open(&root).unwrap();
        assert!(db_path(&root).is_file());
        let _ = std::fs::remove_dir_all(&root);
    }
}
