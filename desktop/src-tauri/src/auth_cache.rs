use crate::transport::WorkerTransport;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

pub const AUTH_CACHE_TTL: Duration = Duration::from_secs(60);

static AUTH_CACHE: OnceLock<Mutex<HashMap<String, (Instant, serde_json::Value)>>> =
    OnceLock::new();

fn cache() -> &'static Mutex<HashMap<String, (Instant, serde_json::Value)>> {
    AUTH_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn auth_cache_key(transport: &WorkerTransport, provider_id: &str) -> String {
    match transport {
        WorkerTransport::Local => format!("local:{provider_id}"),
        WorkerTransport::Ssh { host, .. } => format!("ssh:{host}:{provider_id}"),
    }
}

pub fn get_cached(key: &str, now: Instant, force: bool) -> Option<serde_json::Value> {
    if force {
        return None;
    }
    let guard = cache().lock().unwrap_or_else(|e| e.into_inner());
    let (at, value) = guard.get(key)?;
    if now.duration_since(*at) > AUTH_CACHE_TTL {
        return None;
    }
    Some(value.clone())
}

pub fn store_cached(key: &str, now: Instant, value: serde_json::Value) {
    cache()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(key.to_string(), (now, value));
}

pub fn invalidate_auth(provider_id: &str) {
    let suffix = format!(":{provider_id}");
    cache()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .retain(|key, _| !key.ends_with(&suffix));
}

pub fn invalidate_if_auth_failure(summary: Option<&str>, provider_id: &str) {
    if summary
        .is_some_and(|text| text.contains("is not authenticated"))
    {
        invalidate_auth(provider_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn ttl_returns_fresh_and_expires_stale() {
        let key = "local:codex";
        let t0 = Instant::now();
        store_cached(key, t0, serde_json::json!({ "authenticated": true }));
        assert!(get_cached(key, t0 + Duration::from_secs(30), false).is_some());
        assert!(get_cached(key, t0 + Duration::from_secs(61), false).is_none());
    }

    #[test]
    fn force_skips_cache() {
        let key = "local:grok";
        let t0 = Instant::now();
        store_cached(key, t0, serde_json::json!({ "authenticated": true }));
        assert!(get_cached(key, t0, true).is_none());
    }

    #[test]
    fn invalidate_drops_matching_provider() {
        let t0 = Instant::now();
        store_cached("local:codex", t0, serde_json::json!({}));
        store_cached("ssh:host:grok", t0, serde_json::json!({}));
        invalidate_auth("grok");
        assert!(get_cached("local:codex", t0, false).is_some());
        assert!(get_cached("ssh:host:grok", t0, false).is_none());
    }
}
