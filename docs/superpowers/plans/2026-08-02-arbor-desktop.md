# Arbor Desktop (Tauri) Implementation Plan

> **Status (2026-08-22):** Historical shell plan. Superseded by [`docs/superpowers/specs/2026-08-22-v3-desktop-shell-design.md`](../../specs/2026-08-22-v3-desktop-shell-design.md) (shipped in package **v2.1.0**, Version 3 in progress).
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Depends on:** `docs/superpowers/plans/2026-08-02-arbor-worker.md` must be implemented first — this shell drives the `arbor-worker` CLI.

**Goal:** Build a minimal macOS/Linux Tauri desktop shell that lets the user pick a git-tracked Knowledge folder, see Codex auth status, choose a model, click **Update Knowledge**, and watch per-lecture progress as the Python worker produces and commits digests.

**Architecture:** Tauri v2. A thin Rust layer persists settings, resolves and spawns the `arbor-worker` CLI as a child process, streams its JSONL stdout back to the UI as `arbor://progress` events, and exposes small commands (`check_auth`, `list_models`, `start_update`, `cancel_update`, `open_folder`, `init_knowledge_repo`, `get_settings`, `save_settings`). The frontend is a single vanilla-TypeScript screen. Rust contains no AI logic and no pipeline logic — it only orchestrates the worker.

**Tech Stack:** Tauri v2 (Rust), `tauri-plugin-dialog` (folder picker), vanilla TypeScript + Vite frontend, Node 20+/npm. The Python worker is invoked via `uv run` in dev.

## Global Constraints

- **Platforms:** macOS and Linux only. Use `#[cfg(target_os = ...)]` only to choose `open`/`xdg-open`; no Windows branch required.
- **AI access:** The shell NEVER calls Codex or any AI directly and NEVER handles API keys. All AI work happens inside the worker.
- **Auth gate:** The **Update Knowledge** button is disabled unless `check_auth` reports authenticated. Auth is re-checked on app focus and before each update.
- **Worker is the source of truth:** Rust does not parse PDFs, render images, or touch git for digests. It forwards worker events verbatim to the UI.
- **Worker invocation (dev default):** `uv run --project <ARBOR_PYTHON_DIR> arbor-worker <args>`, overridable via env `ARBOR_WORKER_CMD`. `ARBOR_PYTHON_DIR` defaults to the repo's `python/` dir.
- **Progress channel:** Rust emits Tauri events named `arbor://progress` with `{ line: <raw JSONL string> }`; the frontend parses each line.
- **Cancel:** `start_update` passes `--cancel-file <path>`; `cancel_update` creates that file. The worker stops at the next stage boundary.
- **Format guidance copy (must appear verbatim in the UI):** "Handwritten / GoodNotes markup → export and upload as PDF. Clean digital slides with no ink → PPTX is fine."

---

## File Structure

All paths relative to repo root `/home/flow/Projects/personal/Arbor`.

```
desktop/
  package.json                       # scripts, @tauri-apps deps
  index.html                         # single screen markup
  src/
    main.ts                          # UI wiring: invoke commands + listen events
    styles.css                       # minimal styling
    types.ts                         # TS types for events, settings, models
  src-tauri/
    Cargo.toml                       # tauri + plugin deps; lib target
    tauri.conf.json                  # app config, window, bundle
    build.rs                         # tauri build
    capabilities/default.json        # permissions (core + dialog)
    src/
      main.rs                        # binary entry -> app_lib::run()
      lib.rs                         # builder, plugins, invoke_handler
      settings.rs                    # Settings struct, load/save, path
      worker.rs                      # command resolver + spawn/stream + cancel
      commands.rs                    # #[tauri::command] fns
```

**Design boundaries:**
- `worker.rs` owns process spawning and the argv resolver (pure `resolve_worker_argv` is unit-tested).
- `settings.rs` owns persistence (pure serde round-trip is unit-tested).
- `commands.rs` is a thin glue layer that Tauri exposes; it delegates to `worker`/`settings`.
- Frontend never spawns processes; it only calls commands and renders events.

---

### Task 1: Scaffold the Tauri v2 app

**Files:**
- Create: everything under `desktop/` via the scaffolder, then trim.

**Interfaces:**
- Produces: a buildable Tauri v2 app named "Arbor" with a lib target `app_lib` and dev/build npm scripts. No custom commands yet.

- [ ] **Step 1: Scaffold with create-tauri-app (vanilla TS)**

Run (from repo root):

```bash
npm create tauri-app@latest desktop -- --template vanilla-ts --manager npm --yes
```

If the interactive prompt still appears, answer: identifier `com.arbor.app`, frontend language TypeScript, package manager npm, UI template Vanilla, flavor TypeScript.

- [ ] **Step 2: Set the product name and identifier**

