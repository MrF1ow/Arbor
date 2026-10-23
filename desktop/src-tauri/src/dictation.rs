#[cfg(target_os = "macos")]
mod macos;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

pub const DICTATION_AUTO_STOP_SECS: u64 = 120;
pub const FINAL_TIMEOUT_SECS: u64 = 3;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DictationEvent {
    Listening,
    Partial { text: String },
    Final { text: String },
    Error { code: String, message: String },
}

pub fn dictation_unavailable_message() -> String {
    "Dictation is only available on macOS".into()
}

pub fn microphone_denied_message() -> String {
    "Arbor needs microphone access for dictation. Turn it on in System Settings › Privacy & Security › Microphone.".into()
}

pub fn speech_denied_message() -> String {
    "Arbor needs speech recognition access for dictation. Turn it on in System Settings › Privacy & Security › Speech Recognition.".into()
}

pub fn unavailable_message() -> String {
    "Speech recognition isn't available for your language right now.".into()
}

pub fn failed_message(detail: Option<&str>) -> String {
    match detail {
        Some(d) if !d.is_empty() => format!("Dictation stopped unexpectedly. ({d})"),
        _ => "Dictation stopped unexpectedly.".into(),
    }
}

pub fn error_event(code: &str, message: String) -> DictationEvent {
    DictationEvent::Error {
        code: code.into(),
        message,
    }
}

pub fn emit_dictation_event(channel: &Channel<DictationEvent>, event: DictationEvent) {
    let _ = channel.send(event);
}

#[cfg(not(target_os = "macos"))]
pub fn open_privacy_settings_impl(_pane: &str) -> Result<(), String> {
    Err(dictation_unavailable_message())
}

#[cfg(target_os = "macos")]
pub fn open_privacy_settings_impl(pane: &str) -> Result<(), String> {
    use std::process::Command;

    let url = match pane {
        "microphone" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        }
        "speech" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition"
        }
        _ => return Err(format!("Unknown privacy pane: {pane}")),
    };
    Command::new("open")
        .arg(url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

static NEXT_SESSION_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

#[tauri::command]
pub async fn start_dictation(
    app: tauri::AppHandle,
    on_event: Channel<DictationEvent>,
) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, on_event);
        return Err(dictation_unavailable_message());
    }

    #[cfg(target_os = "macos")]
    {
        let session_id = NEXT_SESSION_ID.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        macos::kickoff_session(app, on_event, session_id);
        Ok(())
    }
}

#[tauri::command]
pub async fn stop_dictation(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            app.run_on_main_thread(move || {
                macos::stop_active_session(app);
            })
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??;
        Ok(())
    }
}

#[tauri::command]
pub async fn cancel_dictation(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            app.run_on_main_thread(move || {
                macos::cancel_active_session();
            })
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??;
        Ok(())
    }
}

#[tauri::command]
pub async fn open_privacy_settings(pane: String) -> Result<(), String> {
    open_privacy_settings_impl(&pane)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn event_json_shapes() {
        let listening = serde_json::to_value(DictationEvent::Listening).unwrap();
        assert_eq!(listening, json!({"kind":"listening"}));

        let partial = serde_json::to_value(DictationEvent::Partial {
            text: "hello".into(),
        })
        .unwrap();
        assert_eq!(
            partial,
            json!({"kind":"partial","text":"hello"})
        );

        let final_ev = serde_json::to_value(DictationEvent::Final {
            text: "done".into(),
        })
        .unwrap();
        assert_eq!(final_ev, json!({"kind":"final","text":"done"}));

        let error = serde_json::to_value(DictationEvent::Error {
            code: "failed".into(),
            message: "Dictation stopped unexpectedly.".into(),
        })
        .unwrap();
        assert_eq!(
            error,
            json!({
                "kind":"error",
                "code":"failed",
                "message":"Dictation stopped unexpectedly."
            })
        );
    }

    #[test]
    fn error_message_mapping() {
        assert_eq!(
            microphone_denied_message(),
            "Arbor needs microphone access for dictation. Turn it on in System Settings › Privacy & Security › Microphone."
        );
        assert_eq!(
            speech_denied_message(),
            "Arbor needs speech recognition access for dictation. Turn it on in System Settings › Privacy & Security › Speech Recognition."
        );
        assert_eq!(
            unavailable_message(),
            "Speech recognition isn't available for your language right now."
        );
        assert_eq!(
            failed_message(None),
            "Dictation stopped unexpectedly."
        );
        assert_eq!(
            failed_message(Some("Network lost")),
            "Dictation stopped unexpectedly. (Network lost)"
        );
    }

    #[test]
    fn open_privacy_settings_pane_validation() {
        assert_eq!(
            open_privacy_settings_impl("microphone").unwrap_err(),
            dictation_unavailable_message()
        );
        assert_eq!(
            open_privacy_settings_impl("speech").unwrap_err(),
            dictation_unavailable_message()
        );
        assert_eq!(
            open_privacy_settings_impl("camera").unwrap_err(),
            dictation_unavailable_message()
        );
    }

    #[test]
    fn non_mac_start_dictation_message() {
        assert_eq!(
            dictation_unavailable_message(),
            "Dictation is only available on macOS"
        );
    }
}
