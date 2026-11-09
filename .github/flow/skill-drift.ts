#!/usr/bin/env bun
// skill-drift: is the repo's testing skill stale? Flow's drift check, in one dependency-free file (node:* and Bun only).
//
// Flow's setup copies this file into a repo as `.github/flow/skill-drift.ts`, run by `.github/workflows/skill-drift.yml`;
// `flow-config drift` imports it from flow's `templates/ci/skill-drift.ts`. Don't edit the copy: setup overwrites it.
//
//   bun skill-drift.ts --skill <path> [--base <ref>]
//
// The testing skill's frontmatter lists the paths it depends on (`watches:`, globs; `glob#key` counts a JSON file only
// when that top-level key changed, e.g. `package.json#scripts`) and the commit its steps were checked
// on (`updated:`). A change between <base> (default: that `updated:` sha) and HEAD that touches a watched path, after the
// skill's last change in that range (or with none), means the skill may be stale: the paths are printed and it exits 1.
// Otherwise one ok line, exit 0.

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export interface SkillFrontmatter {
  watches: string[];
  updated: string | undefined;
}

const unquote = (s: string) => s.trim().replace(/^(["'])(.*)\1$/, "$2");

/** `watches:` (block or inline list) and `updated:` from a skill's frontmatter. Values stay strings: a sha is never a number. */
export function parseSkillFrontmatter(text: string): SkillFrontmatter {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  const lines = fm ? fm[1].split(/\r?\n/) : [];
  const watches: string[] = [];
  let updated: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*?)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/\s+#.*$/, "");
    if (m[1] === "updated") updated = unquote(value) || undefined;
    if (m[1] !== "watches") continue;
    if (value.startsWith("[")) {
      watches.push(...value.replace(/^\[|\]$/g, "").split(",").map(unquote).filter(Boolean));
      continue;
    }
    for (; i + 1 < lines.length && /^\s*(-|#|$)/.test(lines[i + 1]); i++) {
      const item = lines[i + 1].match(/^\s*-\s*(.*?)\s*$/);
      if (item) watches.push(unquote(item[1].replace(/\s+#.*$/, "")));
    }
  }
  return { watches: watches.filter(Boolean), updated };
}

// `splitWatch` and `jsonKeyDiffers` follow Foodable's scripts/conventions/skill-drift.ts (MrF1ow/foodable PR #230).

/** A watch entry: a path or glob, optionally `#<top-level JSON key>` (split at the last `#`). */
export function splitWatch(entry: string): { glob: string; key?: string } {
  const at = entry.lastIndexOf("#");
  if (at < 0) return { glob: entry };
  return { glob: entry.slice(0, at), key: entry.slice(at + 1) };
}

/**
 * Whether the top-level `key` differs between two file contents (null = the file does not exist on that side). An
 * added or deleted file, or JSON that does not parse, counts as changed: when unsure, ask for the skill update.
 */
export function jsonKeyDiffers(base: string | null, head: string | null, key: string): boolean {
  if (base === null || head === null) return base !== head;
  try {
    const a = (JSON.parse(base) as Record<string, unknown> | null)?.[key];
    const b = (JSON.parse(head) as Record<string, unknown> | null)?.[key];
    return !Bun.deepEquals(a, b, true);
  } catch {
    return true;
  }
}

/** True when `key` of the JSON file at `path` changed on this side. */
export type KeyChanged = (path: string, key: string) => boolean;

/**
 * The watched paths in `changed` when the skill itself is not among them; empty when the skill changed too. A path
 * matched only by `glob#key` watches counts when `keyChanged` says that key changed.
 */
export function drift(changed: string[], watches: string[], skillPath: string, keyChanged: KeyChanged = () => true): string[] {
  if (changed.includes(skillPath)) return [];
  const matchers = watches.map((w) => {
    const { glob, key } = splitWatch(w);
    return { glob: new Bun.Glob(glob), key };
  });
  return changed.filter((p) => matchers.some((m) => m.glob.match(p) && (m.key === undefined || keyChanged(p, m.key))));
}

export interface DriftResult {
  code: 0 | 1;
  out: string[];
  err: string[];
}

/** The whole check for the repo at `repo`: `skill` is relative to it (or absolute); `base` defaults to the skill's `updated:`. */
export function checkDrift(opts: { repo: string; skill: string; base?: string }): DriftResult {
  const bad = (msg: string): DriftResult => ({ code: 1, out: [], err: [msg] });
  const path = resolve(opts.repo, opts.skill);
  if (!existsSync(path)) return bad(`no testing skill at ${opts.skill}; flow's P0 writes it`);
  const skillPath = relative(opts.repo, path);
  if (isAbsolute(skillPath) || skillPath.startsWith("..")) return bad(`the testing skill ${opts.skill} is outside the repo`);
  const fm = parseSkillFrontmatter(readFileSync(path, "utf8"));
  if (!fm.watches.length) return bad(`${opts.skill}: watches: is empty; list the paths its steps depend on`);
  const base = opts.base ?? fm.updated;
  if (!base) return bad(`${opts.skill}: no updated: sha; pass --base`);
  const git = (...args: string[]) => {
    try {
      return Bun.spawnSync(["git", "-c", "core.quotePath=false", ...args], { cwd: opts.repo, stdout: "pipe", stderr: "pipe", timeout: 30_000 });
    } catch (e) {
      return { exitCode: 127, stdout: Buffer.from(""), stderr: Buffer.from(`git not runnable: ${(e as Error).message}`) } as unknown as ReturnType<typeof Bun.spawnSync>;
    }
  };
  const why = (p: ReturnType<typeof git>) => p.stderr.toString().trim().split("\n")[0] || (p.exitCode === null ? "timed out" : `exit ${p.exitCode}`);
  // Only this side's own commits count (`HEAD ^<base>`), never what the base gained: in CI, HEAD is GitHub's merge
  // commit, and a diff against it would mix main's changes in. Commits up to the skill's last change are covered by
  // it, so only later ones can be stale; without that, the default base could never fire, since the commit that
  // writes `updated: <sha>` always comes after <sha>. Renames list both paths, so moving a watched file counts.
  // --full-history: without it, git follows a merge down the side where the skill already matches and misses ours.
  const last = git("log", "-1", "--no-merges", "--full-history", "--format=%H", "HEAD", `^${base}`, "--", skillPath);
  if (last.exitCode !== 0) return bad(`git log HEAD ^${base} failed: ${why(last)}`);
  const lastSha = last.stdout.toString().trim();
  const from = lastSha || base;
  const range = ["HEAD", `^${base}`, ...(lastSha ? [`^${lastSha}`] : [])];
  const d = git("log", "--no-merges", "--no-renames", "--format=", "--name-only", "-z", ...range);
  if (d.exitCode !== 0) return bad(`git log HEAD ^${from} failed: ${why(d)}`);
  // A `glob#key` watch: the path counts if any of this side's commits in the same range changed that key (each against
  // its own parent, so the base's changes never count). A root commit's parent side is absent.
  const show = (rev: string, p: string) => {
    const r = git("show", `${rev}:${p}`);
    return r.exitCode === 0 ? r.stdout.toString() : null;
  };
  const keyChanged: KeyChanged = (p, key) => {
    const shas = git("log", "--no-merges", "--full-history", "--format=%H", ...range, "--", p); // --full-history: as for `last` above
    if (shas.exitCode !== 0) return true;
    return shas.stdout.toString().split("\n").filter(Boolean).some((sha) => {
      const root = git("rev-parse", "-q", "--verify", `${sha}^`).exitCode !== 0;
      return jsonKeyDiffers(root ? null : show(`${sha}^`, p), show(sha, p), key);
    });
  };
  const stale = drift([...new Set(d.stdout.toString().split(/[\0\n]/).filter(Boolean))], fm.watches, skillPath, keyChanged);
  const since = from === base ? base : `${from.slice(0, 12)} (its last change since ${base})`;
  if (!stale.length) return { code: 0, out: [`ok: no watched path changed without the testing skill since ${base}`], err: [] };
  return {
    code: 1,
    out: [`stale: ${skillPath} watches paths changed since ${since} without it:`, ...stale.map((p) => `  ${p}`)],
    err: ["update the testing skill's steps for these changes, and its updated: sha"],
  };
}

export function printDrift(r: DriftResult, name: string): never {
  for (const l of r.out) console.log(l);
  for (const l of r.err) console.error(`${name}: ${l}`);
  process.exit(r.code);
}

if (import.meta.main) {
  const arg = (n: string) => {
    const i = process.argv.indexOf(n);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const skill = arg("--skill");
  if (!skill) printDrift({ code: 1, out: [], err: ["usage: skill-drift.ts --skill <path> [--base <ref>]"] }, "skill-drift");
  const top = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { stdout: "pipe", stderr: "pipe", timeout: 10_000 });
  const repo = top.exitCode === 0 ? top.stdout.toString().trim() : process.cwd();
  printDrift(checkDrift({ repo, skill: relative(repo, resolve(skill)), base: arg("--base") }), "skill-drift");
}