Edit `desktop/src-tauri/tauri.conf.json` so these keys are set (leave the rest as scaffolded):

```json
{
  "productName": "Arbor",
  "identifier": "com.arbor.app",
  "app": {
    "windows": [
      {
        "title": "Arbor",
        "width": 720,
        "height": 640,
        "resizable": true
      }
    ]
  }
}
```

- [ ] **Step 3: Install deps and verify a clean build**

Run:

```bash
cd desktop && npm install && npm run tauri build -- --no-bundle
```

Expected: Rust compiles and the frontend builds with no errors (bundling skipped for speed). On Linux this requires webkit2gtk/libsoup dev packages; if the build complains, install them (e.g. Arch: `sudo pacman -S webkit2gtk-4.1 libsoup3 base-devel`).

- [ ] **Step 4: Commit**

```bash
git add desktop .gitignore
git commit -m "feat(desktop): scaffold Tauri v2 vanilla-ts app 'Arbor'"
```

---

### Task 2: Settings persistence (Rust)

**Files:**
- Create: `desktop/src-tauri/src/settings.rs`
- Modify: `desktop/src-tauri/src/lib.rs` (declare `mod settings;`)

**Interfaces:**
- Produces:
  - `Settings { knowledge_root: Option<String>, model_id: Option<String> }` (serde, `Default`).
  - `settings_path(app: &tauri::AppHandle) -> PathBuf` → `<app_config_dir>/settings.json`.
  - `load(app) -> Settings` (returns default if file absent/invalid).
  - `save(app, &Settings) -> Result<(), String>`.
  - Pure helpers `to_json(&Settings) -> String` and `from_json(&str) -> Settings` for unit tests.

- [ ] **Step 1: Write the failing Rust test + module**

Create `desktop/src-tauri/src/settings.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Settings {
    #[serde(default)]
    pub knowledge_root: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
}

pub fn to_json(s: &Settings) -> String {
    serde_json::to_string_pretty(s).unwrap_or_else(|_| "{}".to_string())
}

pub fn from_json(text: &str) -> Settings {
    serde_json::from_str(text).unwrap_or_default()
}

#[cfg(feature = "desktop-runtime")]
pub fn settings_path(app: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;
    let dir = app
        .path()
        .app_config_dir()
        .expect("app config dir");
    dir.join("settings.json")
}

#[cfg(feature = "desktop-runtime")]
pub fn load(app: &tauri::AppHandle) -> Settings {
    let path = settings_path(app);
    match std::fs::read_to_string(&path) {
        Ok(text) => from_json(&text),
        Err(_) => Settings::default(),
    }
}

#[cfg(feature = "desktop-runtime")]
pub fn save(app: &tauri::AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, to_json(settings)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_roundtrip() {
        let s = Settings {
            knowledge_root: Some("/home/x/Knowledge".into()),
            model_id: Some("gpt-5.6-sol".into()),
        };
        let back = from_json(&to_json(&s));
        assert_eq!(s, back);
    }

    #[test]
    fn from_invalid_is_default() {
        assert_eq!(from_json("not json"), Settings::default());
    }

    #[test]
    fn missing_fields_default_to_none() {
        let s = from_json("{}");
        assert!(s.knowledge_root.is_none());
        assert!(s.model_id.is_none());
    }
}
```

> The `desktop-runtime` feature guards Tauri-dependent fns so `cargo test` can run the pure logic without a running app. Add the feature in Step 2.

- [ ] **Step 2: Declare the module and feature**

In `desktop/src-tauri/src/lib.rs`, add near the top (after any existing `use`):

```rust
mod settings;
mod worker;
mod commands;
```

> `worker` and `commands` are created in later tasks; add all three now so `lib.rs` is stable. If `cargo test` in this task fails because `worker`/`commands` don't exist yet, temporarily comment those two lines and restore them in Task 4/6. (Recommended: implement Tasks 2→6 in one sitting.)

In `desktop/src-tauri/Cargo.toml`, add a features section and ensure serde_json is present:

```toml
[features]
default = ["desktop-runtime"]
desktop-runtime = []

[dependencies]
serde_json = "1"
```

(Keep the existing `tauri`, `serde` dependencies from the scaffold.)

- [ ] **Step 3: Run the Rust unit tests**

Run: `cd desktop/src-tauri && cargo test --no-default-features settings`
Expected: PASS (3 tests) — `--no-default-features` disables `desktop-runtime` so only pure fns compile.

- [ ] **Step 4: Commit**

```bash
git add desktop/src-tauri/src/settings.rs desktop/src-tauri/src/lib.rs desktop/src-tauri/Cargo.toml
git commit -m "feat(desktop): settings persistence with pure json helpers"
```

---

### Task 3: Worker argv resolver (Rust, pure + unit-tested)

**Files:**
- Create: `desktop/src-tauri/src/worker.rs`

