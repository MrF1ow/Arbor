//! Linux WebKitGTK graphics workarounds.
//!
//! See: https://v2.tauri.app/develop/debug/linux-graphics/
//! and tauri-apps/tauri#9394

#[cfg(target_os = "linux")]
pub fn apply_workarounds() {
    let nvidia = std::path::Path::new("/sys/module/nvidia").exists();
    let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some_and(|v| !v.is_empty());

    if nvidia && wayland && !env_is_set("__NV_DISABLE_EXPLICIT_SYNC") {
        // Fixes Wayland "Error 71 (Protocol error)" on many NVIDIA setups without
        // disabling the DMA-BUF renderer.
        std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
    }

    if nvidia
        && !wayland
        && !env_is_set("WEBKIT_DISABLE_DMABUF_RENDERER")
    {
        // X11 + NVIDIA: blank window unless DMA-BUF is disabled.
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

#[cfg(not(target_os = "linux"))]
pub fn apply_workarounds() {}

#[cfg(target_os = "linux")]
fn env_is_set(key: &str) -> bool {
    match std::env::var_os(key) {
        Some(v) => !v.is_empty(),
        None => false,
    }
}
