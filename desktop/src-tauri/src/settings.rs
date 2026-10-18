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
        }
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
            }],
            active_root: Some("/home/x/Knowledge".into()),
            model_id: Some("gpt-5.6-sol".into()),
            provider_id: "grok".into(),
            appearance: Appearance::Dark,
            ollama_base_url: None,
            lmstudio_base_url: None,
            skill_index_source: String::new(),
            skill_index_ref: String::new(),
            skill_grants: vec![],
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