**Interfaces:**
- Produces:
  - `resolve_worker_argv(env: &dyn Fn(&str) -> Option<String>, default_python_dir: &str, sub_args: &[&str]) -> Vec<String>`:
    - if `ARBOR_WORKER_CMD` set → split on whitespace, then append `sub_args`.
    - else → `["uv", "run", "--project", <ARBOR_PYTHON_DIR or default_python_dir>, "arbor-worker", <sub_args...>]`.
  - `default_python_dir(app_dir: &Path) -> String` → sibling `python/` dir of the repo (documented dev assumption).
- Spawn/stream fns are added in Task 6; this task is the pure resolver only.

- [ ] **Step 1: Write the failing test + resolver**

Create `desktop/src-tauri/src/worker.rs`:

```rust
use std::path::Path;

pub fn resolve_worker_argv(
    env: &dyn Fn(&str) -> Option<String>,
    default_python_dir: &str,
    sub_args: &[&str],
) -> Vec<String> {
    if let Some(cmd) = env("ARBOR_WORKER_CMD") {
        let mut argv: Vec<String> = cmd.split_whitespace().map(|s| s.to_string()).collect();
        argv.extend(sub_args.iter().map(|s| s.to_string()));
        return argv;
    }
    let python_dir = env("ARBOR_PYTHON_DIR").unwrap_or_else(|| default_python_dir.to_string());
    let mut argv = vec![
        "uv".to_string(),
        "run".to_string(),
        "--project".to_string(),
        python_dir,
        "arbor-worker".to_string(),
    ];
    argv.extend(sub_args.iter().map(|s| s.to_string()));
    argv
}

#[allow(dead_code)]
pub fn default_python_dir(app_dir: &Path) -> String {
    // Dev assumption: the repo's `python/` dir sits next to `desktop/`.
    app_dir.join("python").to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_env(_: &str) -> Option<String> {
        None
    }

    #[test]
    fn default_uses_uv_run() {
        let argv = resolve_worker_argv(&no_env, "/repo/python", &["check-auth"]);
        assert_eq!(
            argv,
            vec!["uv", "run", "--project", "/repo/python", "arbor-worker", "check-auth"]
        );
    }

    #[test]
    fn env_override_splits_and_appends() {
        let env = |k: &str| {
            if k == "ARBOR_WORKER_CMD" {
                Some("arbor-worker".to_string())
            } else {
                None
            }
        };
        let argv = resolve_worker_argv(&env, "/repo/python", &["update", "--root", "/k"]);
        assert_eq!(argv, vec!["arbor-worker", "update", "--root", "/k"]);
    }

    #[test]
    fn python_dir_env_override() {
        let env = |k: &str| {
            if k == "ARBOR_PYTHON_DIR" {
                Some("/custom/py".to_string())
            } else {
                None
            }
        };
        let argv = resolve_worker_argv(&env, "/repo/python", &["list-models"]);
        assert_eq!(argv[3], "/custom/py");
    }
}
```

- [ ] **Step 2: Run the Rust unit tests**

Run: `cd desktop/src-tauri && cargo test --no-default-features worker`
Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add desktop/src-tauri/src/worker.rs
git commit -m "feat(desktop): pure worker argv resolver with env overrides"
```

---

### Task 4: `check_auth` + `list_models` commands

**Files:**
- Modify: `desktop/src-tauri/src/worker.rs` (add blocking `run_worker_json`)
- Create: `desktop/src-tauri/src/commands.rs`
- Modify: `desktop/src-tauri/src/lib.rs` (register plugins + handlers)

**Interfaces:**
- Produces in `worker.rs`:
  - `run_worker_json(app_dir: &Path, sub_args: &[&str]) -> Result<serde_json::Value, String>` — runs the worker to completion, parses the **last** stdout line as JSON. Used for `check-auth` and `list-models` (single-object output).
- Produces in `commands.rs` (all `#[tauri::command]`):
  - `check_auth() -> Result<serde_json::Value, String>` → `{authenticated, reason, docs_url}`.
  - `list_models(root: Option<String>) -> Result<serde_json::Value, String>` → `{models: [{id,label}]}`.
  - `get_settings(app) -> Settings`; `save_settings(app, settings: Settings) -> Result<(), String>`.

- [ ] **Step 1: Add the blocking JSON runner to `worker.rs`**

Append to `desktop/src-tauri/src/worker.rs`:

```rust
use std::process::Command;

#[cfg(feature = "desktop-runtime")]
pub fn run_worker_json(app_dir: &Path, sub_args: &[&str]) -> Result<serde_json::Value, String> {
    let argv = resolve_worker_argv(&|k| std::env::var(k).ok(), &default_python_dir(app_dir), sub_args);
    let output = Command::new(&argv[0])
        .args(&argv[1..])
        .output()
        .map_err(|e| format!("failed to launch worker: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let last = stdout
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .ok_or_else(|| {
            format!(
                "worker produced no output (stderr: {})",
                String::from_utf8_lossy(&output.stderr)
            )
        })?;
    serde_json::from_str(last).map_err(|e| format!("invalid worker json: {e}: {last}"))
}
```

