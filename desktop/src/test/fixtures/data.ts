/** Unique string — must not appear in production `dist/`. */
export const FIXTURE_MARKER = "ARBOR_MOCK_FIXTURE_CELL_BIO_2026";

export const FIXTURE_ROOT_FALL = "/mock/knowledge/fall-2026";
export const FIXTURE_ROOT_SHARED = "/mock/knowledge/shared-study-group";

export const fixtureSettings = {
  knowledge_root: FIXTURE_ROOT_FALL,
  active_root: FIXTURE_ROOT_FALL,
  knowledge_roots: [
    {
      path: FIXTURE_ROOT_FALL,
      kind: "personal" as const,
      name: "Fall 2026",
    },
    {
      path: FIXTURE_ROOT_SHARED,
      kind: "shared" as const,
      name: "Shared · Study group",
    },
  ],
  model_id: "grok-4.7",
  provider_id: "grok",
  appearance: "system" as const,
  ollama_base_url: null,
  lmstudio_base_url: null,
  skill_index_source: "",
  skill_index_ref: "",
  skill_grants: [],
  provider_overrides: [],
  workers: [],
};

export const fixtureCourses: Record<string, string[]> = {
  [FIXTURE_ROOT_FALL]: [
    "cell-biology",
    "organic-chemistry-ii",
    "linear-algebra",
    "medieval-europe",
  ],
  [FIXTURE_ROOT_SHARED]: ["collab-notes"],
};

export const fixtureCourseOverview = {
  due: { due_ids: ["fc-1", "fc-2"], count: 14, deck_count: 86 },
  weak: {
    topics: [{ label: "Cytoskeleton", digest: "2026-09-12-membranes", heading: "Microtubules" }],
  },
  recommend: {
    items: [
      { kind: "due_cards", label: "Review 14 due flashcards" },
      { kind: "weakest_topic", label: "Cytoskeleton", digest: "2026-09-12-membranes" },
    ],
  },
};

export const fixtureDigests = [
  {
    title: "Cell membranes",
    date: "2026-09-12",
    path: "cell-biology/2026-09-12-membranes.md",
  },
  {
    title: "Mitochondria",
    date: "2026-09-15",
    path: "cell-biology/2026-09-15-mitochondria.md",
  },
  {
    title: "Protein trafficking",
    date: "2026-09-18",
    path: "cell-biology/2026-09-18-trafficking.md",
  },
  {
    title: "Cell cycle",
    date: "2026-09-22",
    path: "cell-biology/2026-09-22-cycle.md",
  },
  {
    title: "Signal transduction",
    date: "2026-09-25",
    path: "cell-biology/2026-09-25-signaling.md",
  },
  {
    title: "Cytoskeleton",
    date: "2026-09-28",
    path: "cell-biology/2026-09-28-cytoskeleton.md",
  },
  {
    title: "Exam review",
    date: "2026-10-01",
    path: "cell-biology/2026-10-01-review.md",
  },
  {
    title: "DNA replication",
    date: "2026-10-03",
    path: "cell-biology/2026-10-03-dna.md",
  },
  {
    title: "Transcription",
    date: "2026-10-05",
    path: "cell-biology/2026-10-05-transcription.md",
  },
  {
    title: "Translation",
    date: "2026-10-08",
    path: "cell-biology/2026-10-08-translation.md",
  },
  {
    title: "Apoptosis",
    date: "2026-10-10",
    path: "cell-biology/2026-10-10-apoptosis.md",
  },
  {
    title: "Stem cells",
    date: "2026-10-12",
    path: "cell-biology/2026-10-12-stem-cells.md",
  },
];

export const fixtureCourseDisplayNames: Record<string, string> = {
  "cell-biology": "Cell Biology",
  "organic-chemistry-ii": "Organic Chemistry II",
  "linear-algebra": "Linear Algebra",
  "medieval-europe": "Medieval Europe",
};

export const fixtureQuizQuestions = Array.from({ length: 8 }, (_, i) => ({
  id: `q-${i + 1}`,
  type: "multiple_choice" as const,
  prompt: `Which process best describes step ${i + 1} in cell biology?`,
  choices: ["Endocytosis", "Oxidative phosphorylation", "RNA splicing", "Actin polymerization"],
  answer_index: i % 4,
  explanation: "See the membranes digest for context.",
  source: { digest: "2026-09-12-membranes", heading: "Membrane structure" },
}));

export const fixtureQuizProgress = {
  ...Object.fromEntries(
    fixtureQuizQuestions.slice(0, 7).map((q) => [q.id, { seen: 1, correct: 1, wrong: 0 }]),
  ),
  "q-8": { seen: 2, correct: 0, wrong: 2 },
};

export const fixtureConceptGraph = {
  schema_version: 1,
  course: "cell-biology",
  nodes: Array.from({ length: 10 }, (_, i) => ({
    id: `concept-${i + 1}`,
    label: `Concept ${i + 1}`,
    digest: "2026-09-12-membranes",
    heading: "Membrane structure",
    verified: i % 2 === 0,
  })),
  edges: Array.from({ length: 12 }, (_, i) => ({
    from: `concept-${(i % 10) + 1}`,
    to: `concept-${((i + 2) % 10) + 1}`,
    kind: "related",
  })),
};

export const fixtureStudyPlanMarkdown = `# Study plan

Exam date: **2026-11-04**

- Review cytoskeleton weak topic
- Complete 14 due flashcards
`;

export const fixtureMarkdownSample = `# Cell Biology · ${FIXTURE_MARKER}

<!-- arbor-pages: 12-18, 22-24 -->

## Membrane structure

Phospholipid bilayer with embedded proteins.

| Lipid | Role |
| --- | --- |
| Phosphatidylcholine | Bilayer scaffold |
| Cholesterol | Fluidity buffer |

- Fluid mosaic model
- See also [[2026-09-15-mitochondria|Mitochondria digest]]

`;

export const fixtureKnowledgeSettings = {
  delete_sources_after_digest: false,
  auto_update: true,
  auto_embed: true,
  watch_enabled: true,
  auto_generate: { flashcards: true, quiz: true },
  sync_after_commit: false,
};
