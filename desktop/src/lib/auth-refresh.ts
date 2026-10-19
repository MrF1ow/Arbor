import { authCheckWorkerFailureReason } from "~/domain/provider";
import type { AuthStatus } from "~/domain/types";
import { invoke } from "~/lib/ipc";

type AuthKey = string;

let refreshInFlight: Promise<AuthStatus> | null = null;
let refreshActiveKey: AuthKey = "";
let refreshQueued: { key: AuthKey; run: () => Promise<AuthStatus> } | null = null;

function authRequestKey(provider: string, root: string | null, force: boolean): AuthKey {
  return `${provider}|${root ?? ""}|${force}`;
}

async function runCheckAuth(
  provider: string,
  root: string | null,
  force: boolean,
): Promise<AuthStatus> {
  try {
    return await invoke<AuthStatus>("check_auth", {
      provider,
      root: root ?? undefined,
      force,
    });
  } catch (error) {
    const reason = authCheckWorkerFailureReason(error);
    return {
      authenticated: false,
      reason,
      docs_url: "",
    };
  }
}

export function fetchAuthStatus(
  provider: string,
  root: string | null,
  force = false,
): Promise<AuthStatus> {
  const key = authRequestKey(provider, root, force);
  if (refreshInFlight && refreshActiveKey === key) {
    return refreshInFlight;
  }
  if (refreshInFlight) {
    refreshQueued = {
      key,
      run: () => runCheckAuth(provider, root, force),
    };
    return refreshInFlight;
  }
  refreshActiveKey = key;
  refreshInFlight = runCheckAuth(provider, root, force).finally(() => {
    refreshInFlight = null;
    refreshActiveKey = "";
    const queued = refreshQueued;
    refreshQueued = null;
    if (queued && queued.key !== key) {
      void fetchAuthStatus(
        provider,
        root,
        queued.key.endsWith("|true"),
      );
    }
  });
  return refreshInFlight;
}

export function resetAuthRefreshForTests() {
  refreshInFlight = null;
  refreshActiveKey = "";
  refreshQueued = null;
}
