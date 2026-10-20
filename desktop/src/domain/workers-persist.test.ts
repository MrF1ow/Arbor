import { describe, expect, it } from "vitest";

import { fixtureSettings } from "~/test/fixtures/data";
import {
  parseWorkerPort,
  readWorkerFromForm,
  removeWorkerFromSettings,
  setRootWorkerOnSettings,
} from "~/domain/workers-persist";

describe("workers-persist", () => {
  it("parseWorkerPort defaults empty to 22 and rejects invalid", () => {
    expect(parseWorkerPort("")).toBe(22);
    expect(parseWorkerPort("70000")).toBeNull();
    expect(parseWorkerPort("22")).toBe(22);
  });

  it("readWorkerFromForm returns legacy validation messages", () => {
    expect(readWorkerFromForm({
      forId: "w1",
      label: "",
      host: "host",
      portRaw: "22",
      user: "",
      identityFile: "",
      workerCmd: "cmd",
      remoteRoot: "/remote",
    })).toEqual({
      ok: false,
      message: "Label, host, worker command, and remote root are required.",
    });
    expect(readWorkerFromForm({
      forId: "w1",
      label: "Lab",
      host: "host",
      portRaw: "99999",
      user: "",
      identityFile: "",
      workerCmd: "cmd",
      remoteRoot: "/remote",
    })).toEqual({
      ok: false,
      message: "Port must be between 1 and 65535.",
    });
  });

  it("removeWorkerFromSettings clears root assignments", () => {
    const settings = {
      ...fixtureSettings,
      workers: [
        {
          id: "w1",
          label: "Lab",
          host: "h",
          port: 22,
          worker_cmd: "cmd",
          remote_root: "/r",
        },
      ],
      knowledge_roots: [
        {
          path: fixtureSettings.knowledge_roots[0]!.path,
          kind: "personal" as const,
          name: "Fall",
          worker_id: "w1",
        },
      ],
    };
    const next = removeWorkerFromSettings(settings, "w1");
    expect(next.workers).toHaveLength(0);
    expect(next.knowledge_roots?.[0]?.worker_id).toBeNull();
  });

  it("setRootWorkerOnSettings persists worker_id on one root", () => {
    const path = fixtureSettings.knowledge_roots[0]!.path;
    const next = setRootWorkerOnSettings(fixtureSettings, path, "w9");
    expect(next.knowledge_roots?.find((e) => e.path === path)?.worker_id).toBe("w9");
  });
});
