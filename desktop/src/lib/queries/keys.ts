export const qk = {
  courses: (root: string) => ["courses", root] as const,
  courseMeta: (root: string) => ["courseMeta", root] as const,
  digests: (root: string, course: string) => ["digests", root, course] as const,
  markdown: (root: string, path: string) => ["markdown", root, path] as const,
  courseOverview: (root: string, course: string) =>
    ["courseOverview", root, course] as const,
  settings: () => ["settings"] as const,
  knowledgeSettings: (root: string) => ["knowledgeSettings", root] as const,
  auth: (provider: string) => ["auth", provider] as const,
  providerUsage: (provider: string) => ["providerUsage", provider] as const,
  search: (root: string, query: string, semantic: boolean) =>
    ["search", root, semantic ? "semantic" : "knowledge", query] as const,
  models: (provider: string, root: string | null) =>
    ["models", provider, root ?? ""] as const,
  arborDb: (root: string) => ["arborDb", root] as const,
  jobs: (root: string) => ["jobs", root] as const,
  jobEvents: (root: string, jobId: string) => ["jobEvents", root, jobId] as const,
  library: (root: string) => ["library", root] as const,
  sync: (root: string) => ["sync", root] as const,
  chatThreads: (root: string, course: string) => ["chatThreads", root, course] as const,
  chatThread: (root: string, course: string, threadId: string) =>
    ["chatThread", root, course, threadId] as const,
  studyJson: (root: string, course: string, kind: string) =>
    ["studyJson", root, course, kind] as const,
  quizProgress: (root: string, course: string) => ["quizProgress", root, course] as const,
  studyPlan: (root: string, course: string) => ["studyPlan", root, course] as const,
  studyArtifactStale: (root: string, course: string, skill: string) =>
    ["studyArtifactStale", root, course, skill] as const,
  skillIndex: () => ["skillIndex"] as const,
  providerSecret: (provider: string) => ["providerSecret", provider] as const,
  syncConflict: (root: string) => ["syncConflict", root] as const,
  planUpdate: (root: string) => ["planUpdate", root] as const,
};
