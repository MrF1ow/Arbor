# PR 2: Streaming chat answers

Branch `ux/02-streaming`, stacked on `ux/01-chat-fixes`. The overall plan is in `README.md`. **The agent rules in `../ui-6.0/README.md` apply in full:** no browser, never launch the app window, never touch the user's display, and no live provider runs. Use fakes and fixtures only.

Worktree: `/home/flow/Projects/personal/Arbor/.worktrees/ux-stack`.

## Why

The UI already handles `chat_delta` events, and Rust already forwards worker stdout line by line (`start_chat` in `desktop/src-tauri/src/commands.rs`). The emitter flushes after every event. But `python/src/arbor_worker/chat.py` calls `provider.run()`, which blocks until the whole answer exists, and then emits a single `chat_done`. So nothing streams.

**Rust needs no changes.**

## 1. Provider interface (`python/src/arbor_worker/provider/base.py`)

- Add `DeltaFn = Callable[[str], None]`.
- Add a helper `supports_stream(provider) -> bool`: `callable(getattr(provider, "stream", None))`.
- The streaming contract is `stream(request, on_delta) -> ProviderResult`:
  - call `on_delta(text)` for each text chunk, in order;
  - return the full final text, exactly what `run()` would have returned;
  - raise `ProviderError` the same way `run()` does.
- **Don't** add `stream` to the `Provider` Protocol. It stays optional.
- `run()` stays unchanged for every provider. Every other job (digests, flashcards, quiz, study plan) keeps using `run()`.

## 2. CLI providers: Claude and Grok share one stream parser

Both CLIs emit the Anthropic Messages wire format as NDJSON. A real Grok capture is at `python/tests/fixtures/grok_stream_messages.ndjson`:

- line 1: `{"type":"system","subtype":"init",…}`
- then `{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" two"}},…}` per chunk
- then `{"type":"assistant","message":{…"content":[{"type":"text","text":"…"}]}}`
- finally `{"type":"result","subtype":"success","is_error":false,"result":"one two three four five",…}`

Claude CLI `--output-format stream-json --verbose --include-partial-messages` emits the same `stream_event`, `assistant` and `result` lines. Errors appear as `"is_error": true` on the `result` line.

Create `python/src/arbor_worker/provider/stream_json.py` with a pure parser:
- `iter_stream_json(lines: Iterable[str], on_delta: DeltaFn) -> str`.
- For each non-empty line, `json.loads` it. Malformed lines → `ProviderError("… returned invalid stream JSON")`.
- `stream_event` with `event.type == "content_block_delta"` and `delta.type == "text_delta"` → `on_delta(delta.text)`. Ignore `thinking_delta` and every other event type.
- Any `content_block_start` whose `content_block.type` is `tool_use`, or an `assistant` message containing a `tool_use` block → `ProviderError("… reported a tool call (name)")`. This mirrors `grok.py::_raise_if_tool_call`; reuse that helper where it fits.
- `result` line:
  - if `is_error` → `ProviderError(result or message)`;
  - else the final text is `result`.
  - If there is no `result` line, fall back to the concatenated deltas.
  - An empty final text → `ProviderError("… returned empty result")`.

**Claude** (`provider/claude.py`): add `stream()`.
- argv: same as `build_argv`, except `--output-format stream-json --verbose --include-partial-messages`. Add `--input-format stream-json` only when there are images, as today.
- Run with `subprocess.Popen` (injectable: add a `popen=subprocess.Popen` constructor arg next to `runner`). Write stdin, close it, and iterate `proc.stdout` line by line into `iter_stream_json`.
- Keep the `CLAUDECODE_GUARD` and CLI-not-found checks.
- A non-zero exit → `ProviderError(f"claude failed ({code}): {stderr…}")`, the same as `run()`.

**Grok** (`provider/grok.py`): add `stream()`.
- argv: same as `build_argv`, but `--output-format streaming-messages-json --include-partial-messages`.
- Same Popen pattern, the same `--prompt-file` temp file (deleted in `finally`), and the same non-zero-exit handling.

**Both:**
- Never leave a child running. In a `finally`, if the process is still alive: `kill()`, then `wait()`.
- Read stderr after stdout is drained, as in `proc.communicate` semantics. Don't deadlock: either drain stderr in a thread, or use `stderr=subprocess.PIPE` with a reader thread.
- Codex: no `stream()` (no token deltas). It keeps using `run()`.

## 3. HTTP providers

Add a streaming transport next to `urllib_http_request` in `provider/http_transport.py`:

```python
HttpStreamFn = Callable[[str, str, dict[str, str], bytes | None, float], tuple[int, Iterator[bytes]]]
def urllib_http_stream(method, url, headers, body, timeout) -> tuple[int, Iterator[bytes]]
```

- It yields raw lines, keeps `_check_remote_allowed`, the no-redirect opener, and connection-refused handling.
- On HTTP ≥ 400, return the status plus an iterator over the error body.
- Each provider gets an injectable `stream_transport=urllib_http_stream` constructor arg.

