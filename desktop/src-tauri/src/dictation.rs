// Most helpers here are only called from the macOS session in dictation/macos.rs.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

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

#[cfg_attr(target_os = "macos", allow(dead_code))]
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

/// Maps Speech task errors to a terminal event (final transcript vs hard failure).
pub fn terminal_for_task_error(
    stopping: bool,
    last_partial: &str,
    detail: Option<&str>,
) -> DictationEvent {
    if stopping || !last_partial.is_empty() {
        DictationEvent::Final {
            text: last_partial.to_string(),
        }
    } else {
        error_event("failed", failed_message(detail))
    }
}

pub struct RecognizerResultDecision {
    pub last_partial: String,
    pub event: Option<DictationEvent>,
}

pub fn apply_recognizer_result(
    last_partial: &str,
    text: &str,
    is_final: bool,
) -> RecognizerResultDecision {
    let incoming_blank = text.trim().is_empty();
    let prior_non_blank = !last_partial.trim().is_empty();

    if incoming_blank {
        if is_final {
            if prior_non_blank {
                let kept = last_partial.to_string();
                RecognizerResultDecision {
                    last_partial: kept.clone(),
                    event: Some(DictationEvent::Final { text: kept }),
                }
            } else {
                RecognizerResultDecision {
                    last_partial: String::new(),
                    event: Some(DictationEvent::Final {
                        text: String::new(),
                    }),
                }
            }
        } else {
            RecognizerResultDecision {
                last_partial: last_partial.to_string(),
                event: None,
            }
        }
    } else {
        let updated = text.to_string();
        let event = if is_final {
            DictationEvent::Final {
                text: updated.clone(),
            }
        } else {
            DictationEvent::Partial {
                text: updated.clone(),
            }
        };
        RecognizerResultDecision {
            last_partial: updated,
            event: Some(event),
        }
    }
}

pub fn privacy_settings_url(pane: &str) -> Result<&'static str, String> {
    match pane {
        "microphone" => Ok(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
        ),
        "speech" => Ok(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition",
        ),
        _ => Err(format!("Unknown privacy pane: {pane}")),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn open_privacy_settings_impl(_pane: &str) -> Result<(), String> {
    Err(dictation_unavailable_message())
}

#[cfg(target_os = "macos")]
pub fn open_privacy_settings_impl(pane: &str) -> Result<(), String> {
    use std::process::Command;

    let url = privacy_settings_url(pane)?;
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
        tauri::async_runtime::spawn_blocking(move || {
            let app_main = app.clone();
            app.run_on_main_thread(move || {
                macos::kickoff_session(app_main, on_event, session_id);
            })
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??;
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
            let app_main = app.clone();
            app.run_on_main_thread(move || {
                macos::stop_active_session(app_main);
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
    fn privacy_settings_url_mapping() {
        assert_eq!(
            privacy_settings_url("microphone").unwrap(),
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        );
        assert_eq!(
            privacy_settings_url("speech").unwrap(),
            "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition"
        );
        assert_eq!(
            privacy_settings_url("camera").unwrap_err(),
            "Unknown privacy pane: camera"
        );
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn open_privacy_settings_unavailable_off_macos() {
        assert_eq!(
            open_privacy_settings_impl("microphone").unwrap_err(),
            dictation_unavailable_message()
        );
    }

    #[test]
    fn terminal_for_task_error_cases() {
        assert_eq!(
            terminal_for_task_error(false, "", Some("x")),
            DictationEvent::Error {
                code: "failed".into(),
                message: "Dictation stopped unexpectedly. (x)".into(),
            }
        );
        assert_eq!(
            terminal_for_task_error(false, "hello", Some("x")),
            DictationEvent::Final {
                text: "hello".into(),
            }
        );
        assert_eq!(
            terminal_for_task_error(true, "", Some("x")),
            DictationEvent::Final { text: "".into() }
        );
        assert_eq!(
            terminal_for_task_error(true, "hi", None),
            DictationEvent::Final { text: "hi".into() }
        );
    }

    #[test]
    fn apply_recognizer_result_cases() {
        use super::apply_recognizer_result;

        let d = apply_recognizer_result("", "hello", false);
        assert_eq!(d.last_partial, "hello");
        assert_eq!(
            d.event,
            Some(DictationEvent::Partial {
                text: "hello".into()
            })
        );

        let d = apply_recognizer_result("hel", "hello", true);
        assert_eq!(d.last_partial, "hello");
        assert_eq!(
            d.event,
            Some(DictationEvent::Final {
                text: "hello".into()
            })
        );

        let d = apply_recognizer_result("hello", "  ", false);
        assert_eq!(d.last_partial, "hello");
        assert_eq!(d.event, None);

        let d = apply_recognizer_result("hello", "", true);
        assert_eq!(d.last_partial, "hello");
        assert_eq!(
            d.event,
            Some(DictationEvent::Final {
                text: "hello".into()
            })
        );

        let d = apply_recognizer_result("hello", "   ", true);
        assert_eq!(d.last_partial, "hello");
        assert_eq!(
            d.event,
            Some(DictationEvent::Final {
                text: "hello".into()
            })
        );

        let d = apply_recognizer_result("", "", true);
        assert_eq!(d.last_partial, "");
        assert_eq!(
            d.event,
            Some(DictationEvent::Final { text: "".into() })
        );

        let d = apply_recognizer_result("", "", false);
        assert_eq!(d.last_partial, "");
        assert_eq!(d.event, None);

        let d = apply_recognizer_result("", "   ", true);
        assert_eq!(d.last_partial, "");
        assert_eq!(
            d.event,
            Some(DictationEvent::Final { text: "".into() })
        );
    }
}
