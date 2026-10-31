use crate::db;
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JobStatus {
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

impl JobStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            JobStatus::Running => "running",
            JobStatus::Succeeded => "succeeded",
            JobStatus::Failed => "failed",
            JobStatus::Cancelled => "cancelled",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JobTrigger {
    Manual,
    Watch,
    Study,
}

impl JobTrigger {
    pub fn as_str(self) -> &'static str {
        match self {
            JobTrigger::Manual => "manual",
            JobTrigger::Watch => "watch",
            JobTrigger::Study => "study",
        }
    }

    pub fn from_arg(value: Option<&str>) -> Self {
        match value {
            Some("watch") => JobTrigger::Watch,
            Some("study") => JobTrigger::Study,
            _ => JobTrigger::Manual,
        }
    }
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct JobSummary {
    pub id: String,
    pub status: String,
    pub trigger_kind: String,
    pub skill: Option<String>,
    pub model_id: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub error_summary: Option<String>,
    pub exit_code: Option<i32>,
}

pub fn skill_from_plan(trigger_kind: &str, plan_json: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(plan_json).ok()?;
    if trigger_kind == "study" {
        return value
            .get("skill")
            .and_then(|skill| skill.as_str())
            .map(str::to_string);
    }
    if value.get("op").and_then(|op| op.as_str()) == Some("embed") {
        return Some("embed".to_string());
    }
    None
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
            return Err(format!("A job is already running for {root}"));
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
            "SELECT id, status, trigger_kind, plan_json, model_id, started_at, finished_at, error_summary, exit_code
             FROM jobs ORDER BY started_at DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![limit], |row| {
            let trigger_kind: String = row.get(2)?;
            let plan_json: String = row.get(3)?;
            Ok(JobSummary {
                id: row.get(0)?,
                status: row.get(1)?,
                trigger_kind: trigger_kind.clone(),
                skill: skill_from_plan(&trigger_kind, &plan_json),
                model_id: row.get(4)?,
                started_at: row.get(5)?,
                finished_at: row.get(6)?,
                error_summary: row.get(7)?,
                exit_code: row.get(8)?,
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

pub fn resolve_terminal_status(
    line: &str,
    exit_code: i32,
    provider_label: &str,
) -> (JobStatus, Option<String>) {
    let auth_fallback = || format!("{provider_label} is not authenticated");
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(line) {
        if value.get("type").and_then(|t| t.as_str()) == Some("cancelled") {
            return (JobStatus::Cancelled, None);
        }
        if value.get("type").and_then(|t| t.as_str()) == Some("auth_failed") {
            let reason = value
                .get("reason")
                .and_then(|r| r.as_str())
                .map(str::to_string)
                .unwrap_or_else(auth_fallback);
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
        return (JobStatus::Failed, Some(auth_fallback()));
    }
    if exit_code != 0 {
        return (
            JobStatus::Failed,
            Some(format!("worker exited with code {exit_code}")),
        );
    }
    (JobStatus::Succeeded, None)
}

/// Job summary for a `skill_failed` event, used when the worker then exits nonzero.
/// Without it the Jobs row only says "worker exited with code 1".
pub fn skill_failure_summary(value: &serde_json::Value) -> Option<String> {
    if value.get("type").and_then(|t| t.as_str()) != Some("skill_failed") {
        return None;
    }
    let skill = value.get("skill").and_then(|s| s.as_str()).unwrap_or("skill");
    Some(match value.get("message").and_then(|m| m.as_str()) {
        Some(message) if !message.trim().is_empty() => {
            format!("Study {skill} failed: {}", message.trim())
        }
        _ => format!("Study {skill} failed"),
    })
}

/// A nonzero exit without its own summary takes the last skill failure instead.
pub fn prefer_skill_failure(
    resolved: (JobStatus, Option<String>),
    exit_code: i32,
    skill_failure: Option<String>,
) -> (JobStatus, Option<String>) {
    match (resolved, skill_failure) {
        ((JobStatus::Failed, _), Some(summary)) if exit_code != 0 && exit_code != 3 => {
            (JobStatus::Failed, Some(summary))
        }
        (resolved, _) => resolved,
    }
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
        let error = coord.try_begin("job-b", "/Knowledge").unwrap_err();
        assert!(error.contains("A job is already running for"));
        coord.finish("job-a");
        coord.try_begin("job-b", "/Knowledge").unwrap();
    }

    #[test]
    fn resolve_terminal_status_maps_cancelled() {
        let (status, _) = resolve_terminal_status(r#"{"type":"cancelled"}"#, 0, "Codex");
        assert_eq!(status, JobStatus::Cancelled);
    }

    #[test]
    fn resolve_terminal_status_exit_code_3_uses_provider_label() {
        let (status, summary) = resolve_terminal_status("", 3, "Grok");
        assert_eq!(status, JobStatus::Failed);
        assert_eq!(summary.as_deref(), Some("Grok is not authenticated"));
    }

    #[test]
    fn resolve_terminal_status_auth_failed_without_reason_uses_provider_label() {
        let (status, summary) =
            resolve_terminal_status(r#"{"type":"auth_failed"}"#, 0, "Claude");
        assert_eq!(status, JobStatus::Failed);
        assert_eq!(summary.as_deref(), Some("Claude is not authenticated"));
    }

    #[test]
    fn skill_failure_becomes_the_summary_on_nonzero_exit() {
        let event: serde_json::Value = serde_json::from_str(
            r#"{"type":"skill_failed","skill":"diagrams","message":"Codex is rate limited (HTTP 429).","kind":"rate_limited"}"#,
        )
        .unwrap();
        let failure = skill_failure_summary(&event);
        assert_eq!(
            failure.as_deref(),
            Some("Study diagrams failed: Codex is rate limited (HTTP 429).")
        );
        let resolved = resolve_terminal_status(r#"{"type":"worker_exit"}"#, 1, "Codex");
        let (status, summary) = prefer_skill_failure(resolved, 1, failure.clone());
        assert_eq!(status, JobStatus::Failed);
        assert_eq!(summary, failure);
    }

    #[test]
    fn skill_failure_does_not_fail_a_successful_exit_or_mask_auth() {
        let failure = Some("Study diagrams failed".to_string());
        let ok = prefer_skill_failure(resolve_terminal_status("", 0, "Codex"), 0, failure.clone());
        assert_eq!(ok, (JobStatus::Succeeded, None));
        let auth = prefer_skill_failure(resolve_terminal_status("", 3, "Grok"), 3, failure);
        assert_eq!(auth.1.as_deref(), Some("Grok is not authenticated"));
        let other: serde_json::Value = serde_json::from_str(r#"{"type":"skill_done"}"#).unwrap();
        assert_eq!(skill_failure_summary(&other), None);
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

    #[test]
    fn study_trigger_persists_kind() {
        let root = temp_root("study-trigger");
        let id = create_job(
            &root,
            JobTrigger::Study,
            "fake",
            r#"{"course":"Biology","skill":"flashcards","force":false}"#,
        )
        .unwrap();
        let jobs = list_jobs(&root, 10).unwrap();
        assert_eq!(jobs[0].id, id);
        assert_eq!(jobs[0].trigger_kind, "study");
        assert_eq!(jobs[0].skill.as_deref(), Some("flashcards"));
        assert_eq!(JobTrigger::from_arg(Some("study")), JobTrigger::Study);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn embed_skill_from_manual_plan_json() {
        let root = temp_root("embed-skill");
        let id = create_job(
            &root,
            JobTrigger::Manual,
            "hashed",
            r#"{"op":"embed","force":false}"#,
        )
        .unwrap();
        let jobs = list_jobs(&root, 10).unwrap();
        assert_eq!(jobs[0].id, id);
        assert_eq!(jobs[0].trigger_kind, "manual");
        assert_eq!(jobs[0].skill.as_deref(), Some("embed"));
        let _ = fs::remove_dir_all(&root);
    }
}
