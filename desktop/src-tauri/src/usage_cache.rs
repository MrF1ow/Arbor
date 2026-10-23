use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

pub const USAGE_CACHE_TTL: Duration = Duration::from_secs(60);

static USAGE_CACHE: OnceLock<Mutex<HashMap<String, (Instant, serde_json::Value)>>> =
    OnceLock::new();

fn cache() -> &'static Mutex<HashMap<String, (Instant, serde_json::Value)>> {
    USAGE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn usage_cache_key(provider_id: &str) -> String {
    format!("local:{provider_id}")
}

pub fn get_cached(key: &str, now: Instant, force: bool) -> Option<serde_json::Value> {
    if force {
        return None;
    }
    let guard = cache().lock().unwrap_or_else(|e| e.into_inner());
    let (at, value) = guard.get(key)?;
    if now.duration_since(*at) > USAGE_CACHE_TTL {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ttl_and_force() {
        let key = "local:grok";
        let t0 = Instant::now();
        store_cached(key, t0, serde_json::json!({ "windows": [] }));
        assert!(get_cached(key, t0 + Duration::from_secs(30), false).is_some());
        assert!(get_cached(key, t0 + Duration::from_secs(61), false).is_none());
        store_cached(key, t0, serde_json::json!({ "windows": [] }));
        assert!(get_cached(key, t0, true).is_none());
    }
}
