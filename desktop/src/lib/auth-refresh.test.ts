import { afterEach, describe, expect, it } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import { fetchAuthStatus, resetAuthRefreshForTests } from "~/lib/auth-refresh";
import { installMockIpc } from "~/test/mock-ipc";

describe("fetchAuthStatus", () => {
  afterEach(() => {
    clearTauriMocks();
    resetAuthRefreshForTests();
  });

  it("returns forced check after a non-forced request is in flight", async () => {
    let resolveSlow: (value: unknown) => void = () => undefined;
    const slow = new Promise((resolve) => {
      resolveSlow = resolve;
    });
    let forced: boolean | undefined;
    installMockIpc({
      check_auth: (args) => {
        forced = Boolean((args as { force?: boolean }).force);
        if (!forced) {
          return slow.then(() => ({
            authenticated: true,
            reason: "",
            docs_url: "",
          }));
        }
        return {
          authenticated: false,
          reason: "signed out",
          docs_url: "",
        };
      },
    });

    const nonForced = fetchAuthStatus("grok", false);
    const forcedPromise = fetchAuthStatus("grok", true);
    resolveSlow({
      authenticated: true,
      reason: "",
      docs_url: "",
    });

    const result = await forcedPromise;
    expect(result.authenticated).toBe(false);
    expect(result.reason).toBe("signed out");
    await nonForced;
  });
});
