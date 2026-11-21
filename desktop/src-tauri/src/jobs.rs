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
    /// The class a job covered, from `plan_json`; `None` for legacy rows and mixed-class updates.
    pub course: Option<String>,
    /// Digest paths (study jobs) or source paths (update jobs) the job covered; `None` when unknown or whole-class.
    pub digests: Option<Vec<String>>,
}

/// Class and lecture scope of a job, parsed from `plan_json` like `skill_from_plan`.
/// Study rows carry `{course, digests}`. Update rows carry `{selections: [{path}]}`: the
/// paths are the scope and the class is the first path component when all agree.
pub fn scope_from_plan(trigger_kind: &str, plan_json: &str) -> (Option<String>, Option<Vec<String>>) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(plan_json) else {
        return (None, None);
    };
    if trigger_kind == "study" {
        let course = value
            .get("course")
            .and_then(|c| c.as_str())
            .map(str::to_string);
        let digests = value
            .get("digests")
            .and_then(|d| d.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|d| d.as_str().map(str::to_string))
                    .collect::<Vec<_>>()
            })
            .filter(|items| !items.is_empty());
        return (course, digests);
    }
    let Some(selections) = value.get("selections").and_then(|s| s.as_array()) else {
        return (None, None);
    };
    let paths: Vec<String> = selections
        .iter()
        .filter_map(|s| s.get("path").and_then(|p| p.as_str()).map(str::to_string))
        .collect();
    if paths.is_empty() {
        return (None, None);
    }
    let mut classes = paths
        .iter()
        .map(|p| p.split('/').next().unwrap_or(p.as_str()));
    let first = classes.next();
    let course = match first {
        Some(first) if classes.all(|c| c == first) && paths.iter().any(|p| p.contains('/')) => {
            Some(first.to_string())
        }
        _ => None,
    };
    (course, Some(paths))
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
    /// When this app process started, in epoch seconds. Rows `running` from before
    /// it belong to a process that is gone; see `reconcile_stale_jobs`.
    app_started_at: i64,
}

impl JobCoordinator {
    pub fn new() -> Self {
        Self {
            active: None,
            app_started_at: now_secs(),
        }
    }

    pub fn app_started_at(&self) -> i64 {
        self.app_started_at
    }

    /// The id of the job holding the slot, if any.
    pub fn active_job_id(&self) -> Option<&str> {
        self.active.as_ref().map(|(id, _)| id.as_str())
    }

    pub fn try_begin(&mut self, job_id: &str, knowledge_root: &str) -> Result<(), String> {
        if let Some((_, root)) = &self.active {
            return Err(format!("A job is already running for {root}"));
        }
        self.active = Some((job_id.to_string(), knowledge_root.to_string()));
        Ok(())
    }

