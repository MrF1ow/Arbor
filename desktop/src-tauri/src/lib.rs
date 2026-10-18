mod commands;
mod db;
mod jobs;
mod secrets;
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
            commands::list_providers,
            commands::plan_update,
            commands::get_settings,
            commands::save_settings,
            commands::set_provider_secret,
            commands::clear_provider_secret,
            commands::provider_secret_status,
            commands::start_update,
            commands::start_study_job,
            commands::start_embed_job,
            commands::cancel_update,
            commands::open_folder,
            commands::init_knowledge_repo,
            commands::list_jobs,
            commands::get_job_events,
            commands::init_arbor_db,
            commands::search_knowledge,
            commands::search_semantic,
            commands::reindex_knowledge,
            commands::get_knowledge_settings,
            commands::save_knowledge_settings,
            commands::start_folder_watch,
            commands::list_courses,
            commands::create_course,
            commands::import_sources,
            commands::list_digests,
            commands::read_markdown,
            commands::read_study_json,
            commands::read_flashcard_progress,
            commands::write_flashcard_progress,
            commands::read_quiz_progress,
            commands::write_quiz_progress,
            commands::study_progress,
            commands::study_plan,
            commands::append_card,
            commands::study_artifact_stale,
            commands::read_chat_history,
            commands::append_chat_lines,
            commands::clear_chat_history,
            commands::start_chat,
            commands::sync_show,
            commands::sync_set_remote,
            commands::sync_set_shared,
            commands::create_shared_library,
            commands::join_library,
            commands::sync_now,
            commands::sync_resolve,
            commands::sync_continue,
            commands::read_sync_conflict,
            commands::skill_index,
            commands::skill_install,
            commands::skill_uninstall,
            commands::skill_run,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Arbor");
}
