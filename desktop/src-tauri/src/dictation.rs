use tauri::AppHandle;

#[cfg(target_os = "macos")]
use std::time::Duration;

#[cfg(target_os = "macos")]
const DICTATION_START_FAILED: &str =
    "Dictation could not start. Check that Dictation is enabled in System Settings › Keyboard.";

pub fn dictation_unavailable_message() -> String {
    "Dictation is only available on macOS".into()
}

#[cfg(not(target_os = "macos"))]
pub fn start_dictation_impl() -> Result<(), String> {
    Err(dictation_unavailable_message())
}

#[cfg(target_os = "macos")]
pub fn start_dictation_impl(app: AppHandle) -> Result<(), String> {
    use std::sync::mpsc;

    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        use objc2::MainThreadMarker;
        use objc2::sel;
        use objc2_app_kit::NSApplication;

        let result = (|| {
            let Some(mtm) = MainThreadMarker::new() else {
                return Err("Dictation requires the main thread.".into());
            };
            let ns_app = NSApplication::sharedApplication(mtm);
            // SAFETY: `startDictation:` is a standard AppKit action sent with nil target/sender.
            let sent = unsafe { ns_app.sendAction_to_from(sel!(startDictation:), None, None) };
            if sent {
                Ok(())
            } else {
                Err(DICTATION_START_FAILED.into())
            }
        })();
        let _ = tx.send(result);
    })
    .map_err(|e| e.to_string())?;

    rx.recv_timeout(Duration::from_secs(2))
        .map_err(|_| "Dictation timed out or failed to start.".into())?
}

#[tauri::command]
pub async fn start_dictation(app: AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        start_dictation_impl()
    }

    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || start_dictation_impl(app))
            .await
            .map_err(|e| e.to_string())?
    }
}

#[cfg(test)]
mod tests {
    use super::{dictation_unavailable_message, start_dictation_impl};

    #[test]
    fn start_dictation_errors_off_macos() {
        #[cfg(not(target_os = "macos"))]
        {
            assert_eq!(
                start_dictation_impl().unwrap_err(),
                dictation_unavailable_message(),
            );
        }

        #[cfg(target_os = "macos")]
        {
            fn assert_impl(_: fn(tauri::AppHandle) -> Result<(), String>) {}
            assert_impl(start_dictation_impl);
        }
    }
}
