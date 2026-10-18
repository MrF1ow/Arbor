use crate::settings::Settings;
#[cfg(test)]
use std::collections::HashMap;
#[cfg(test)]
use std::sync::Mutex;

const SERVICE: &str = "com.arbor.app";

/// Compile-time guard: `sync-secret-service` must stay enabled on Linux builds.
#[cfg(target_os = "linux")]
#[allow(dead_code)]
fn _linux_secret_service_backend_linked() {
    let _ = keyring::secret_service::default_credential_builder;
}

pub trait SecretStore {
    fn set(&self, account: &str, secret: &str) -> Result<(), String>;
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    fn delete(&self, account: &str) -> Result<(), String>;
}

fn validate_account(account: &str) -> Result<(), String> {
    match account {
        "openai_api" | "anthropic_api" => Ok(()),
        _ => Err("invalid secret account".to_string()),
    }
}

fn validate_secret(secret: &str) -> Result<(), String> {
    if secret.trim().is_empty() {
        Err("secret must not be empty".to_string())
    } else {
        Ok(())
    }
}

pub fn account_for_provider(provider_id: &str) -> Result<&'static str, String> {
    match provider_id {
        "openai_api" => Ok("openai_api"),
        "anthropic_api" => Ok("anthropic_api"),
        _ => Err(format!("unknown provider for secrets: {provider_id}")),
    }
}

#[cfg(test)]
pub struct MemorySecretStore {
    inner: Mutex<HashMap<String, String>>,
}

#[cfg(test)]
impl MemorySecretStore {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }
}

#[cfg(test)]
impl SecretStore for MemorySecretStore {
    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        validate_account(account)?;
        validate_secret(secret)?;
        let mut guard = self.inner.lock().map_err(|_| "secret store lock poisoned".to_string())?;
        guard.insert(account.to_string(), secret.to_string());
        Ok(())
    }

    fn get(&self, account: &str) -> Result<Option<String>, String> {
        validate_account(account)?;
        let guard = self.inner.lock().map_err(|_| "secret store lock poisoned".to_string())?;
        Ok(guard.get(account).cloned())
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        validate_account(account)?;
        let mut guard = self.inner.lock().map_err(|_| "secret store lock poisoned".to_string())?;
        guard.remove(account);
        Ok(())
    }
}

pub struct OsSecretStore;

impl SecretStore for OsSecretStore {
    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        validate_account(account)?;
        validate_secret(secret)?;
        let entry = keyring::Entry::new(SERVICE, account).map_err(|e| format!("keyring error: {e}"))?;
        entry
            .set_password(secret)
            .map_err(|e| format!("keyring set failed: {e}"))
    }

    fn get(&self, account: &str) -> Result<Option<String>, String> {
        validate_account(account)?;
        let entry = keyring::Entry::new(SERVICE, account).map_err(|e| format!("keyring error: {e}"))?;
        match entry.get_password() {
            Ok(password) => Ok(Some(password)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("keyring get failed: {e}")),
        }
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        validate_account(account)?;
        let entry = keyring::Entry::new(SERVICE, account).map_err(|e| format!("keyring error: {e}"))?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("keyring delete failed: {e}")),
        }
    }
}

pub fn set_provider_secret_logic(
    store: &dyn SecretStore,
    provider_id: &str,
    secret: &str,
) -> Result<(), String> {
    let account = account_for_provider(provider_id)?;
    store.set(account, secret)
}

pub fn clear_provider_secret_logic(store: &dyn SecretStore, provider_id: &str) -> Result<(), String> {
    let account = account_for_provider(provider_id)?;
    store.delete(account)
}

pub fn provider_secret_status_logic(
    store: &dyn SecretStore,
    provider_id: &str,
) -> Result<String, String> {
    let account = account_for_provider(provider_id)?;
    match store.get(account)? {
        Some(value) if !value.trim().is_empty() => Ok("ready".to_string()),
        _ => Ok("missing".to_string()),
    }
}

fn push_key(
    store: &dyn SecretStore,
    account: &str,
    env_name: &str,
    pairs: &mut Vec<(String, String)>,
) {
    if let Ok(Some(value)) = store.get(account) {
        if !value.trim().is_empty() {
            pairs.push((env_name.to_string(), value));
        }
    }
}

fn push_base_url(value: Option<&str>, env_name: &str, pairs: &mut Vec<(String, String)>) {
    if let Some(url) = value {
        let trimmed = url.trim();
        if !trimmed.is_empty() {
            pairs.push((env_name.to_string(), trimmed.to_string()));
        }
    }
}

