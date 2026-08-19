pub mod linux_graphics;
mod db;
mod jobs;
mod settings;
mod worker;
mod commands;

use jobs::JobCoordinator;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(JobCoordinator::new()))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::check_auth,
            commands::list_models,
            commands::plan_update,
            commands::get_settings,
            commands::save_settings,
            commands::start_update,
            commands::cancel_update,
            commands::open_folder,
            commands::init_knowledge_repo,
            commands::list_jobs,
            commands::get_job_events,
            commands::init_arbor_db,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Arbor");
}
