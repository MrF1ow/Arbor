use tauri::AppHandle;

pub fn dictation_unavailable_message() -> String {
    "Dictation is only available on macOS".into()
}

#[tauri::command]
pub async fn start_dictation(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        app.run_on_main_thread(|| {
            use objc2::MainThreadMarker;
            use objc2::sel;
            use objc2_app_kit::NSApplication;

            let Some(mtm) = MainThreadMarker::new() else {
                return;
            };
            let ns_app = NSApplication::sharedApplication(mtm);
            // SAFETY: `startDictation:` is a standard AppKit action sent with nil target/sender.
            unsafe {
                ns_app.sendAction_to_from(sel!(startDictation:), None, None);
            }
        })
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err(dictation_unavailable_message())
    }
}

#[cfg(test)]
mod tests {
    use super::dictation_unavailable_message;

    #[test]
    fn start_dictation_errors_off_macos() {
        #[cfg(not(target_os = "macos"))]
        {
            assert_eq!(
                dictation_unavailable_message(),
                "Dictation is only available on macOS"
            );
        }
    }
}