    /// True while any job holds the slot for this knowledge root.
    pub fn is_active_for(&self, knowledge_root: &str) -> bool {
        self.active
            .as_ref()
            .is_some_and(|(_, root)| root == knowledge_root)
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

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn now_stamp() -> String {
    now_secs().to_string()
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

/// Shown as the error of a job whose app closed before the job finished.
pub const ARBOR_CLOSED_SUMMARY: &str = "Arbor closed before this job finished";

fn has_cancelled_event(conn: &Connection, job_id: &str) -> bool {
    let Ok(mut stmt) = conn
        .prepare("SELECT line FROM job_events WHERE job_id = ?1 AND line LIKE '%cancelled%'")
    else {
        return false;
    };
    let Ok(rows) = stmt.query_map(params![job_id], |row| row.get::<_, String>(0)) else {
        return false;
    };
    let found = rows.flatten().any(|line| {
        serde_json::from_str::<serde_json::Value>(&line)
            .ok()
            .and_then(|value| value.get("type").and_then(|t| t.as_str()).map(str::to_string))
            .as_deref()
            == Some("cancelled")
    });
    found
}

/// End every `running` row left by an app that closed: those started before this
/// process (`app_started_at`, epoch seconds) other than the active job. A row whose
/// events include `cancelled` ends Cancelled, any other Failed, both with
/// "Arbor closed before this job finished". Returns how many rows it ended.
pub fn reconcile_stale_jobs(
    conn: &Connection,
    active_job_id: Option<&str>,
    app_started_at: i64,
) -> usize {
    let stale: Vec<String> = match conn
        .prepare(
            "SELECT id FROM jobs WHERE status = 'running' AND CAST(started_at AS INTEGER) < ?1",
        )
        .and_then(|mut stmt| {
            stmt.query_map(params![app_started_at], |row| row.get::<_, String>(0))
                .map(|rows| rows.flatten().collect())
        }) {
        Ok(ids) => ids,
        Err(error) => {
            eprintln!("could not look for stale jobs: {error}");
            return 0;
        }
    };
    let mut ended = 0;
    for id in stale {
        if active_job_id == Some(id.as_str()) {
            continue;
        }
        let status = if has_cancelled_event(conn, &id) {
            JobStatus::Cancelled
        } else {
            JobStatus::Failed
        };
        match conn.execute(
            "UPDATE jobs SET status = ?1, finished_at = ?2, error_summary = ?3
             WHERE id = ?4 AND status = 'running'",
            params![status.as_str(), now_stamp(), ARBOR_CLOSED_SUMMARY, id],
        ) {
            Ok(changed) => ended += changed,
            Err(error) => eprintln!("could not end stale job {id}: {error}"),
        }
    }
    ended
}

/// `reconcile_stale_jobs` for one library, opened by root.
pub fn reconcile_library(
    knowledge_root: &Path,
    active_job_id: Option<&str>,
    app_started_at: i64,
) -> Result<usize, String> {
    let conn = db::open(knowledge_root)?;
    Ok(reconcile_stale_jobs(&conn, active_job_id, app_started_at))
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
            let (course, digests) = scope_from_plan(&trigger_kind, &plan_json);
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
                course,
                digests,
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
    fn scope_from_plan_covers_study_update_and_legacy_rows() {
        // Study job: course and digests come straight from the plan.
        let study = r#"{"course":"Cell Biology","skill":"flashcards","force":false,"digests":["Cell Biology/digests/a.md","Cell Biology/digests/b.md"]}"#;
        let (course, digests) = scope_from_plan("study", study);
        assert_eq!(course.as_deref(), Some("Cell Biology"));
        assert_eq!(
            digests,
            Some(vec![
                "Cell Biology/digests/a.md".to_string(),
                "Cell Biology/digests/b.md".to_string()
            ])
        );

        // Study job over the whole class: no digests.
        let full = r#"{"course":"Genetics","skill":"quiz","force":true,"digests":[]}"#;
        let (course, digests) = scope_from_plan("study", full);
        assert_eq!(course.as_deref(), Some("Genetics"));
        assert_eq!(digests, None);

        // Update job inside one class: that class, with the source paths.
        let one = r#"{"selections":[{"path":"Cell Biology/week1.pdf","ranges":null},{"path":"Cell Biology/Unit 2/week2.pdf","ranges":[[1,3]]}]}"#;
        let (course, digests) = scope_from_plan("manual", one);
        assert_eq!(course.as_deref(), Some("Cell Biology"));
        assert_eq!(
            digests,
            Some(vec![
                "Cell Biology/week1.pdf".to_string(),
                "Cell Biology/Unit 2/week2.pdf".to_string()
            ])
        );

        // Update job across classes: no single class.
        let many = r#"{"selections":[{"path":"Cell Biology/a.pdf"},{"path":"Genetics/b.pdf"}]}"#;
        let (course, digests) = scope_from_plan("watch", many);
        assert_eq!(course, None);
        assert_eq!(digests.map(|d| d.len()), Some(2));

        // Legacy rows without the keys, an embed job and bad JSON give null.
        assert_eq!(scope_from_plan("manual", r#"{"selections":[]}"#), (None, None));
        assert_eq!(scope_from_plan("manual", r#"{"op":"embed"}"#), (None, None));
        assert_eq!(scope_from_plan("study", "{}"), (None, None));
        assert_eq!(scope_from_plan("manual", "not json"), (None, None));
    }

    #[test]
    fn list_jobs_returns_scope_for_study_and_update_rows() {
        let root = temp_root("scope");
        create_job(
            &root,
            JobTrigger::Study,
            "m",
            r#"{"course":"Cell Biology","skill":"quiz","force":false,"digests":["Cell Biology/digests/a.md"]}"#,
        )
        .unwrap();
        create_job(&root, JobTrigger::Manual, "m", r#"{"selections":[{"path":"Genetics/a.pdf"}]}"#)
            .unwrap();
        create_job(&root, JobTrigger::Manual, "m", r#"{"selections":[]}"#).unwrap();
        let jobs = list_jobs(&root, 10).unwrap();
        assert_eq!(jobs.len(), 3);
        let courses: Vec<Option<&str>> = jobs.iter().map(|j| j.course.as_deref()).collect();
        assert!(courses.contains(&Some("Cell Biology")));
        assert!(courses.contains(&Some("Genetics")));
        assert!(courses.contains(&None));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn coordinator_reports_active_root() {
        let mut c = JobCoordinator::new();
        assert!(!c.is_active_for("/k"));
        c.try_begin("j1", "/k").unwrap();
        assert!(c.is_active_for("/k"));
        assert!(!c.is_active_for("/other"));
        c.finish("j1");
        assert!(!c.is_active_for("/k"));
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

    /// A job row as left behind by an app that closed: `running`, started at `started_at`.
    fn stale_job(root: &Path, started_at: &str, events: &[&str]) -> String {
        let id = create_job(root, JobTrigger::Manual, "m", r#"{"selections":[]}"#).unwrap();
        db::open(root)
            .unwrap()
            .execute(
                "UPDATE jobs SET started_at = ?1 WHERE id = ?2",
                params![started_at, id],
            )
            .unwrap();
        for line in events {
            append_event(root, &id, line).unwrap();
        }
        id
    }

    fn job_by_id(root: &Path, id: &str) -> JobSummary {
        list_jobs(root, 50)
            .unwrap()
            .into_iter()
            .find(|job| job.id == id)
            .unwrap()
    }

    #[test]
    fn reconcile_ends_a_stale_running_job_with_a_cancelled_event_as_cancelled() {
        let root = temp_root("reconcile-cancelled");
        let id = stale_job(
            &root,
            "1000",
            &[
                r#"{"type":"run_started"}"#,
                r#"{"type":"cancelled","after_sources":1}"#,
                r#"{"type":"course_synthesis_started"}"#,
            ],
        );
        let conn = db::open(&root).unwrap();

        assert_eq!(reconcile_stale_jobs(&conn, None, 2000), 1);

        let job = job_by_id(&root, &id);
        assert_eq!(job.status, "cancelled");
        assert_eq!(
            job.error_summary.as_deref(),
            Some("Arbor closed before this job finished")
        );
        assert!(job.finished_at.is_some());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reconcile_ends_a_stale_running_job_without_a_cancelled_event_as_failed() {
        let root = temp_root("reconcile-failed");
        let plain = stale_job(&root, "1000", &[r#"{"type":"run_started"}"#]);
        let no_events = stale_job(&root, "1500", &[]);
        let mentions = stale_job(
            &root,
            "1600",
            &[r#"{"type":"warning","message":"the word cancelled is only text here"}"#],
        );
        let conn = db::open(&root).unwrap();

        assert_eq!(reconcile_stale_jobs(&conn, None, 2000), 3);

        for id in [plain, no_events, mentions] {
            let job = job_by_id(&root, &id);
            assert_eq!(job.status, "failed");
            assert_eq!(
                job.error_summary.as_deref(),
                Some("Arbor closed before this job finished")
            );
            assert!(job.finished_at.is_some());
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reconcile_leaves_the_active_job_and_newer_rows_and_finished_rows_alone() {
        let root = temp_root("reconcile-untouched");
        let active = stale_job(&root, "1000", &[r#"{"type":"run_started"}"#]);
        let newer = stale_job(&root, "2000", &[]);
        let later = stale_job(&root, "2500", &[]);
        let done = stale_job(&root, "900", &[]);
        finish_job(&root, &done, JobStatus::Succeeded, 0, None).unwrap();
        let conn = db::open(&root).unwrap();

        assert_eq!(reconcile_stale_jobs(&conn, Some(&active), 2000), 0);

        for id in [&active, &newer, &later] {
            let job = job_by_id(&root, id);
            assert_eq!(job.status, "running", "{id}");
            assert_eq!(job.finished_at, None);
        }
        assert_eq!(job_by_id(&root, &done).status, "succeeded");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reconcile_runs_once_and_does_not_rewrite_a_row_it_already_ended() {
        let root = temp_root("reconcile-once");
        let id = stale_job(&root, "1000", &[]);
        let conn = db::open(&root).unwrap();

        assert_eq!(reconcile_stale_jobs(&conn, None, 2000), 1);
        let first = job_by_id(&root, &id);
        assert_eq!(reconcile_stale_jobs(&conn, None, 2000), 0);

        assert_eq!(job_by_id(&root, &id).finished_at, first.finished_at);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reconcile_library_ends_stale_rows_for_one_library_root() {
        let root = temp_root("reconcile-library");
        let id = stale_job(&root, "1000", &[r#"{"type":"cancelled"}"#]);

        assert_eq!(reconcile_library(&root, None, 2000).unwrap(), 1);

        assert_eq!(job_by_id(&root, &id).status, "cancelled");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn coordinator_reports_its_active_job_id_and_start_time() {
        let mut c = JobCoordinator::new();
        assert_eq!(c.active_job_id(), None);
        c.try_begin("job-1", "/k").unwrap();
        assert_eq!(c.active_job_id(), Some("job-1"));
        c.finish("job-1");
        assert_eq!(c.active_job_id(), None);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        assert!(c.app_started_at() <= now && c.app_started_at() > now - 60);
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
