# PR 7: Provider usage ("how much do I have left")

Branch `ux/07-provider-usage`, stacked on `ux/06-course-icons`. Plan: `README.md` (D2). **The agent rules in `../ui-6.0/README.md` apply in full.** On top of those: **never run `claude`, `codex` or `grok`, and make no real HTTP calls.** All tests use injected runners and transports.

Worktree: `/home/flow/Projects/personal/Arbor/.worktrees/ux-stack`.

Reference implementation: T3 Code, cloned read-only at `/tmp/t3src` (commit b9aaff46). Read these files; don't modify them:

| File | What it shows |
|---|---|
| `apps/server/src/provider/claudeUsageLimits.ts` | Claude response → windows |
| `apps/server/src/provider/codexUsageLimits.ts` | Codex snapshot → windows |
| `packages/provider-grok/src/server/usageLimits.ts` | Grok credential discovery and the billing request |
| `packages/provider-core/src/server/usageLimits.ts` | Shared shape, `clampPercent`, sort order |
| `packages/shared/src/usageLimits.ts` (if present) | `remainingPercent`, `paceRemainingPercent`, `formatResetsIn` |
| `apps/web/src/components/usage/UsageLimits.tsx` | The window bar UI, including the pace mark |

## 1. Shape (Python `python/src/arbor_worker/usage.py`, mirrored in TS `desktop/src/domain/usage.ts`)

```
UsageLimits = { checked_at: str, windows: [Window], unavailable?: { reason: "unsupported" | "probe_failed", message?: str } }
Window      = { id, kind: "session" | "weekly" | "monthly" | "other", label, used_percent: float 0..100, resets_at?: iso str, window_minutes?: int }
```

- Windows are sorted session, weekly, monthly, other, then by id.
- `used_percent` is clamped to 0..100.

## 2. Readers (`usage.py`, one function per provider, all dependencies injectable)

### Claude CLI: `read_claude_usage(popen=…, which=…, timeout=10)`

Spawn the resolved `claude` CLI (reuse `resolve_cli_command`, `gui_path`, and the `CLAUDECODE_GUARD` check from `provider/claude.py`) with these args:

```
-p --output-format stream-json --verbose --input-format stream-json --no-session-persistence --setting-sources "" --strict-mcp-config --tools ""
```

Then on stdin:
1. `{"type":"control_request","request_id":"arbor-init","request":{"subtype":"initialize"}}` + newline;
2. `{"type":"control_request","request_id":"arbor-usage","request":{"subtype":"get_usage","skip_behaviors":true}}` + newline.

Read stdout lines until one is `{"type":"control_response","response":{"request_id":"arbor-usage","subtype":"success"|"error",…}}`. Then close stdin, terminate, and reap the process. Ignore other lines. **No user message is ever sent**, so no model turn runs.

The success payload is `response.response`. Its shape, from the Agent SDK's `SDKControlGetUsageResponse`:

```
rate_limits_available: bool
rate_limits: {
  five_hour?: {utilization 0-100|null, resets_at|null},
  seven_day?: {...},
  seven_day_opus?, seven_day_sonnet?,
  model_scoped?: [{display_name, utilization, resets_at}],
  extra_usage?: {is_enabled, monthly_limit, used_credits, utilization}
} | null
subscription_type
```

Map it exactly as `claudeUsageResponseToLimits` does:
- `five_hour` → `session` "Session";
- `seven_day` → `weekly` "Weekly";
- `model_scoped` → `weekly` "Weekly · {display_name}";
- `extra_usage` enabled → `monthly` "Monthly spend";
- `rate_limits_available` false → `unsupported`.

Any timeout, parse error or `error` subtype → `probe_failed`, never an exception. The SDK marks this API experimental.

### Codex: `read_codex_usage(popen=…, which=…, timeout=10)`

Spawn `codex app-server`. Send JSON lines:
1. `{"id":1,"method":"initialize","params":{"clientInfo":{"name":"arbor","title":"Arbor","version":"<app version or 0>"}}}`;
2. wait for the id 1 response;
3. `{"method":"initialized"}`;
4. `{"id":2,"method":"account/rateLimits/read","params":null}`.

Read until the id 2 response, then terminate and reap. Check `effect-codex-app-server` in `/tmp/t3src/packages` for the exact `initialize` params, and follow it. Map `result.rateLimitsByLimitId.codex ?? result.rateLimits` with `codexRateLimitsToWindows`:
- `primary` and `secondary`;
- `windowDurationMins` decides the kind;
- the free/go plan fallback;
- skip snapshots whose `limitId` isn't `codex`;
- `individualLimit` → "Monthly credit limit".

An error or no answer → `probe_failed`.

### Grok CLI: `read_grok_usage(env=os.environ, home=…, transport=…)`

