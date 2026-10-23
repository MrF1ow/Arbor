# PR 4: Composer — Ask/Explain switch, slash commands, dictation

Branch `ux/04-composer`, stacked on `ux/03-threads`. Plan: `README.md` (D1). **The agent rules in `../ui-6.0/README.md` apply in full.**

Worktree: `/home/flow/Projects/personal/Arbor/.worktrees/ux-stack`.

## Today (after PR 3)

- The Ask/Explain `ToggleGroup` sits in the chat toolbar row, far from where you type, and you must click it every time.
- A thread stores its `mode` (`set_chat_thread_mode`, PR 3).
- Dictation: Tauri 2.11 installs its default macOS menu, which has an **Edit** submenu, because `lib.rs` sets no custom menu. AppKit then adds "Start Dictation…" to that menu, and the Fn-Fn shortcut works in any focused text field. There is no in-app affordance.

## 1. Mode chip in the composer (`components/chat/chat-view.tsx`, new `components/chat/mode-chip.tsx`)

- Remove the `ToggleGroup` from the toolbar row.
- In the composer, put a footer row under the `Textarea`:
  - **Left:** a mode chip. It's a small `Button variant="ghost" size="xs"` (or `sm`), with the `MessageCircle` icon for Ask and `GraduationCap` for Explain, and the label "Ask" / "Explain".
  - Clicking it toggles the mode; `aria-label="Mode: Ask (Shift+Tab to switch)"`; `aria-pressed` isn't needed.
  - **Right:** the mic button (§3, macOS only) and **Send**.
  - The existing "Generate study artifact" row stays below, unchanged.
- **Shift+Tab** in the textarea toggles the mode: `preventDefault`, not while IME is composing. Plain Tab keeps default focus behaviour.
- **Persistence:** the mode is saved on the thread with `set_chat_thread_mode`, or kept as local state for a new unsaved thread, as PR 3 already does. Only the control moves.
- The placeholder follows the mode: "Ask about this course…" / "Ask for a step-by-step explanation…".

## 2. Slash commands

- If the message starts with `/ask` or `/explain`, followed by a space or the end of the text, case-insensitively:
  - set the mode;
  - strip the command and one following space;
  - send the remainder.
  - If the remainder is empty, switch mode and clear the input without sending.
- Put it in a pure helper in `domain/chat.ts`, `parseSlashCommand(text) → { mode?: ChatMode; text: string }`, with tests: `/explain why`, `/EXPLAIN why`, `/ask`, `/askwhy` (not a command), `  /explain x` (leading spaces → not a command, keep simple), and `/unknown x` (not a command).
- **Suggestion popover:** while the input starts with `/` and has no space yet, show a small list above the composer:
  - "/ask — direct answer"
  - "/explain — step by step"
  
  Filter by prefix. ↑/↓ moves, Enter or Tab picks (inserting `/explain `), and Escape closes. Use the existing `Command` primitives (`components/ui/command.tsx`) if they fit an inline list; otherwise a simple listbox with correct roles (`role="listbox"`, `aria-activedescendant`). Enter on a highlighted suggestion must **not** send.

## 3. Dictation button (macOS only)

- **Rust:** add the command `start_dictation()`. On macOS:
  - run on the main thread (`app.run_on_main_thread`);
  - call `NSApplication::sharedApplication(mtm).sendAction_to_from(sel!(startDictation:), None, None)`, via `objc2` / `objc2-app-kit`;
  - add them as `[target.'cfg(target_os = "macos")'.dependencies]` matching the versions already in `Cargo.lock` (objc2 0.6.x, objc2-app-kit 0.3.x), with the minimal features needed (`NSApplication`, `NSResponder`);
  - return `Ok(())`.
  
  On other platforms, return `Err("Dictation is only available on macOS")`.
- **Info.plist:** add `NSMicrophoneUsageDescription` ("Arbor uses the microphone when you dictate a chat message.") and `NSSpeechRecognitionUsageDescription` ("Arbor uses speech recognition to turn dictation into text.").
  - Tauri 2 merges a `desktop/src-tauri/Info.plist` file into the bundle's plist; create it with only these two keys.
  - Confirm the bundle config still passes: `cargo check`. Note `bundle.macOS.hardenedRuntime` is false (`tauri.bundle.json`), so no entitlement is needed today.
  - Write a comment in the report on what's needed if hardened runtime is ever enabled (`com.apple.security.device.audio-input`).
- **UI:** a `Mic` `IconButton` in the composer footer, rendered **only on macOS**.
  - Detect with `navigator.platform`, matching `lib/shortcuts.ts` (extract and reuse an `isMacPlatform()` helper there).
  - On click: focus the textarea, then `invoke("start_dictation")` through a small wrapper in `lib/` (no `invoke` in components).
  - On error, `toast.error(message)`.
  - Tooltip: "Dictate (or press Fn twice)".
  - Add `start_dictation` to `ipc.ts`, and a mock handler that resolves.
- **Can't be verified here** (Linux, no Mac). Write "needs Mac check: mic button starts system dictation into the chat box" in the report.

## 4. Tests

- **vitest:**
  - the chip toggles and persists per thread;
  - Shift+Tab toggles;
  - `/explain foo` sends `mode: "explain"` with the text `"foo"`;
  - `/ask` alone switches without sending;
  - suggestion navigation, and Enter-picks-without-sending;
  - the mic button is hidden when `navigator.platform` is Linux and shown when it is `MacIntel` (stub the platform), and clicking it invokes `start_dictation`.
- **Rust:** a compile-time `cfg` test that `start_dictation` errors on non-macOS.

## 5. Checks

Wrap each in `timeout 600` and paste the tail with `EXIT=$?`:
- `cd desktop && npm test`
- `npm run lint`
- `npm run build`
- `cd desktop/src-tauri && cargo test` and `cargo check`

The macOS-only code must compile behind `cfg`. You can't build for macOS here, so keep the objc code minimal and match the `objc2` 0.6 API exactly.

Commit in logical commits:
1. mode chip and shortcuts
2. slash commands
3. dictation

---

## Execution plan

Composer implements → Claude reruns → Grok QA (focus: keyboard handling with IME, suggestion popover a11y, cfg-gated objc code correctness against `objc2` 0.6 / `objc2-app-kit` 0.3 docs in `~/.cargo/registry`, Info.plist merge) → Composer fix round → Claude audit plus a headless preview → push and open a stacked PR. The **user** checks dictation on their Mac.
