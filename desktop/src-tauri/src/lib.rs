mod commands;
mod db;
mod jobs;
pub mod linux_graphics;
mod search;
mod settings;
mod watch;
mod worker;

use jobs::JobCoordinator;
use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let watch_state = Arc::new(watch::WatchState::new());
    tauri::Builder::default()
        .manage(Mutex::new(JobCoordinator::new()))
        .manage(watch_state)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            commands::check_auth,
            commands::list_models,
            commands::plan_update,
            commands::get_settings,
            commands::save_settings,
            commands::start_update,
            commands::start_study_job,
            commands::cancel_update,
            commands::open_folder,
            commands::init_knowledge_repo,
            commands::list_jobs,
            commands::get_job_events,
            commands::init_arbor_db,
            commands::search_knowledge,
            commands::reindex_knowledge,
            commands::get_knowledge_settings,
            commands::save_knowledge_settings,
            commands::start_folder_watch,
            commands::list_courses,
            commands::list_digests,
            commands::read_markdown,
            commands::read_study_json,
            commands::read_flashcard_progress,
            commands::write_flashcard_progress,
            commands::study_artifact_stale,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Arbor");
}
