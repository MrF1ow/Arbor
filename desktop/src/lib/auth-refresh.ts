import { authCheckWorkerFailureReason } from "~/domain/provider";
import type { AuthStatus } from "~/domain/types";
import { invoke } from "~/lib/ipc";

type AuthKey = string;

let refreshInFlight: Promise<AuthStatus> | null = null;
let refreshActiveKey: AuthKey = "";
let refreshQueued: { provider: string; force: boolean } | null = null;

function authRequestKey(provider: string, force: boolean): AuthKey {
  return `${provider}|${force}`;
}

async function runCheckAuth(provider: string, force: boolean): Promise<AuthStatus> {
  try {
    return await invoke<AuthStatus>("check_auth", {
      provider,
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

function startAuthRefresh(provider: string, force: boolean): Promise<AuthStatus> {
  const key = authRequestKey(provider, force);
  refreshActiveKey = key;
  refreshInFlight = runCheckAuth(provider, force).finally(() => {
    refreshInFlight = null;
    refreshActiveKey = "";
    const queued = refreshQueued;
    refreshQueued = null;
    if (queued && authRequestKey(queued.provider, queued.force) !== key) {
      void fetchAuthStatus(queued.provider, queued.force);
    }
  });
  return refreshInFlight;
}

export function fetchAuthStatus(provider: string, force = false): Promise<AuthStatus> {
  const key = authRequestKey(provider, force);
  if (refreshInFlight && refreshActiveKey === key) {
    return refreshInFlight;
  }
  if (refreshInFlight && force) {
    return refreshInFlight.then(() => fetchAuthStatus(provider, true));
  }
  if (refreshInFlight) {
    refreshQueued = { provider, force };
    return refreshInFlight;
  }
  return startAuthRefresh(provider, force);
}

export function resetAuthRefreshForTests() {
  refreshInFlight = null;
  refreshActiveKey = "";
  refreshQueued = null;
}