pub fn worker_env_for_provider_id(
    provider_id: &str,
    store: &dyn SecretStore,
    settings: &Settings,
) -> Vec<(String, String)> {
    let ollama = settings
        .ollama_base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty());
    let lmstudio = settings
        .lmstudio_base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty());
    let mut pairs = Vec::new();
    match provider_id {
        "openai_api" => push_key(store, "openai_api", "ARBOR_OPENAI_API_KEY", &mut pairs),
        "anthropic_api" => push_key(store, "anthropic_api", "ARBOR_ANTHROPIC_API_KEY", &mut pairs),
        "ollama" => push_base_url(ollama, "ARBOR_OLLAMA_BASE_URL", &mut pairs),
        "lmstudio" => push_base_url(lmstudio, "ARBOR_LMSTUDIO_BASE_URL", &mut pairs),
        _ => {
            push_base_url(ollama, "ARBOR_OLLAMA_BASE_URL", &mut pairs);
            push_base_url(lmstudio, "ARBOR_LMSTUDIO_BASE_URL", &mut pairs);
        }
    }
    if matches!(provider_id, "openai_api" | "anthropic_api") {
        let key_env = if provider_id == "openai_api" {
            "ARBOR_OPENAI_API_KEY"
        } else {
            "ARBOR_ANTHROPIC_API_KEY"
        };
        if pairs.iter().any(|(k, _)| k == key_env) {
            pairs.push(("ARBOR_ALLOW_REMOTE_API".to_string(), "1".to_string()));
        }
    }
    pairs
}

pub fn worker_env_for_list_providers(
    store: &dyn SecretStore,
    settings: &Settings,
) -> Vec<(String, String)> {
    let mut pairs = Vec::new();
    push_key(store, "openai_api", "ARBOR_OPENAI_API_KEY", &mut pairs);
    push_key(store, "anthropic_api", "ARBOR_ANTHROPIC_API_KEY", &mut pairs);
    let ollama = settings
        .ollama_base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty());
    let lmstudio = settings
        .lmstudio_base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty());
    push_base_url(ollama, "ARBOR_OLLAMA_BASE_URL", &mut pairs);
    push_base_url(lmstudio, "ARBOR_LMSTUDIO_BASE_URL", &mut pairs);
    pairs
}

