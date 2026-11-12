//! Weekly provider usage, summed from this machine's `provider_calls.jsonl`.
//!
//! The worker's provider registry appends one line per provider call to
//! `<root>/.arbor/users/<user>/local/provider_calls.jsonl`:
//! `{"ts", "provider", "model", "input_tokens", "output_tokens", "source"}`.
//! Calls made on an SSH worker are logged on that worker's root and are not counted here.

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::commands::git_user_dirname;

const DEFAULT_DAYS: u32 = 7;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProviderUsageSummary {
    pub provider: String,
    pub requests: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// Calls where the provider reported both counts.
    pub tokens_known: u64,
}

fn calls_path(root: &str) -> Result<PathBuf, String> {
    let user = git_user_dirname(root)?;
    Ok(Path::new(root)
        .join(".arbor")
        .join("users")
        .join(user)
        .join("local")
        .join("provider_calls.jsonl"))
}

/// Sum the calls in `log` whose `ts` is in the rolling window
/// `now - days*24h < ts <= now`, per provider, sorted by provider.
/// Malformed lines and lines without a provider or a readable `ts` are skipped.
pub fn summarize_calls(log: &str, now: DateTime<Utc>, days: u32) -> Vec<ProviderUsageSummary> {
    let oldest = now - Duration::days(i64::from(days));
    let mut by_provider: BTreeMap<String, ProviderUsageSummary> = BTreeMap::new();
    for line in log.lines() {
        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let Some(provider) = entry.get("provider").and_then(Value::as_str) else {
            continue;
        };
        let Some(ts) = entry
            .get("ts")
            .and_then(Value::as_str)
            .and_then(|raw| DateTime::parse_from_rfc3339(raw).ok())
            .map(|parsed| parsed.with_timezone(&Utc))
        else {
            continue;
        };
        if ts <= oldest || ts > now {
            continue;
        }
        let input = entry.get("input_tokens").and_then(Value::as_u64);
        let output = entry.get("output_tokens").and_then(Value::as_u64);
        let summary = by_provider
            .entry(provider.to_string())
            .or_insert_with(|| ProviderUsageSummary {
                provider: provider.to_string(),
                requests: 0,
                input_tokens: 0,
                output_tokens: 0,
                tokens_known: 0,
            });
        summary.requests += 1;
        summary.input_tokens = summary.input_tokens.saturating_add(input.unwrap_or(0));
        summary.output_tokens = summary.output_tokens.saturating_add(output.unwrap_or(0));
        if input.is_some() && output.is_some() {
            summary.tokens_known += 1;
        }
    }
    by_provider.into_values().collect()
}

pub fn usage_summary_at(
    root: &str,
    days: u32,
    now: DateTime<Utc>,
) -> Result<Vec<ProviderUsageSummary>, String> {
    let path = calls_path(root)?;
    let log = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(format!("could not read {}: {err}", path.display())),
    };
    Ok(summarize_calls(&log, now, days))
}

#[tauri::command]
pub async fn usage_summary(
    root: String,
    days: Option<u32>,
) -> Result<Vec<ProviderUsageSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        usage_summary_at(&root, days.unwrap_or(DEFAULT_DAYS), Utc::now())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn at(raw: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(raw).unwrap().with_timezone(&Utc)
    }

    fn line(ts: &str, provider: &str, input: Option<u64>, output: Option<u64>) -> String {
        serde_json::json!({
            "ts": ts,
            "provider": provider,
            "model": "m",
            "input_tokens": input,
            "output_tokens": output,
            "source": "job",
        })
        .to_string()
    }

    fn fixture_log() -> String {
        [
            line("2026-11-11T12:00:00Z", "claude", Some(100), Some(20)),
            line("2026-11-10T09:00:00Z", "claude", Some(50), Some(5)),
            line("2026-11-09T09:00:00Z", "claude", None, None),
            line("2026-11-08T09:00:00Z", "grok", Some(7), None),
            line("2026-11-11T01:00:00Z", "grok", Some(1), Some(2)),
            // Older than 7 days: ignored.
            line("2026-11-03T11:59:59Z", "claude", Some(9999), Some(9999)),
            line("2026-10-01T00:00:00Z", "ollama", Some(1), Some(1)),
            // After `now`: ignored.
            line("2026-11-12T00:00:00Z", "ollama", Some(1), Some(1)),
            "not json".to_string(),
            "{\"provider\": \"claude\"}".to_string(),
            "{\"ts\": \"2026-11-11T00:00:00Z\"}".to_string(),
            String::new(),
        ]
        .join("\n")
    }

    #[test]
    fn sums_the_window_and_ignores_older_lines() {
        let summary = summarize_calls(&fixture_log(), at("2026-11-11T12:00:00Z"), 7);
        assert_eq!(
            summary,
            vec![
                ProviderUsageSummary {
                    provider: "claude".into(),
                    requests: 3,
                    input_tokens: 150,
                    output_tokens: 25,
                    tokens_known: 2,
                },
                ProviderUsageSummary {
                    provider: "grok".into(),
                    requests: 2,
                    input_tokens: 8,
                    output_tokens: 2,
                    tokens_known: 1,
                },
            ]
        );
    }

    #[test]
    fn window_is_open_at_the_old_end_and_closed_at_now() {
        let now = at("2026-11-11T12:00:00Z");
        let log = [
            line("2026-11-04T12:00:00Z", "a", Some(1), Some(1)),
            line("2026-11-04T12:00:01Z", "a", Some(1), Some(1)),
            line("2026-11-11T12:00:00Z", "a", Some(1), Some(1)),
        ]
        .join("\n");
        let summary = summarize_calls(&log, now, 7);
        assert_eq!(summary.len(), 1);
        assert_eq!(summary[0].requests, 2);
    }

    #[test]
    fn a_shorter_window_drops_more_lines() {
        let summary = summarize_calls(&fixture_log(), at("2026-11-11T12:00:00Z"), 1);
        assert_eq!(summary.len(), 2);
        assert_eq!(summary.iter().map(|s| s.requests).sum::<u64>(), 2);
    }

    #[test]
    fn empty_log_gives_an_empty_list() {
        assert!(summarize_calls("", at("2026-11-11T12:00:00Z"), 7).is_empty());
    }

    #[test]
    fn missing_file_gives_an_empty_list_and_a_present_one_is_summed() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("arbor-usage-log-{nanos}"));
        fs::create_dir_all(&root).unwrap();
        let root_str = root.to_string_lossy().into_owned();
        let now = at("2026-11-11T12:00:00Z");

        assert!(usage_summary_at(&root_str, 7, now).unwrap().is_empty());

        let path = calls_path(&root_str).unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, fixture_log()).unwrap();
        let summary = usage_summary_at(&root_str, 7, now).unwrap();
        assert_eq!(summary.len(), 2);
        assert_eq!(summary[0].provider, "claude");
        assert_eq!(summary[0].requests, 3);

        let _ = fs::remove_dir_all(&root);
    }
}