Port `readGrokCredential` and `grokUsageResponseToLimits` exactly:
- the `XAI_API_KEY` skip;
- the list of override env vars that make it skip;
- the `config.toml` / `managed_config.toml` / `requirements.toml` / `/etc/grok/*` scan for `auth`, `grok_com_config` and `endpoints` sections;
- `GROK_HOME` and `GROK_AUTH`;
- the two credential keys;
- `auth_mode == "api_key"` → `unsupported`.

The request is `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits` with `Authorization: Bearer <key>` and a 10 s timeout, through an injectable transport whose default is `http_transport.urllib_http_request`.

Map `creditUsagePercent` and `currentPeriod`, including "missing percent but valid period → 0%" and the `parsePeriodBoundary` validation.

**Never** log, emit or include the token in error messages; use `redact_secret`.

### Others

`ollama`, `lmstudio`, `openai_api` and `anthropic_api` → `unsupported`.

## 3. Worker command and Rust

- **Worker:** `python -m arbor_worker usage` reads `{"provider": "<id>"}` on stdin and prints exactly one JSON object (the UsageLimits) to stdout. Register it in `cli.py` / `commands.py`, following the shape of the existing `auth` command.
- **Rust:** `read_provider_usage(provider: String) -> serde_json::Value`, in `commands.rs` or a new `usage.rs`. Run the worker exactly the way the auth-status probe runs it: find how `cached_auth` / `auth_status` invokes the worker, and reuse that path, the env/secrets handling, and remote-worker support if the auth probe has it.
- Add a 60-second in-memory cache per provider (a `Mutex<HashMap<String, (Instant, Value)>>`) and a `force: bool` param to bypass it.
- Rust unit tests cover the cache only. The worker invocation is covered by existing patterns.

## 4. UI

- **Query:** `useProviderUsage(providerId, { enabled })` → `invoke("read_provider_usage", { provider, force })`, with `staleTime` 5 min. A `refetchInterval` of 5 min applies **only** to the effective provider, and only while it's signed in.
- **Sidebar trigger:** `ProviderStatusLine` (`components/app/app-sidebar.tsx` ~79) becomes a `Button variant="ghost"` (same text, same dot) that opens a `Popover`.
- **Popover** (`components/app/provider-usage-popover.tsx`):
  - **Header:** the provider label · model, plus a small "Settings" link (to the provider settings route).
  - **One row per window:**
    - the label;
    - "{remaining}% left";
    - a bar filled to the *remaining* percentage, using tokens: `--primary` normally, `--destructive` when remaining < 10;
    - a pace tick at "share of window time left" when `window_minutes` and `resets_at` are known, with a tooltip like T3's `PACE` labels;
    - "Resets in 3h 12m" / "Resets Oct 28".
  - Pure helpers in `domain/usage.ts`, with tests: `remainingPercent`, `paceRemainingPercent(window, now)`, `formatResetsIn(window, now)`.
  - **Footer:** "Checked 2 min ago" plus a Refresh `IconButton` (`RotateCw`), which forces a refetch.
  - **Unavailable states:** `unsupported` → "This provider doesn't report usage limits." `probe_failed` → "Couldn't read usage" plus the message, if any. A signed-out provider shows the existing signed-out text.
  - **Other providers:** below the effective provider, a muted "Other providers" section lists the other signed-in providers. Each is collapsed by default, and expanding one fetches its usage. Get the list from the existing auth queries.
- **Mocks** (`test/mock-handlers.ts`): `read_provider_usage` returns realistic fixtures:
  - grok: Weekly 37% used, resets in 2 days;
  - claude: Session 62% plus Weekly 18% plus "Weekly · Opus" 40%;
  - codex: `probe_failed`;
  - ollama: `unsupported`.

## 5. Tests

- **Python:** each reader with fake popen/transport, using T3's own test cases as the model (`/tmp/t3src/.../*.test.ts` next to those files):
  - Claude: the success, unavailable, error-subtype and timeout paths; assert the exact stdin lines written;
  - Codex: the free plan fallback, limitId filtering, `individualLimit`;
  - Grok: the skip rules, api_key, zero-percent-with-period, an invalid period, and HTTP 401 → `probe_failed` with the token not in the message.
- **TS:** the domain helpers; popover rendering for every state; the refresh button forces; the effective provider is first.

## 6. Checks

Wrap each in `timeout 600` and paste the tail with `EXIT=$?`:
- `cd desktop && npm test`
- `npm run lint`
- `npm run build`
- `cd desktop/src-tauri && cargo test`
- `cd python && uv run pytest -q`

Commit in logical commits:
1. Python readers
2. worker command and Rust
3. UI

---

## Execution plan

Composer implements → Claude reruns → Grok QA (focus: subprocess cleanup and timeouts, token handling, mapping parity with T3, no network or CLI calls in tests) → Composer fix round → Claude audit, including a **live Grok usage read on this machine** (Claude only, from a terminal, via the worker `usage` command), plus a headless preview of the popover in all states → push and open a stacked PR.

Claude and Codex usage are verified with fakes only. Per the user's rules, Claude is never run through Arbor, and there is no Codex subscription.
