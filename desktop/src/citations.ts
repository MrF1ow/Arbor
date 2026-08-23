import type { CitationsReport } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonBlankString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

export function parseCitationsReport(value: unknown): CitationsReport {
  if (!isRecord(value)) throw new Error("citations report must be an object");
  if (value.schema_version !== 1) {
    throw new Error("citations report schema_version must be 1");
  }
  if (!Array.isArray(value.failures)) {
    throw new Error("citations failures must be an array");
  }
  return {
    schema_version: 1,
    course: nonBlankString(value.course, "report.course"),
    failures: value.failures.map((item) => {
      if (!isRecord(item)) throw new Error("citation failure must be an object");
      return {
        path: nonBlankString(item.path, "failure.path"),
        id: nonBlankString(item.id, "failure.id"),
        reason: nonBlankString(item.reason, "failure.reason"),
      };
    }),
  };
}

export function failedIdsFor(report: CitationsReport | null, path: string): Set<string> {
  const ids = new Set<string>();
  if (!report) return ids;
  for (const failure of report.failures) {
    if (failure.path === path) ids.add(failure.id);
  }
  return ids;
}

export function citationJobArgs(
  root: string,
  course: string,
  force: boolean,
  model: string,
) {
  return {
    root,
    course,
    skill: "citations",
    force,
    model,
  };
}