- [ ] **Step 2: Implement the commands**

Create `desktop/src-tauri/src/commands.rs`:

```rust
use crate::settings::{self, Settings};
use crate::worker;
use std::path::PathBuf;
use tauri::Manager;

fn repo_dir(app: &tauri::AppHandle) -> PathBuf {
    // Dev: resolve the repo root as the current working directory's parent of `desktop`.
    // ARBOR_PYTHON_DIR / ARBOR_WORKER_CMD override this entirely in resolve_worker_argv.
    std::env::var("ARBOR_REPO_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            app.path()
                .resource_dir()
                .ok()
                .and_then(|d| d.parent().map(|p| p.to_path_buf()))
                .unwrap_or_else(|| PathBuf::from("."))
        })
}

#[tauri::command]
pub fn check_auth(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    worker::run_worker_json(&repo_dir(&app), &["check-auth"])
}

#[tauri::command]
pub fn list_models(app: tauri::AppHandle, root: Option<String>) -> Result<serde_json::Value, String> {
    let mut args: Vec<&str> = vec!["list-models"];
    if let Some(r) = root.as_deref() {
        args.push("--root");
        args.push(r);
    }
    worker::run_worker_json(&repo_dir(&app), &args)
}

#[tauri::command]
pub fn get_settings(app: tauri::AppHandle) -> Settings {
    settings::load(&app)
}

#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    settings::save(&app, &settings)
}
```

- [ ] **Step 3: Register plugins and handlers in `lib.rs`**

Replace the body of the `run()` builder in `desktop/src-tauri/src/lib.rs` so it registers the dialog plugin and the commands (keep the existing `#[cfg_attr(mobile, tauri::mobile_entry_point)]` attribute on `run`):

```rust
mod settings;
mod worker;
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::check_auth,
            commands::list_models,
            commands::get_settings,
            commands::save_settings,
            commands::start_update,
            commands::cancel_update,
            commands::open_folder,
            commands::init_knowledge_repo,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Arbor");
}
```

> `start_update`, `cancel_update`, `open_folder`, `init_knowledge_repo` are implemented in Tasks 5–7. Register them now; implement before building. If you must build between tasks, temporarily remove the not-yet-implemented names from `generate_handler!`.

Add the dialog plugin to `desktop/src-tauri/Cargo.toml` dependencies:

```toml
tauri-plugin-dialog = "2"
```

- [ ] **Step 4: Add dialog permission to capabilities**

Edit `desktop/src-tauri/capabilities/default.json` so `permissions` includes at least:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability for the Arbor main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:allow-open"
  ]
}
```

- [ ] **Step 5: Verify it compiles**

Run: `cd desktop/src-tauri && cargo build`
Expected: compiles (with warnings for the yet-unused command fns is fine once Tasks 5–7 land; if building now, temporarily trim `generate_handler!` as noted).

- [ ] **Step 6: Commit**

```bash
git add desktop/src-tauri/src/worker.rs desktop/src-tauri/src/commands.rs desktop/src-tauri/src/lib.rs desktop/src-tauri/Cargo.toml desktop/src-tauri/capabilities/default.json
git commit -m "feat(desktop): check_auth, list_models, settings commands"
```

---

### Task 5: `init_knowledge_repo` command

**Files:**
- Modify: `desktop/src-tauri/src/commands.rs`

**Interfaces:**
- Produces: `init_knowledge_repo(path: String) -> Result<bool, String>` — if `<path>/.git` exists, returns `false` (already a repo). Otherwise runs `git init` + an initial empty commit so the worker's dirty-detection has a HEAD, and returns `true`. Uses `std::process::Command`.

- [ ] **Step 1: Implement the command**

Append to `desktop/src-tauri/src/commands.rs`:

```rust
use std::path::Path;
use std::process::Command;

#[tauri::command]
pub fn init_knowledge_repo(path: String) -> Result<bool, String> {
    let root = Path::new(&path);
    if !root.is_dir() {
        return Err(format!("Not a folder: {path}"));
    }
    if root.join(".git").exists() {
        return Ok(false);
    }
    let run = |args: &[&str]| -> Result<(), String> {
        let out = Command::new("git")
            .arg("-C")
            .arg(&path)
            .args(args)
            .output()
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    };
    run(&["init"])?;
    run(&["commit", "--allow-empty", "-m", "Initialize Arbor knowledge library"])?;
    Ok(true)
}
```

> Note: `git commit` requires a configured `user.name`/`user.email`. On machines without global git identity this fails; the returned error surfaces in the UI telling the user to set their git identity. This is acceptable for V1.

- [ ] **Step 2: Verify it compiles**

Run: `cd desktop/src-tauri && cargo build`
Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add desktop/src-tauri/src/commands.rs
git commit -m "feat(desktop): init_knowledge_repo command"
```