fn provider_from_sub_args<'a>(sub_args: &'a [&'a str]) -> Option<&'a str> {
    for window in sub_args.windows(2) {
        if window[0] == "--provider" {
            return Some(window[1]);
        }
    }
    None
}

pub fn worker_env_for_sub_args(
    sub_args: &[&str],
    store: &dyn SecretStore,
    settings: &Settings,
) -> Vec<(String, String)> {
    if sub_args.iter().any(|arg| *arg == "list-providers") {
        worker_env_for_list_providers(store, settings)
    } else if let Some(provider_id) = provider_from_sub_args(sub_args) {
        worker_env_for_provider_id(provider_id, store, settings)
    } else {
        worker_env_for_provider_id("", store, settings)
    }
}

#[cfg(feature = "desktop-runtime")]
pub fn apply_env_pairs(cmd: &mut std::process::Command, pairs: &[(&str, &str)]) {
    for (key, value) in pairs {
        cmd.env(key, value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jobs;
    use crate::settings::{Appearance, Settings};
    use crate::worker::resolve_worker_argv;

    const FAKE_TEST_API_KEY: &str = "sk-test-arbor-not-a-real-key";
    use std::path::PathBuf;

    fn temp_root(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "arbor-secrets-{}-{}-{}",
            label,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn openai_env_pair_uses_memory_store_and_not_argv() {
        let store = MemorySecretStore::new();
        store.set("openai_api", FAKE_TEST_API_KEY).unwrap();
        let settings = Settings::default();
        let pairs = worker_env_for_provider_id("openai_api", &store, &settings);
        assert_eq!(pairs.len(), 2);
        assert_eq!(pairs[0].0, "ARBOR_OPENAI_API_KEY");
        assert_eq!(pairs[0].1, FAKE_TEST_API_KEY);
        assert_eq!(pairs[1].0, "ARBOR_ALLOW_REMOTE_API");
        assert_eq!(pairs[1].1, "1");

        let argv = resolve_worker_argv(
            &|_| None,
            "/repo/python",
            &["chat"],
            None,
        );
        for arg in &argv {
            assert!(!arg.contains(FAKE_TEST_API_KEY));
        }
    }

    #[test]
    fn settings_json_never_contains_fake_key() {
        let settings = Settings {
            knowledge_root: Some("/k".into()),
            knowledge_roots: vec![crate::settings::KnowledgeRootEntry {
                path: "/k".into(),
                kind: crate::settings::KnowledgeKind::Personal,
                name: "k".into(),
            }],
            active_root: Some("/k".into()),
            model_id: Some("gpt".into()),
            provider_id: "openai_api".into(),
            appearance: Appearance::System,
            ollama_base_url: Some("http://127.0.0.1:11434".into()),
            lmstudio_base_url: Some("http://127.0.0.1:1234/v1".into()),
            skill_index_source: String::new(),
            skill_index_ref: String::new(),
            skill_grants: vec![],
            provider_overrides: vec![],
        };
        let json = crate::settings::to_json(&settings);
        assert!(!json.contains(FAKE_TEST_API_KEY));
        let back = crate::settings::from_json(&json);
        assert_eq!(back, settings);
        assert!(!json.contains("api_key"));
    }

    #[test]
    fn jobs_and_launch_errors_redact_fake_key() {
        let root = temp_root("redact");

        let job_id = jobs::create_job(&root, jobs::JobTrigger::Manual, "gpt", "{}").unwrap();
        let error_line = r#"{"type":"error","message":"OpenAI API key was rejected (HTTP 401)"}"#;
        jobs::append_event(&root, &job_id, error_line).unwrap();
        let events = jobs::job_events(&root, &job_id).unwrap();
        let settings = Settings {
            provider_id: "openai_api".into(),
            ollama_base_url: Some("http://127.0.0.1:11434".into()),
            lmstudio_base_url: Some("http://127.0.0.1:1234/v1".into()),
            ..Settings::default()
        };
        let mut blob = crate::settings::to_json(&settings);
        for row in &events {
            blob.push('\n');
            blob.push_str(&row.line);
        }
        assert!(!blob.contains(FAKE_TEST_API_KEY));

        let launch_msg = format!("failed to launch worker: {}", std::io::Error::from(std::io::ErrorKind::NotFound));
        assert!(!launch_msg.contains(FAKE_TEST_API_KEY));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn provider_secret_status_lifecycle() {
        let store = MemorySecretStore::new();
        assert_eq!(
            provider_secret_status_logic(&store, "openai_api").unwrap(),
            "missing"
        );
        set_provider_secret_logic(&store, "openai_api", FAKE_TEST_API_KEY).unwrap();
        let ready = provider_secret_status_logic(&store, "openai_api").unwrap();
        assert_eq!(ready, "ready");
        assert_ne!(ready, FAKE_TEST_API_KEY);
        clear_provider_secret_logic(&store, "openai_api").unwrap();
        assert_eq!(
            provider_secret_status_logic(&store, "openai_api").unwrap(),
            "missing"
        );
    }

    fn env_map(pairs: &[(String, String)]) -> HashMap<&str, &str> {
        pairs.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect()
    }

    #[test]
    fn openai_api_without_key_sets_no_remote_env() {
        let store = MemorySecretStore::new();
        let settings = Settings::default();
        let pairs = worker_env_for_provider_id("openai_api", &store, &settings);
        let env = env_map(&pairs);
        assert!(env.get("ARBOR_OPENAI_API_KEY").is_none());
        assert!(env.get("ARBOR_ALLOW_REMOTE_API").is_none());
    }

    #[test]
    fn grok_and_ollama_never_set_allow_remote_api() {
        let store = MemorySecretStore::new();
        store.set("openai_api", FAKE_TEST_API_KEY).unwrap();
        let settings = Settings {
            ollama_base_url: Some("http://127.0.0.1:11434".into()),
            ..Settings::default()
        };
        for provider in ["grok", "ollama"] {
            let pairs = worker_env_for_provider_id(provider, &store, &settings);
            assert!(
                !pairs.iter().any(|(k, _)| k == "ARBOR_ALLOW_REMOTE_API"),
                "provider {provider}"
            );
        }
    }

    #[test]
    fn anthropic_api_with_key_sets_allow_remote_api() {
        let store = MemorySecretStore::new();
        store.set("anthropic_api", FAKE_TEST_API_KEY).unwrap();
        let settings = Settings::default();
        let pairs = worker_env_for_provider_id("anthropic_api", &store, &settings);
        let env = env_map(&pairs);
        assert_eq!(env.get("ARBOR_ANTHROPIC_API_KEY"), Some(&FAKE_TEST_API_KEY));
        assert_eq!(env.get("ARBOR_ALLOW_REMOTE_API"), Some(&"1"));
    }

    #[test]
    fn whitespace_secret_rejected_and_not_stored() {
        let store = MemorySecretStore::new();
        let err = set_provider_secret_logic(&store, "openai_api", "   ").unwrap_err();
        assert!(!err.is_empty());
        assert_eq!(store.get("openai_api").unwrap(), None);
    }
}
