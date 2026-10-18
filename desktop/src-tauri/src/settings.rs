use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Appearance {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum KnowledgeKind {
    #[default]
    Personal,
    Shared,
}

fn deserialize_knowledge_kind<'de, D>(deserializer: D) -> Result<KnowledgeKind, D::Error>
where
    D: Deserializer<'de>,
{
    let raw = Option::<String>::deserialize(deserializer)?;
    Ok(match raw.as_deref() {
        Some("shared") => KnowledgeKind::Shared,
        _ => KnowledgeKind::Personal,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct KnowledgeRootEntry {
    pub path: String,
    #[serde(default, deserialize_with = "deserialize_knowledge_kind")]
    pub kind: KnowledgeKind,
    pub name: String,
    #[serde(default)]
    pub worker_id: Option<String>,
}

fn default_ssh_port() -> u16 {
    22
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SshWorker {
    pub id: String,
    pub label: String,
    pub host: String,
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub identity_file: Option<String>,
    pub worker_cmd: String,
    pub remote_root: String,
}

impl SshWorker {
    pub fn to_transport(&self) -> crate::transport::WorkerTransport {
        crate::transport::WorkerTransport::Ssh {
            host: self.host.clone(),
            port: self.port,
            user: self.user.clone(),
            identity_file: self
                .identity_file
                .as_ref()
                .map(std::path::PathBuf::from),
            worker_cmd: self.worker_cmd.clone(),
            remote_root: self.remote_root.clone(),
        }
    }
}

fn default_provider_id() -> String {
    "codex".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SkillGrant {
    pub id: String,
    pub commit: String,
    pub permissions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProviderOverride {
    pub path: String,
    pub provider_id: String,
    #[serde(default)]
    pub model_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Settings {
    #[serde(default)]
    pub knowledge_root: Option<String>,
    #[serde(default)]
    pub knowledge_roots: Vec<KnowledgeRootEntry>,
    #[serde(default)]
    pub active_root: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default = "default_provider_id")]
    pub provider_id: String,
    #[serde(default)]
    pub appearance: Appearance,
    #[serde(default)]
    pub ollama_base_url: Option<String>,
    #[serde(default)]
    pub lmstudio_base_url: Option<String>,
    #[serde(default)]
    pub skill_index_source: String,
    #[serde(default)]
    pub skill_index_ref: String,
    #[serde(default)]
    pub skill_grants: Vec<SkillGrant>,
    #[serde(default)]
    pub provider_overrides: Vec<ProviderOverride>,
    #[serde(default)]
    pub workers: Vec<SshWorker>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            knowledge_root: None,
            knowledge_roots: vec![],
            active_root: None,
            model_id: None,
            provider_id: default_provider_id(),
            appearance: Appearance::default(),
            ollama_base_url: None,
            lmstudio_base_url: None,
            skill_index_source: String::new(),
            skill_index_ref: String::new(),
            skill_grants: vec![],
            provider_overrides: vec![],
            workers: vec![],
        }
    }
}

fn normalize_worker_id(raw: Option<String>) -> Option<String> {
    let id = raw.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())?;
    if id.eq_ignore_ascii_case("local") {
        None
    } else {
        Some(id)
    }
}

fn worker_id_valid(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && !id.starts_with('-')
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub fn validate_workers(settings: &Settings) -> Result<(), String> {
    let mut seen_ids = HashSet::new();
    for worker in &settings.workers {
        let id = worker.id.trim();
        if id.is_empty() {
            return Err("worker id: required".to_string());
        }
        if id.eq_ignore_ascii_case("local") {
            return Err("worker id: must not be `local`".to_string());
        }
        if id.starts_with('-') {
            return Err(format!("worker id: must not start with `-`: `{id}`"));
        }
        if !worker_id_valid(id) {
            return Err(format!("worker id: invalid `{id}`"));
        }
        if !seen_ids.insert(id.to_string()) {
            return Err(format!("worker id: duplicate `{id}`"));
        }
        if worker.label.trim().is_empty() {
            return Err(format!("worker `{id}`: label required"));
        }
        crate::transport::validate_ssh(&worker.to_transport())?;
    }

    for entry in &settings.knowledge_roots {
        if let Some(wid) = entry.worker_id.as_deref() {
            if !settings.workers.iter().any(|w| w.id == wid) {
                return Err(format!(
                    "knowledge root `{}`: unknown worker id `{wid}`",
                    entry.path
                ));
            }
        }
    }
    Ok(())
}

pub fn transport_for_root(
    settings: &Settings,
    root: &str,
) -> Result<crate::transport::WorkerTransport, String> {
    let worker_id = settings
        .knowledge_roots
        .iter()
        .find(|e| e.path == root)
        .and_then(|e| e.worker_id.as_deref());
    match worker_id {
        None => Ok(crate::transport::WorkerTransport::Local),
        Some(id) => settings
            .workers
            .iter()
            .find(|w| w.id == id)
            .map(SshWorker::to_transport)
            .ok_or_else(|| format!("unknown worker id `{id}`")),
    }
}

fn path_basename(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    std::path::Path::new(trimmed)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string()
}

pub fn normalize_settings(mut s: Settings) -> Settings {
    if s.knowledge_roots.is_empty() {
        if let Some(ref path) = s.knowledge_root {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                s.knowledge_roots.push(KnowledgeRootEntry {
                    path: trimmed.to_string(),
                    kind: KnowledgeKind::Personal,
                    name: path_basename(trimmed),
                    worker_id: None,
                });
            }
        }
    }

    let mut seen = HashSet::new();
    s.knowledge_roots.retain(|entry| {
        let trimmed = entry.path.trim();
        if trimmed.is_empty() {
            return false;
        }
        if !seen.insert(trimmed.to_string()) {
            return false;
        }
        true
    });

    let active_valid = s
        .active_root
        .as_ref()
        .filter(|p| s.knowledge_roots.iter().any(|e| e.path == **p))
        .cloned();
    s.active_root = active_valid.or_else(|| s.knowledge_roots.first().map(|e| e.path.clone()));
    s.knowledge_root = s.active_root.clone();

    for entry in &mut s.knowledge_roots {
        entry.worker_id = normalize_worker_id(entry.worker_id.take());
    }

    let mut seen_worker_ids = HashSet::new();
    s.workers.retain_mut(|worker| {
        worker.id = worker.id.trim().to_string();
        if worker.id.is_empty() || worker.id.eq_ignore_ascii_case("local") {
            return false;
        }
        if !seen_worker_ids.insert(worker.id.clone()) {
            return false;
        }
        true
    });

    let mut merged_overrides: Vec<ProviderOverride> = Vec::new();
    let mut index_by_path: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for entry in s.provider_overrides.drain(..) {
        let path = entry.path.trim().to_string();
        let provider_id = entry.provider_id.trim().to_string();
        if path.is_empty() || provider_id.is_empty() {
            continue;
        }
        let normalized = ProviderOverride {
            path: path.clone(),
            provider_id,
            model_id: entry.model_id,
        };
        if let Some(idx) = index_by_path.get(&path) {
            merged_overrides[*idx] = normalized;
        } else {
            index_by_path.insert(path, merged_overrides.len());
            merged_overrides.push(normalized);
        }
    }
    s.provider_overrides = merged_overrides;

    s
}

pub fn provider_label(id: &str) -> String {
    match id {
        "codex" => "Codex".to_string(),
        "claude" => "Claude".to_string(),
        "grok" => "Grok".to_string(),
        "fake" => "Fake".to_string(),
        "ollama" => "Ollama".to_string(),
        "lmstudio" => "LM Studio".to_string(),
        "openai_api" => "OpenAI API".to_string(),
        "anthropic_api" => "Anthropic API".to_string(),
        other => other.to_string(),
    }
}

pub fn to_json(s: &Settings) -> String {
    serde_json::to_string_pretty(s).unwrap_or_else(|_| "{}".to_string())
}

pub fn from_json(text: &str) -> Settings {
    let parsed: Settings = serde_json::from_str(text).unwrap_or_default();
    normalize_settings(parsed)
}

#[cfg(feature = "desktop-runtime")]
pub fn settings_path(app: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;
    let dir = app
        .path()
        .app_config_dir()
        .expect("app config dir");
    dir.join("settings.json")
}

#[cfg(feature = "desktop-runtime")]
pub fn load(app: &tauri::AppHandle) -> Settings {
    let path = settings_path(app);
    match std::fs::read_to_string(&path) {
        Ok(text) => from_json(&text),
        Err(_) => Settings::default(),
    }
}

#[cfg(feature = "desktop-runtime")]
pub fn save(app: &tauri::AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let normalized = normalize_settings(settings.clone());
    validate_workers(&normalized)?;
    std::fs::write(&path, to_json(&normalized)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_roundtrip() {
        let s = Settings {
            knowledge_root: Some("/home/x/Knowledge".into()),
            knowledge_roots: vec![KnowledgeRootEntry {
                path: "/home/x/Knowledge".into(),
                kind: KnowledgeKind::Personal,
                name: "Knowledge".into(),
                worker_id: None,
            }],
            workers: vec![],
            active_root: Some("/home/x/Knowledge".into()),
            model_id: Some("gpt-5.6-sol".into()),
            provider_id: "grok".into(),
            appearance: Appearance::Dark,
            ollama_base_url: None,
            lmstudio_base_url: None,
            skill_index_source: String::new(),
            skill_index_ref: String::new(),
            skill_grants: vec![],
            provider_overrides: vec![],
        };
        let back = from_json(&to_json(&s));
        assert_eq!(s, back);
    }

    #[test]
    fn from_invalid_is_default() {
        assert_eq!(from_json("not json"), Settings::default());
    }

    #[test]
    fn missing_fields_default_to_none() {
        let s = from_json("{}");
        assert!(s.knowledge_root.is_none());
        assert!(s.active_root.is_none());
        assert!(s.knowledge_roots.is_empty());
        assert!(s.model_id.is_none());
        assert_eq!(s.provider_id, "codex");
        assert_eq!(s.appearance, Appearance::System);
        assert!(s.skill_index_source.is_empty());
        assert!(s.skill_index_ref.is_empty());
        assert!(s.skill_grants.is_empty());
        assert!(s.provider_overrides.is_empty());
        assert!(s.workers.is_empty());
    }

    #[test]
    fn provider_override_roundtrip_and_duplicate_path() {
        let json = r#"{
            "provider_overrides": [
                {"path":"/a/root","provider_id":"grok","model_id":"old"},
                {"path":"/a/root","provider_id":"codex","model_id":"new"}
            ]
        }"#;
        let s = from_json(json);
        assert_eq!(s.provider_overrides.len(), 1);
        assert_eq!(s.provider_overrides[0].path, "/a/root");
        assert_eq!(s.provider_overrides[0].provider_id, "codex");
        assert_eq!(s.provider_overrides[0].model_id.as_deref(), Some("new"));
        let back = from_json(&to_json(&s));
        assert_eq!(back.provider_overrides, s.provider_overrides);
    }

    fn live_shaped_worker() -> SshWorker {
        SshWorker {
            id: "dev".to_string(),
            label: "Dev box".to_string(),
            host: "127.0.0.1".to_string(),
            port: 22222,
            user: None,
            identity_file: Some("/tmp/arbor-r14/ssh/client_key".to_string()),
            worker_cmd: "uv run --project /opt/arbor/python arbor-worker".to_string(),
            remote_root: "/tmp/arbor-r14/remote".to_string(),
        }
    }

    #[test]
    fn worker_roundtrip_and_port_default() {
        let json = r#"{
            "workers":[{"id":"dev","label":"Dev","host":"127.0.0.1","worker_cmd":"uv run arbor-worker","remote_root":"/tmp/r"}]
        }"#;
        let s = from_json(json);
        assert_eq!(s.workers.len(), 1);
        assert_eq!(s.workers[0].port, 22);
        let back = from_json(&to_json(&s));
        assert_eq!(back.workers[0].port, 22);
        assert_eq!(back.workers[0].host, "127.0.0.1");
    }

    #[test]
    fn validate_workers_host_and_live_worker() {
        let bad = Settings {
            workers: vec![SshWorker {
                id: "x".to_string(),
                label: "X".to_string(),
                host: "-oProxyCommand=evil".to_string(),
                port: 22,
                user: None,
                identity_file: None,
                worker_cmd: "arbor-worker".to_string(),
                remote_root: "/tmp/r".to_string(),
            }],
            ..Settings::default()
        };
        assert!(validate_workers(&bad).is_err());

        let good = Settings {
            workers: vec![live_shaped_worker()],
            ..Settings::default()
        };
        validate_workers(&good).unwrap();
    }

    #[test]
    fn transport_for_root_local_and_ssh() {
        let worker = live_shaped_worker();
        let settings = Settings {
            knowledge_roots: vec![
                KnowledgeRootEntry {
                    path: "/tmp/Knowledge".into(),
                    kind: KnowledgeKind::Personal,
                    name: "Knowledge".into(),
                    worker_id: None,
                },
                KnowledgeRootEntry {
                    path: "/tmp/Remote".into(),
                    kind: KnowledgeKind::Personal,
                    name: "Remote".into(),
                    worker_id: Some("dev".to_string()),
                },
            ],
            workers: vec![worker],
            ..Settings::default()
        };
        assert!(matches!(
            transport_for_root(&settings, "/tmp/Knowledge").unwrap(),
            crate::transport::WorkerTransport::Local
        ));
        assert!(matches!(
            transport_for_root(&settings, "/tmp/Remote").unwrap(),
            crate::transport::WorkerTransport::Ssh { .. }
        ));
    }

    #[test]
    fn normalize_workers_dedupes_and_drops_local_id() {
        let json = r#"{
            "workers":[
                {"id":"dev","label":"One","host":"127.0.0.1","worker_cmd":"w","remote_root":"/r"},
                {"id":"dev","label":"Dup","host":"127.0.0.1","worker_cmd":"w","remote_root":"/r"},
                {"id":"local","label":"Skip","host":"127.0.0.1","worker_cmd":"w","remote_root":"/r"}
            ],
            "knowledge_roots":[{"path":"/k","kind":"personal","name":"K","worker_id":" local "}]
        }"#;
        let s = from_json(json);
        assert_eq!(s.workers.len(), 1);
        assert_eq!(s.workers[0].label, "One");
        assert!(s.knowledge_roots[0].worker_id.is_none());
    }

    #[test]
    fn skill_grant_roundtrip() {
        let json = r#"{
            "skill_grants":[{"id":"demo-skill","commit":"0123456789abcdef0123456789abcdef01234567","permissions":["read_course"]}]
        }"#;
        let s = from_json(json);
        assert_eq!(s.skill_grants.len(), 1);
        assert_eq!(s.skill_grants[0].id, "demo-skill");
        assert_eq!(s.skill_grants[0].permissions, vec!["read_course".to_string()]);
        let back = from_json(&to_json(&s));
        assert_eq!(back.skill_grants, s.skill_grants);
    }

    #[test]
    fn legacy_knowledge_root_migrates() {
        let s = from_json(
            r#"{"knowledge_root":"/home/x/Knowledge","provider_id":"grok","model_id":"gpt-5.6-sol"}"#,
        );
        assert_eq!(s.knowledge_roots.len(), 1);
        assert_eq!(s.knowledge_roots[0].path, "/home/x/Knowledge");
        assert_eq!(s.knowledge_roots[0].kind, KnowledgeKind::Personal);
        assert_eq!(s.knowledge_roots[0].name, "Knowledge");
        assert_eq!(s.active_root.as_deref(), Some("/home/x/Knowledge"));
        assert_eq!(s.knowledge_root.as_deref(), Some("/home/x/Knowledge"));
        assert_eq!(s.provider_id, "grok");
        assert_eq!(s.model_id.as_deref(), Some("gpt-5.6-sol"));
    }

    #[test]
    fn multi_root_roundtrip() {
        let json = r#"{
            "knowledge_roots": [
                {"path":"/a/One","kind":"personal","name":"One"},
                {"path":"/b/Two","kind":"shared","name":"Two"}
            ],
            "active_root":"/b/Two",
            "provider_id":"codex"
        }"#;
        let s = from_json(json);
        assert_eq!(s.active_root.as_deref(), Some("/b/Two"));
        let saved = to_json(&s);
        let back = from_json(&saved);
        assert_eq!(back.knowledge_roots, s.knowledge_roots);
        assert_eq!(back.active_root, s.active_root);
        assert_eq!(back.knowledge_root.as_deref(), Some("/b/Two"));
    }

    #[test]
    fn knowledge_roots_win_over_legacy_root() {
        let json = r#"{
            "knowledge_root":"/legacy",
            "knowledge_roots":[{"path":"/listed","kind":"personal","name":"Listed"}],
            "active_root":"/listed"
        }"#;
        let s = from_json(json);
        assert_eq!(s.knowledge_roots.len(), 1);
        assert_eq!(s.knowledge_roots[0].path, "/listed");
        assert_eq!(s.active_root.as_deref(), Some("/listed"));
        assert_eq!(s.knowledge_root.as_deref(), Some("/listed"));
    }

    #[test]
    fn active_root_invalid_falls_back_to_first() {
        let json = r#"{
            "knowledge_roots":[
                {"path":"/first","kind":"personal","name":"First"},
                {"path":"/second","kind":"personal","name":"Second"}
            ],
            "active_root":"/missing"
        }"#;
        let s = from_json(json);
        assert_eq!(s.active_root.as_deref(), Some("/first"));
        assert_eq!(s.knowledge_root.as_deref(), Some("/first"));
    }

    #[test]
    fn unknown_kind_becomes_personal() {
        let json = r#"{
            "knowledge_roots":[{"path":"/k","kind":"team","name":"K"}],
            "model_id":"keep-me"
        }"#;
        let s = from_json(json);
        assert_eq!(s.knowledge_roots[0].kind, KnowledgeKind::Personal);
        assert_eq!(s.model_id.as_deref(), Some("keep-me"));
    }

    #[test]
    fn provider_label_maps_known_ids() {
        assert_eq!(provider_label("codex"), "Codex");
        assert_eq!(provider_label("grok"), "Grok");
        assert_eq!(provider_label("ollama"), "Ollama");
        assert_eq!(provider_label("lmstudio"), "LM Studio");
        assert_eq!(provider_label("openai_api"), "OpenAI API");
        assert_eq!(provider_label("anthropic_api"), "Anthropic API");
        assert_eq!(provider_label("custom-cli"), "custom-cli");
    }
}
