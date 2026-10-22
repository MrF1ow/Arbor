mod auth_cache;
mod chat_threads;
mod commands;
mod db;
mod jobs;
mod secrets;
pub mod linux_graphics;
mod search;
mod settings;
mod watch;
mod transport;
mod remote_job;
mod worker;
mod worker_pool;

use jobs::JobCoordinator;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use worker_pool::WorkerPool;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let watch_state = Arc::new(watch::WatchState::new());
    let worker_pool = Arc::new(WorkerPool::new());
    tauri::Builder::default()
        .manage(Mutex::new(JobCoordinator::new()))
        .manage(watch_state)
        .manage(worker_pool.clone())
        .setup({
            let worker_pool = worker_pool.clone();
            move |app| {
                worker_pool.prewarm(&commands::repo_dir(app.handle()));
                Ok(())
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            commands::check_auth,
            commands::list_models,
            commands::list_providers,
            commands::plan_update,
            commands::get_settings,
            commands::save_settings,
            commands::test_worker_connection,
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
            chat_threads::list_chat_threads,
            chat_threads::create_chat_thread,
            chat_threads::read_chat_thread,
            chat_threads::append_chat_thread_lines,
            chat_threads::rename_chat_thread,
            chat_threads::set_chat_thread_mode,
            chat_threads::delete_chat_thread,
            chat_threads::delete_all_chat_threads,
            commands::start_chat,
            commands::sync_show,
            commands::sync_set_remote,
            commands::sync_set_shared,
            commands::create_shared_library,
            commands::join_library,
            commands::library_show,
            commands::library_set_members,
            commands::library_set_provider,
            commands::sync_now,
            commands::sync_resolve,
            commands::sync_continue,
            commands::read_sync_conflict,
            commands::skill_index,
            commands::skill_install,
            commands::skill_uninstall,
            commands::skill_run,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Arbor")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(pool) = app_handle.try_state::<Arc<WorkerPool>>() {
                    pool.shutdown();
                }
            }
        });
}
