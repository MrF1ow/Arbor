use crate::db;
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JobStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

impl JobStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            JobStatus::Queued => "queued",
            JobStatus::Running => "running",
            JobStatus::Succeeded => "succeeded",
            JobStatus::Failed => "failed",
            JobStatus::Cancelled => "cancelled",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "queued" => Some(JobStatus::Queued),
            "running" => Some(JobStatus::Running),
            "succeeded" => Some(JobStatus::Succeeded),
            "failed" => Some(JobStatus::Failed),
            "cancelled" => Some(JobStatus::Cancelled),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub enum JobTrigger {
    Manual,
    Watch,
}

impl JobTrigger {
    pub fn as_str(self) -> &'static str {
        match self {
            JobTrigger::Manual => "manual",
            JobTrigger::Watch => "watch",
        }
    }

    pub fn from_arg(value: Option<&str>) -> Self {
        match value {
            Some("watch") => JobTrigger::Watch,
            _ => JobTrigger::Manual,
        }
    }
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct JobSummary {
    pub id: String,
    pub status: String,
    pub trigger_kind: String,
    pub model_id: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub error_summary: Option<String>,
    pub exit_code: Option<i32>,
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct JobEventRow {
    pub line: String,
    pub created_at: String,
}

pub struct JobCoordinator {
    active: Option<(String, String)>,
}

impl JobCoordinator {
    pub fn new() -> Self {
        Self { active: None }
    }

    pub fn try_begin(&mut self, job_id: &str, knowledge_root: &str) -> Result<(), String> {
        if let Some((_, root)) = &self.active {
            return Err(format!("An update is already running for {root}"));
        }
        self.active = Some((job_id.to_string(), knowledge_root.to_string()));
        Ok(())
    }

    pub fn finish(&mut self, job_id: &str) {
        if self
            .active
            .as_ref()
            .is_some_and(|(id, _)| id == job_id)
        {
            self.active = None;
        }
    }

    pub fn is_busy(&self) -> bool {
        self.active.is_some()
    }
}

fn now_stamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}

pub fn new_job_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("job-{nanos:x}")
}

pub fn ensure_db(knowledge_root: &Path) -> Result<(), String> {
    db::open(knowledge_root).map(|_| ())
}

