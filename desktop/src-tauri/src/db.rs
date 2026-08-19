use rusqlite::Connection;
use std::path::{Path, PathBuf};

pub fn arbor_dir(knowledge_root: &Path) -> PathBuf {
    knowledge_root.join(".arbor")
}

pub fn db_path(knowledge_root: &Path) -> PathBuf {
    arbor_dir(knowledge_root).join("arbor.db")
}

pub fn open(knowledge_root: &Path) -> Result<Connection, String> {
    let dir = arbor_dir(knowledge_root);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
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
        ",
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_creates_db_under_arbor_dir() {
        let root = std::env::temp_dir().join(format!("arbor-db-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        open(&root).unwrap();
        assert!(db_path(&root).is_file());
        let _ = std::fs::remove_dir_all(&root);
    }
}
