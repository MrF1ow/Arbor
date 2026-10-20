import type {
  LibraryShowResult,
  SkillIndexPackage,
  SyncConflictSession,
  SyncShowResult,
  SshWorker,
} from "~/domain/types";

import { FIXTURE_ROOT_FALL } from "~/test/fixtures/data";

export const fixtureLibraryShowOwner: LibraryShowResult = {
  present: true,
  name: "Fall 2026 library",
  created_by: "owner@example.com",
  role: "owner",
  provider: { id: "grok", model: "grok-4.7" },
  members: [
    { email: "owner@example.com", role: "owner" },
    { email: "editor@example.com", role: "editor" },
    { email: "viewer@example.com", role: "viewer" },
  ],
};

export const fixtureLibraryShowViewer: LibraryShowResult = {
  present: true,
  name: "Fall 2026 library",
  created_by: "owner@example.com",
  role: "viewer",
  provider: { id: "grok", model: "grok-4.7" },
  members: [
    { email: "owner@example.com", role: "owner" },
    { email: "editor@example.com", role: "editor" },
    { email: "viewer@example.com", role: "viewer" },
  ],
};

export const fixtureSyncShow: SyncShowResult = {
  remote: "git@example.com:arbor/fall-2026.git",
  shared: true,
  remote_note: "Pushes to origin; Arbor remote is git@example.com:arbor/fall-2026.git",
};

export const fixtureSyncConflictSession: SyncConflictSession = {
  strategy: "merge",
  upstream: "origin/main",
  branch: "main",
  files: [
    {
      path: "cell-biology/course.md",
      binary: false,
      mine: "# Mine version\n",
      theirs: "# Their version\n",
    },
    {
      path: "cell-biology/sources/lecture-a.pdf",
      binary: true,
      mine: null,
      theirs: null,
    },
  ],
};

export const fixtureSkillPackages: SkillIndexPackage[] = [
  {
    id: "demo-skill",
    kind: "skill",
    name: "Demo skill",
    description: "Exports study artifacts",
    commit: "abc111",
    permissions: ["read_course", "write_export_dir"],
  },
  {
    id: "installed-skill",
    kind: "skill",
    name: "Installed skill",
    description: "Already on disk",
    commit: "def222",
    permissions: ["read_course"],
  },
  {
    id: "new-perms-skill",
    kind: "skill",
    name: "New permissions",
    description: "Needs confirmation",
    commit: "ghi333",
    permissions: ["read_course", "write_course_study"],
  },
];

export const fixtureSshWorkers: SshWorker[] = [
  {
    id: "w1mock001",
    label: "Lab GPU",
    host: "gpu.example.com",
    port: 22,
    user: "arbor",
    identity_file: "/home/arbor/.ssh/id_ed25519",
    worker_cmd: "uv run --project /path/to/python arbor-worker",
    remote_root: "/data/arbor",
  },
];

export const SETTINGS_SHARING_FIXTURE_ROOT = FIXTURE_ROOT_FALL;