---

### Task 6: `start_update` streaming + `cancel_update`

**Files:**
- Modify: `desktop/src-tauri/src/worker.rs` (streaming spawn)
- Modify: `desktop/src-tauri/src/commands.rs`

**Interfaces:**
- Produces in `worker.rs`:
  - `cancel_file_path(app_dir: &Path) -> PathBuf` → a stable temp path (e.g. `<std::env::temp_dir()>/arbor-cancel.flag`).
  - `spawn_update_stream(app: tauri::AppHandle, app_dir: PathBuf, root: String, model: String, cancel_file: PathBuf)` — spawns the worker `update` with `--cancel-file`, reads stdout line-by-line on a background thread, emits `arbor://progress` `{line}` for each line, and emits a final `arbor://progress` `{line: "{\"type\":\"worker_exit\",\"code\":N}"}` when the process ends.
- Produces in `commands.rs`:
  - `start_update(app, root: String, model: String) -> Result<(), String>` — removes any stale cancel file, then calls `spawn_update_stream`.
  - `cancel_update(app) -> Result<(), String>` — writes the cancel file.

- [ ] **Step 1: Implement streaming in `worker.rs`**

Append to `desktop/src-tauri/src/worker.rs`:

```rust
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::Stdio;

#[cfg(feature = "desktop-runtime")]
pub fn cancel_file_path() -> PathBuf {
    std::env::temp_dir().join("arbor-cancel.flag")
}

#[cfg(feature = "desktop-runtime")]
pub fn spawn_update_stream(
    app: tauri::AppHandle,
    app_dir: PathBuf,
    root: String,
    model: String,
    cancel_file: PathBuf,
) {
    use tauri::Emitter;

    let cancel_str = cancel_file.to_string_lossy().to_string();
    let sub_args = ["update", "--root", &root, "--model", &model, "--cancel-file", &cancel_str];
    let argv = resolve_worker_argv(&|k| std::env::var(k).ok(), &default_python_dir(&app_dir), &sub_args);

    std::thread::spawn(move || {
        let mut child = match Command::new(&argv[0])
            .args(&argv[1..])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                let _ = app.emit(
                    "arbor://progress",
                    serde_json::json!({ "line": format!("{{\"type\":\"error\",\"message\":\"failed to launch worker: {e}\"}}") }),
                );
                return;
            }
        };

        if let Some(stdout) = child.stdout.take() {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                let _ = app.emit("arbor://progress", serde_json::json!({ "line": line }));
            }
        }

        let code = child.wait().ok().and_then(|s| s.code()).unwrap_or(-1);
        let _ = app.emit(
            "arbor://progress",
            serde_json::json!({ "line": format!("{{\"type\":\"worker_exit\",\"code\":{code}}}") }),
        );
    });
}
```

- [ ] **Step 2: Implement the commands**

Append to `desktop/src-tauri/src/commands.rs`:

```rust
#[tauri::command]
pub fn start_update(app: tauri::AppHandle, root: String, model: String) -> Result<(), String> {
    let cancel = worker::cancel_file_path();
    let _ = std::fs::remove_file(&cancel); // clear stale cancel
    let app_dir = repo_dir(&app);
    worker::spawn_update_stream(app, app_dir, root, model, cancel);
    Ok(())
}

#[tauri::command]
pub fn cancel_update(_app: tauri::AppHandle) -> Result<(), String> {
    let cancel = worker::cancel_file_path();
    std::fs::write(&cancel, b"stop").map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Verify it compiles with all handlers**

Run: `cd desktop/src-tauri && cargo build`
Expected: compiles with all eight commands registered.

- [ ] **Step 4: Commit**

```bash
git add desktop/src-tauri/src/worker.rs desktop/src-tauri/src/commands.rs
git commit -m "feat(desktop): stream worker update events and support cancel"
```

---

### Task 7: `open_folder` command

**Files:**
- Modify: `desktop/src-tauri/src/commands.rs`

**Interfaces:**
- Produces: `open_folder(path: String) -> Result<(), String>` — opens the folder in the OS file manager: `open` on macOS, `xdg-open` on Linux.

- [ ] **Step 1: Implement the command**

Append to `desktop/src-tauri/src/commands.rs`:

```rust
#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "linux")]
    let program = "xdg-open";

    Command::new(program)
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd desktop/src-tauri && cargo build`
Expected: compiles on macOS and Linux.

- [ ] **Step 3: Commit**

```bash
git add desktop/src-tauri/src/commands.rs
git commit -m "feat(desktop): open_folder in system file manager"
```

---

### Task 8: Frontend types

**Files:**
- Create: `desktop/src/types.ts`

**Interfaces:**
- Produces TS types used by `main.ts`:
  - `Model { id: string; label: string }`
  - `AuthStatus { authenticated: boolean; reason: string; docs_url: string }`
  - `Settings { knowledge_root: string | null; model_id: string | null }`
  - `WorkerEvent` union with a `type` discriminant covering all worker event types plus `worker_exit`.

- [ ] **Step 1: Create the types**

Create `desktop/src/types.ts`:

```ts
export interface Model {
  id: string;
  label: string;
}