| Provider | Request | Parse |
|---|---|---|
| `ollama.py` | `/api/chat` with `"stream": true` | NDJSON lines; `message.content` per line; stop on `"done": true`; an `error` field → `ProviderError`. |
| `openai_compat.py` (used by `lmstudio.py` and `openai_api.py`) | `build_chat_completions_body(..., stream=True)` | SSE `data: {json}` lines; `choices[0].delta.content`; stop on `data: [DONE]`. |
| `anthropic_api.py` | `"stream": true` | SSE `event:` / `data:` lines; `content_block_delta` → `text_delta.text`; an `error` event → `ProviderError`. |

- `build_chat_completions_body` gains a `stream: bool = False` parameter. Existing callers are unchanged.
- Error paths must reuse the existing `error_excerpt` and `redact_secret`, so API keys never appear in messages.

## 4. Worker (`python/src/arbor_worker/chat.py`)

In `answer()`, call `provider.stream(request, on_delta)` when `supports_stream(provider)`, else `provider.run(request)`. Feed deltas through a small pure class, `TrailerFilter` (same module, unit-tested), which emits `chat_delta` events through the emitter:

- **Trailer.** The model ends with a line that is exactly `supported: true` or `supported: false` (`_parse_response`). That line must never reach the UI.
  - Emit text as it arrives, **except** a trailing partial line (text after the last `\n`) whose `.strip()` is a non-empty prefix of `"supported: true"` or `"supported: false"`. Hold that back.
  - When more text shows the held line is not the trailer, emit it.
  - When a complete line (or the final text) is exactly the trailer after strip, drop it.
  - Text must never be emitted twice or reordered.
- **Final event.** `chat_done` is unchanged: it is still built from `_parse_response(result.markdown, …)`, the full final text. The UI replaces the live text with it, so citation cleanup still happens.
- Tests (`python/tests/test_chat.py`):
  - A fake streaming provider sending `["Mito", "chondria [1].\nsupp", "orted: true"]` → the `chat_delta` texts join to exactly `"Mitochondria [1].\n"`, and `chat_done.supported is True`.
  - A held prefix that turns out not to be the trailer (`"sup"`, then `"per cool\n"`) → emitted in full.
  - A non-streaming provider → no `chat_delta`, the same `chat_done` as today.
  - An exception mid-stream → the existing `error` event path (`cmd_chat`).

`provider/fake.py`: add an optional scripted `stream()` to the fake provider (enabled by a constructor flag), so the tests and `--provider fake` runs can exercise streaming.

## 5. UI (`desktop/src/components/chat/live-answer.tsx`)

- Render the live text with `renderAnswerHtml` (from `~/domain/chat`) inside the same `prose-arbor` container the transcript uses for assistant answers. Match its classes so the swap at `chat_done` doesn't jump.
- Throttle: subscribe through `useSyncExternalStore`, but render at most once per animation frame. Keep a rAF-scheduled state of the latest text and render that; cancel the frame on unmount.
- **Only `LiveAnswer` re-renders per delta.** The `chat-view.tsx` parent currently reads `liveSnapshot.text.length` for its auto-scroll effect. Change that so the parent doesn't re-render per token: subscribe to a coarse "has text" or "in flight" boolean and handle the scroll from `LiveAnswer` through a callback or a `ResizeObserver` on the transcript. Keep the selection guard and the force-scroll-on-send behaviour from PR 1.
- Keep the blinking caret after the text.
- Vitest:
  - Deltas `"**Bold"`, `" text**"` render `<strong>Bold text</strong>` in the live bubble.
  - The live bubble disappears and the final assistant line renders after `chat_done` and `worker_exit`.
  - The parent `ChatView` doesn't re-render per delta. Use a render counter or React Profiler in the test, or assert the structure if that isn't feasible.

## 6. Checks

Wrap each in `timeout 600` and paste the tail with `EXIT=$?`:
- `cd desktop && npm test`
- `cd desktop && npm run lint`
- `cd desktop && npm run build`
- `cd python && uv run pytest -q`
- `cd desktop/src-tauri && cargo test chat`. Rust is unchanged; this is a sanity check.

Commit on `ux/02-streaming` in logical commits:
1. stream parser, Claude and Grok
2. HTTP streaming
3. worker `TrailerFilter`
4. UI

## Live check (Claude only, after the audit)

Run the worker `chat` command directly with Grok (`grok-4.7`) against a scratch course in `/tmp`, from a terminal only, never the app window. Confirm that multiple `chat_delta` lines arrive before `chat_done`. Never use the Claude provider for this.

---

## Execution plan

| Step | Agent | Task |
|---|---|---|
| 1 | Composer 2.5 (`cursor`/`composer-2.5`) | Implement §1–§5, run §6, commit. |
| 2 | Claude | Rerun the suites and skim the diff. |
| 3 | Grok 4.7 (`grok`/`grok-4.7`) | QA, review only. Focus: subprocess lifecycle (zombies, deadlock on stderr, kill on error), the trailer filter's edge cases, secret redaction in HTTP errors, parent re-renders. |
| 4 | Composer 2.5 | One fix round. |
| 5 | Claude | Audit, the Grok live worker check, a headless preview of streaming on `dev:mock` (the mock already emits `chat_delta`), then push and open a stacked PR. |