pub fn create_job(
    knowledge_root: &Path,
    trigger: JobTrigger,
    model_id: &str,
    plan_json: &str,
) -> Result<String, String> {
    let conn = db::open(knowledge_root)?;
    let id = new_job_id();
    let started_at = now_stamp();
    conn.execute(
        "INSERT INTO jobs (id, knowledge_root, status, trigger_kind, model_id, plan_json, started_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            knowledge_root.to_string_lossy(),
            JobStatus::Running.as_str(),
            trigger.as_str(),
            model_id,
            plan_json,
            started_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

pub fn append_event(knowledge_root: &Path, job_id: &str, line: &str) -> Result<(), String> {
    let conn = db::open(knowledge_root)?;
    conn.execute(
        "INSERT INTO job_events (job_id, line, created_at) VALUES (?1, ?2, ?3)",
        params![job_id, line, now_stamp()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn finish_job(
    knowledge_root: &Path,
    job_id: &str,
    status: JobStatus,
    exit_code: i32,
    error_summary: Option<String>,
) -> Result<(), String> {
    let conn = db::open(knowledge_root)?;
    conn.execute(
        "UPDATE jobs SET status = ?1, finished_at = ?2, exit_code = ?3, error_summary = ?4
         WHERE id = ?5",
        params![
            status.as_str(),
            now_stamp(),
            exit_code,
            error_summary,
            job_id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_jobs(knowledge_root: &Path, limit: u32) -> Result<Vec<JobSummary>, String> {
    let conn = db::open(knowledge_root)?;
    list_jobs_conn(&conn, limit)
}

fn list_jobs_conn(conn: &Connection, limit: u32) -> Result<Vec<JobSummary>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, status, trigger_kind, model_id, started_at, finished_at, error_summary, exit_code
             FROM jobs ORDER BY started_at DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![limit], |row| {
            Ok(JobSummary {
                id: row.get(0)?,
                status: row.get(1)?,
                trigger_kind: row.get(2)?,
                model_id: row.get(3)?,
                started_at: row.get(4)?,
                finished_at: row.get(5)?,
                error_summary: row.get(6)?,
                exit_code: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn job_events(knowledge_root: &Path, job_id: &str) -> Result<Vec<JobEventRow>, String> {
    let conn = db::open(knowledge_root)?;
    let mut stmt = conn
        .prepare(
            "SELECT line, created_at FROM job_events WHERE job_id = ?1 ORDER BY id ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![job_id], |row| {
            Ok(JobEventRow {
                line: row.get(0)?,
                created_at: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn resolve_terminal_status(line: &str, exit_code: i32) -> (JobStatus, Option<String>) {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(line) {
        if value.get("type").and_then(|t| t.as_str()) == Some("cancelled") {
            return (JobStatus::Cancelled, None);
        }
        if value.get("type").and_then(|t| t.as_str()) == Some("auth_failed") {
            let reason = value
                .get("reason")
                .and_then(|r| r.as_str())
                .unwrap_or("Codex not authenticated")
                .to_string();
            return (JobStatus::Failed, Some(reason));
        }
        if value.get("type").and_then(|t| t.as_str()) == Some("error") {
            let message = value
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("worker error")
                .to_string();
            return (JobStatus::Failed, Some(message));
        }
    }
    if exit_code == 3 {
        return (
            JobStatus::Failed,
            Some("Codex CLI is not authenticated".into()),
        );
    }
    if exit_code != 0 {
        return (
            JobStatus::Failed,
            Some(format!("worker exited with code {exit_code}")),
        );
    }
    (JobStatus::Succeeded, None)
}

pub type SharedCoordinator = Mutex<JobCoordinator>;

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_root(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("arbor-jobs-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn create_list_and_finish_job() {
        let root = temp_root("lifecycle");
        let id = create_job(&root, JobTrigger::Manual, "gpt-5.6-sol", r#"{"selections":[]}"#)
            .unwrap();
        append_event(&root, &id, r#"{"type":"run_started"}"#).unwrap();
        finish_job(&root, &id, JobStatus::Succeeded, 0, None).unwrap();
        let jobs = list_jobs(&root, 10).unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].id, id);
        assert_eq!(jobs[0].status, "succeeded");
        let events = job_events(&root, &id).unwrap();
        assert_eq!(events.len(), 1);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn coordinator_rejects_second_run() {
        let mut coord = JobCoordinator::new();
        coord.try_begin("job-a", "/Knowledge").unwrap();
        assert!(coord.try_begin("job-b", "/Knowledge").is_err());
        coord.finish("job-a");
        coord.try_begin("job-b", "/Knowledge").unwrap();
    }

    #[test]
    fn resolve_terminal_status_maps_cancelled() {
        let (status, _) = resolve_terminal_status(r#"{"type":"cancelled"}"#, 0);
        assert_eq!(status, JobStatus::Cancelled);
    }

    #[test]
    fn watch_trigger_persists_kind() {
        let root = temp_root("watch-trigger");
        let id = create_job(&root, JobTrigger::Watch, "gpt-5.6-sol", r#"{"selections":[]}"#)
            .unwrap();
        let jobs = list_jobs(&root, 10).unwrap();
        assert_eq!(jobs[0].id, id);
        assert_eq!(jobs[0].trigger_kind, "watch");
        assert_eq!(JobTrigger::from_arg(Some("watch")).as_str(), "watch");
        assert_eq!(JobTrigger::from_arg(None).as_str(), "manual");
        let _ = fs::remove_dir_all(&root);
    }
}