export interface AuthStatus {
  authenticated: boolean;
  reason: string;
  docs_url: string;
}

export interface Settings {
  knowledge_root: string | null;
  model_id: string | null;
}

export interface WorkerEvent {
  type: string;
  ts?: string;
  // common optional fields
  lecture_dir?: string;
  source?: string;
  stage?: string;
  status?: string;
  detail?: string;
  message?: string;
  commit?: string;
  lectures?: string[];
  processed?: number;
  failed?: number;
  skipped?: number;
  reason?: string;
  docs_url?: string;
  code?: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/types.ts
git commit -m "feat(desktop): frontend event and settings types"
```

---

### Task 9: Frontend UI + wiring

**Files:**
- Replace: `desktop/index.html`
- Replace: `desktop/src/main.ts`
- Create: `desktop/src/styles.css`

**Interfaces:**
- Consumes all commands and the `arbor://progress` event.
- Produces the single-screen UI with: Knowledge root + Choose folder, verbatim format guidance, model dropdown, Codex status (with docs link when failed), Update button (disabled unless authenticated), Cancel button (enabled during a run), progress log, Open folder.

- [ ] **Step 1: Replace `index.html`**

Create `desktop/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Arbor</title>
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body>
    <main class="app">
      <h1>Arbor</h1>

      <section class="row">
        <label>Knowledge folder</label>
        <div class="folder">
          <span id="root-path" class="path">No folder selected</span>
          <button id="choose-folder">Choose folder…</button>
          <button id="open-folder" disabled>Open</button>
        </div>
      </section>

      <p class="guidance">
        Handwritten / GoodNotes markup → export and upload as PDF.
        Clean digital slides with no ink → PPTX is fine.
      </p>

      <section class="row">
        <label for="model">Model</label>
        <select id="model"></select>
      </section>

      <section class="row status">
        <span id="codex-status" class="badge">Checking Codex…</span>
        <a id="codex-docs" href="#" target="_blank" rel="noreferrer" hidden>Set up Codex</a>
      </section>

      <section class="row actions">
        <button id="update" disabled>Update Knowledge</button>
        <button id="cancel" disabled>Cancel</button>
      </section>

      <pre id="log" class="log" aria-live="polite"></pre>
    </main>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `styles.css`**

Create `desktop/src/styles.css`:

```css
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
.app { max-width: 680px; margin: 0 auto; padding: 1.5rem; }
h1 { margin: 0 0 1rem; }
.row { margin: 0.75rem 0; display: flex; flex-direction: column; gap: 0.35rem; }
.folder { display: flex; gap: 0.5rem; align-items: center; }
.path { flex: 1; font-family: ui-monospace, monospace; opacity: 0.8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.guidance { background: rgba(127,127,127,0.12); padding: 0.6rem 0.8rem; border-radius: 8px; font-size: 0.9rem; }
select, button { padding: 0.45rem 0.7rem; border-radius: 8px; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
.badge { padding: 0.2rem 0.6rem; border-radius: 999px; background: #ddd; color: #222; font-size: 0.85rem; }
.badge.ok { background: #1f9d55; color: white; }
.badge.bad { background: #c0392b; color: white; }
.actions { flex-direction: row; gap: 0.5rem; }
.log { margin-top: 1rem; height: 260px; overflow: auto; background: #111; color: #d7f5d7; padding: 0.8rem; border-radius: 8px; font-size: 0.82rem; white-space: pre-wrap; }
```

- [ ] **Step 3: Replace `main.ts`**

Create `desktop/src/main.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { AuthStatus, Model, Settings, WorkerEvent } from "./types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const rootPathEl = $("root-path") as HTMLSpanElement;
const chooseBtn = $("choose-folder") as HTMLButtonElement;
const openBtn = $("open-folder") as HTMLButtonElement;
const modelSel = $("model") as HTMLSelectElement;
const statusEl = $("codex-status") as HTMLSpanElement;
const docsLink = $("codex-docs") as HTMLAnchorElement;
const updateBtn = $("update") as HTMLButtonElement;
const cancelBtn = $("cancel") as HTMLButtonElement;
const logEl = $("log") as HTMLPreElement;

let knowledgeRoot: string | null = null;
let authed = false;

function logLine(text: string) {
  logEl.textContent += text + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

function refreshUpdateEnabled() {
  updateBtn.disabled = !(authed && knowledgeRoot);
}

async function loadSettings() {
  const s = await invoke<Settings>("get_settings");
  if (s.knowledge_root) {
    knowledgeRoot = s.knowledge_root;
    rootPathEl.textContent = s.knowledge_root;
    openBtn.disabled = false;
  }
  await loadModels(s.model_id);
}

async function persist() {
  const settings: Settings = {
    knowledge_root: knowledgeRoot,
    model_id: modelSel.value || null,
  };
  await invoke("save_settings", { settings });
}

async function loadModels(selected: string | null) {
  const res = await invoke<{ models: Model[] }>("list_models", {
    root: knowledgeRoot ?? undefined,
  });
  modelSel.innerHTML = "";
  for (const m of res.models) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.label;
    modelSel.appendChild(opt);
  }
  if (selected) modelSel.value = selected;
}

async function refreshAuth() {
  statusEl.textContent = "Checking Codex…";
  statusEl.className = "badge";
  docsLink.hidden = true;
  try {
    const a = await invoke<AuthStatus>("check_auth");
    authed = a.authenticated;
    if (a.authenticated) {
      statusEl.textContent = "Codex ready";
      statusEl.className = "badge ok";
    } else {
      statusEl.textContent = `Codex: ${a.reason}`;
      statusEl.className = "badge bad";
      docsLink.href = a.docs_url;
      docsLink.hidden = false;
    }
  } catch (e) {
    authed = false;
    statusEl.textContent = `Codex check failed: ${e}`;
    statusEl.className = "badge bad";
  }
  refreshUpdateEnabled();
}

chooseBtn.addEventListener("click", async () => {
  const picked = await open({ directory: true, multiple: false });
  if (typeof picked !== "string") return;
  knowledgeRoot = picked;
  rootPathEl.textContent = picked;
  openBtn.disabled = false;
  try {
    const created = await invoke<boolean>("init_knowledge_repo", { path: picked });
    if (created) logLine(`Initialized git repository in ${picked}`);
  } catch (e) {
    logLine(`Could not initialize git: ${e}`);
  }
  await loadModels(modelSel.value || null);
  await persist();
  refreshUpdateEnabled();
});

openBtn.addEventListener("click", async () => {
  if (knowledgeRoot) await invoke("open_folder", { path: knowledgeRoot });
});

modelSel.addEventListener("change", persist);

updateBtn.addEventListener("click", async () => {
  if (!knowledgeRoot || !modelSel.value) return;
  await refreshAuth();
  if (!authed) return;
  logEl.textContent = "";
  updateBtn.disabled = true;
  cancelBtn.disabled = false;
  await invoke("start_update", { root: knowledgeRoot, model: modelSel.value });
});

cancelBtn.addEventListener("click", async () => {
  await invoke("cancel_update");
  logLine("Cancel requested; stopping after the current stage…");
});

function renderEvent(ev: WorkerEvent) {
  switch (ev.type) {
    case "run_started":
      logLine(`Run started (model ${ev.model_id ?? ""})`);
      break;
    case "nothing_to_process":
      logLine("Nothing to process — everything is up to date.");
      break;
    case "lecture_started":
      logLine(`\n• ${ev.lecture_dir} (${ev.source})`);
      break;
    case "stage":
      logLine(`   ${ev.stage}: ${ev.status}${ev.detail ? " — " + ev.detail : ""}`);
      break;
    case "warning":
      logLine(`   ⚠ ${ev.message}`);
      break;
    case "lecture_done":
      logLine(`   ✓ done`);
      break;
    case "lecture_failed":
      logLine(`   ✗ failed at ${ev.stage}: ${ev.message}`);
      break;
    case "cancelled":
      logLine("Cancelled.");
      break;
    case "committed":
      logLine(`Committed ${ev.commit}: ${(ev.lectures ?? []).join(", ")}`);
      break;
    case "run_done":
      logLine(`\nDone. processed=${ev.processed} failed=${ev.failed} skipped=${ev.skipped}`);
      break;
    case "auth_failed":
      logLine(`Codex not authenticated: ${ev.reason}`);
      break;
    case "error":
      logLine(`Error: ${ev.message}`);
      break;
    case "worker_exit":
      updateBtn.disabled = false;
      cancelBtn.disabled = true;
      refreshUpdateEnabled();
      break;
  }
}

listen<{ line: string }>("arbor://progress", (e) => {
  try {
    renderEvent(JSON.parse(e.payload.line) as WorkerEvent);
  } catch {
    logLine(e.payload.line);
  }
});

window.addEventListener("focus", refreshAuth);

(async () => {
  await loadSettings();
  await refreshAuth();
})();
```

- [ ] **Step 4: Verify the frontend builds**

Run: `cd desktop && npm run build`
Expected: TypeScript compiles and Vite builds with no errors.

- [ ] **Step 5: Commit**

```bash
git add desktop/index.html desktop/src/main.ts desktop/src/styles.css
git commit -m "feat(desktop): minimal Update Knowledge UI wired to worker"
```

---

### Task 10: End-to-end manual verification

**Files:**
- Create: `desktop/README.md`

**Interfaces:** none (docs + manual test).

- [ ] **Step 1: Write the desktop README with run + test steps**

Create `desktop/README.md`:

```markdown
# Arbor Desktop

Minimal Tauri v2 shell for Arbor. Drives the `arbor-worker` CLI (see `../python`).

## Prerequisites

- Rust + cargo, Node 20+, npm
- `uv` on PATH and the worker installed: `cd ../python && uv sync`
- Codex CLI installed and authenticated: <https://developers.openai.com/codex/cli>
- Linux only: webkit2gtk + libsoup dev packages
- Optional (PPTX image fallback): LibreOffice (`soffice`)

## Run in dev

```bash
# From repo root, tell the shell where the worker lives:
export ARBOR_REPO_DIR="$(pwd)"          # repo root containing python/
cd desktop && npm install && npm run tauri dev
```

`ARBOR_WORKER_CMD` (space-separated) fully overrides how the worker is launched;
`ARBOR_PYTHON_DIR` overrides just the uv project dir.

## Manual test checklist (real Codex)

1. **Auth blocks work:** with Codex logged out, the badge is red, shows the reason and a
   "Set up Codex" link, and **Update Knowledge** stays disabled.
2. **Auth passes:** `codex login`, refocus the window → badge turns green, button enables.
3. **Pick folder:** choose an empty folder → log shows "Initialized git repository".
4. **Process a PDF:** put an annotated lecture at `Course/Lecture 01/source.pdf`, click
   Update → stages stream, `lecture.md` + `metadata.json` appear, a `digest:` commit is made.
5. **Process a PPTX:** clean deck at `Course/Lecture 02/slides.pptx` → digest produced via
   the text path (`metadata.json` shows `pptx_text`).
6. **Model selection:** switch the dropdown, run again on a changed source → `metadata.json`
   records the new `model_id`.
7. **Idempotency:** click Update with no changes → "Nothing to process".
8. **Cancel:** with two changed sources, click Cancel after the first → only the first is
   committed; log shows "Cancelled".
9. **Open folder:** click Open → the Knowledge folder opens in the file manager.
```

- [ ] **Step 2: Commit**

```bash
git add desktop/README.md
git commit -m "docs(desktop): run instructions and manual test checklist"
```

---

## Self-Review

**Spec coverage check (spec UI/behavior → task):**
- Minimal single-window UI (root, guidance, model, update, log, open folder, Codex status) → Tasks 8–9.
- Format guidance verbatim → Task 9 (`index.html`), matches Global Constraints copy.
- Auth gate disables Update; docs link on failure; re-check on focus and before update → Task 9 (`refreshAuth`, `window focus`, `updateBtn` handler) + Task 4 (`check_auth`).
- Model dropdown from worker, persisted default → Tasks 4, 9 (`list_models`, `persist`, `get/save_settings`).
- `git init` on choosing a non-repo folder → Tasks 5, 9.
- Whole-root Update, streamed per-lecture progress → Task 6 (`start_update` stream) + worker Plan.
- Cancel stops after current stage; no partial commit → Task 6 (`cancel_update` writes flag) + worker Plan Task 15.
- Open folder in file manager → Task 7.
- Mac + Linux only → Task 7 `cfg`; no Windows branch.
- No API keys / no direct AI in shell → all AI via worker (Global Constraints; commands only shell out to worker/git).

**Placeholder scan:** No TBD/TODO. Every code step contains complete Rust/TS. The one scaffolder step (Task 1) uses `create-tauri-app` intentionally rather than hand-copying generated files; all subsequent files are given in full.

**Type consistency:** Command names match between `generate_handler!` (Task 4/6/7), `commands.rs`, and frontend `invoke(...)` calls: `check_auth`, `list_models`, `get_settings`, `save_settings`, `start_update`, `cancel_update`, `open_folder`, `init_knowledge_repo`. The `arbor://progress` `{line}` payload shape matches between `worker.rs` emit and `main.ts` `listen`. `Settings` fields (`knowledge_root`, `model_id`) match between `settings.rs`, `commands.rs`, and `types.ts`.

**Deferred to a later iteration (explicitly out of V1, not gaps):** production packaging of the Python worker as a bundled sidecar (PyInstaller + Tauri `externalBin`) so the app runs without a dev `uv`. V1 runs the worker via `uv run` per the desktop README. Everything else in the spec's V1 scope is covered.
```
