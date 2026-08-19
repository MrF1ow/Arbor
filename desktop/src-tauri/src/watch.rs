use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const DEBOUNCE: Duration = Duration::from_secs(3);

pub struct WatchState {
    inner: Mutex<WatchInner>,
}

struct WatchInner {
    generation: u64,
    root: Option<PathBuf>,
    pending: HashMap<PathBuf, Instant>,
    last_emit: Option<Instant>,
}

impl WatchState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(WatchInner {
                generation: 0,
                root: None,
                pending: HashMap::new(),
                last_emit: None,
            }),
        }
    }

    pub fn start(self: &Arc<Self>, app: AppHandle, root: PathBuf) {
        let generation = {
            let mut guard = self.inner.lock().expect("watch lock");
            guard.generation += 1;
            guard.root = Some(root.clone());
            guard.pending.clear();
            guard.last_emit = None;
            guard.generation
        };
        let state = Arc::clone(self);
        std::thread::spawn(move || run_watcher(app, state, root, generation));
    }

    fn note_change(&self, generation: u64, path: PathBuf) {
        let mut guard = self.inner.lock().expect("watch lock");
        if guard.generation != generation {
            return;
        }
        guard.pending.insert(path, Instant::now());
    }

    fn poll_emit(&self, generation: u64) -> Option<String> {
        let mut guard = self.inner.lock().expect("watch lock");
        if guard.generation != generation {
            return None;
        }
        let now = Instant::now();
        guard
            .pending
            .retain(|_, at| now.duration_since(*at) < DEBOUNCE * 4);
        let has_ready = guard
            .pending
            .values()
            .any(|at| now.duration_since(*at) >= DEBOUNCE);
        if !has_ready {
            return None;
        }
        if guard
            .last_emit
            .is_some_and(|t| now.duration_since(t) < DEBOUNCE)
        {
            return None;
        }
        guard.pending.clear();
        guard.last_emit = Some(now);
        guard.root.as_ref().map(|p| p.to_string_lossy().into_owned())
    }
}

fn run_watcher(app: AppHandle, state: Arc<WatchState>, root: PathBuf, generation: u64) {
    let (tx, rx) = std::sync::mpsc::channel();
    let mut watcher = match RecommendedWatcher::new(
        move |res| {
            if let Ok(event) = res {
                let _ = tx.send(event);
            }
        },
        Config::default(),
    ) {
        Ok(w) => w,
        Err(e) => {
            let _ = app.emit(
                "arbor://watch-error",
                serde_json::json!({ "message": format!("watch failed: {e}") }),
            );
            return;
        }
    };
    if watcher.watch(&root, RecursiveMode::Recursive).is_err() {
        return;
    }
    loop {
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(event) => {
                if matches!(
                    event.kind,
                    EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
                ) {
                    for path in event.paths {
                        if should_watch(&path) {
                            state.note_change(generation, path);
                        }
                    }
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if let Some(root_str) = state.poll_emit(generation) {
                    let _ = app.emit(
                        "arbor://files-changed",
                        serde_json::json!({ "root": root_str }),
                    );
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn should_watch(path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name.starts_with('.') || name == "_arbor_cache" {
        return false;
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    matches!(ext.as_str(), "pdf" | "pptx" | "docx" | "md")
}
