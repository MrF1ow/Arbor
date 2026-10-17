use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Appearance {
    #[default]
    System,
    Light,
    Dark,
}

fn default_provider_id() -> String {
    "codex".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Settings {
    #[serde(default)]
    pub knowledge_root: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default = "default_provider_id")]
    pub provider_id: String,
    #[serde(default)]
    pub appearance: Appearance,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            knowledge_root: None,
            model_id: None,
            provider_id: default_provider_id(),
            appearance: Appearance::default(),
        }
    }
}

pub fn provider_label(id: &str) -> String {
    match id {
        "codex" => "Codex".to_string(),
        "claude" => "Claude".to_string(),
        "grok" => "Grok".to_string(),
        "fake" => "Fake".to_string(),
        other => other.to_string(),
    }
}

pub fn to_json(s: &Settings) -> String {
    serde_json::to_string_pretty(s).unwrap_or_else(|_| "{}".to_string())
}

pub fn from_json(text: &str) -> Settings {
    serde_json::from_str(text).unwrap_or_default()
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
    std::fs::write(&path, to_json(settings)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_roundtrip() {
        let s = Settings {
            knowledge_root: Some("/home/x/Knowledge".into()),
            model_id: Some("gpt-5.6-sol".into()),
            provider_id: "grok".into(),
            appearance: Appearance::Dark,
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
        assert!(s.model_id.is_none());
        assert_eq!(s.provider_id, "codex");
        assert_eq!(s.appearance, Appearance::System);
    }

    #[test]
    fn provider_label_maps_known_ids() {
        assert_eq!(provider_label("codex"), "Codex");
        assert_eq!(provider_label("grok"), "Grok");
        assert_eq!(provider_label("custom-cli"), "custom-cli");
    }
}
