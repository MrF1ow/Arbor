/**
 * The approved design's data (FigCraft frames 4274 Today, 842 Class · Read, 4669 Overview), as the
 * backend 138 commands would return it: two libraries, six classes, units with several lectures, every
 * badge kind, weak topics such as "4 of 9", exam dates, due cards in several classes.
 *
 * `mock-handlers.ts` serves this as the whole app in mock mode (`vite --mode mock`), and as the
 * data behind the backend 138 commands in tests, whatever the test's class names (see `designClassSpec`).
 */
import type { CourseMetaMap } from "~/domain/course-icons";
import type { DigestStatsRow, ReadingEntry } from "~/domain/lectures";
import type { TodayCourseRow, TodayPayload, WeakTopic } from "~/domain/today";
import type {
  CourseStats,
  DigestInfo,
  ProviderUsageSummary,
  Settings,
  StudyPlanStatus,
} from "~/domain/types";

export const DESIGN_ROOT_MINE = "/mock/knowledge/my-library";
export const DESIGN_ROOT_GROUP = "/mock/knowledge/study-group";

export const designSettings: Settings = {
  knowledge_root: DESIGN_ROOT_MINE,
  active_root: DESIGN_ROOT_MINE,
  knowledge_roots: [
    { path: DESIGN_ROOT_MINE, kind: "personal", name: "My library" },
    { path: DESIGN_ROOT_GROUP, kind: "shared", name: "Study group" },
  ],
  model_id: "grok-4.7",
  provider_id: "grok",
  appearance: "system",
  ollama_base_url: null,
  lmstudio_base_url: null,
  skill_index_source: "",
  skill_index_ref: "",
  skill_grants: [],
  provider_overrides: [],
  workers: [],
};

export const designCoursesByRoot: Record<string, string[]> = {
  [DESIGN_ROOT_MINE]: ["Cell Biology", "Organic Chemistry", "Microeconomics", "Modern History"],
  [DESIGN_ROOT_GROUP]: ["Genetics", "Neuroscience"],
};

export const designCourseMeta: CourseMetaMap = {
  "Cell Biology": { icon: "microscope", color: "olive" },
  "Organic Chemistry": { icon: "flask-conical", color: "clay" },
  Microeconomics: { icon: "chart-line", color: "sand" },
  "Modern History": { icon: "landmark", color: "plum" },
  Genetics: { icon: "dna", color: "moss" },
  Neuroscience: { icon: "brain", color: "slate" },
};

/**
 * One lecture: [unit, title, date, cards, due, mastery %, quiz right, quiz wrong,
 * card right, card wrong, reading fraction (undefined = never opened)].
 * `cards` 0 means no deck for it; `mastery` null then.
 */
type Row = [
  unit: string | null,
  title: string,
  date: string,
  cards: number,
  due: number,
  mastery: number | null,
  quizRight: number,
  quizWrong: number,
  cardRight: number,
  cardWrong: number,
  reading?: number,
];

type WeakSpec = { label: string; lecture: string; heading: string | null; wrong: number; correct: number };

type ClassSpec = {
  name: string;
  /** Days from today to the exam; null for none. */
  examInDays: number | null;
  /** The class's mastery shown on Today ("82% mastered"). */
  mastery: number | null;
  plan: string[] | null;
  planDone: number;
  weak: WeakSpec[];
  rows: Row[];
};

const CELL_BIOLOGY: ClassSpec = {
  name: "Cell Biology",
  examInDays: 14,
  mastery: 0.82,
  plan: [
    "Re-read membrane transport",
    "Drill the cytoskeleton cards",
    "Make a card for each organelle",
    "Take the unit 2 quiz",
    "Summarise cell signalling",
    "Review weak topics",
  ],
  planDone: 3,
  weak: [
    {
      label: "Active vs passive transport",
      lecture: "Membrane transport",
      heading: "Active transport",
      wrong: 5,
      correct: 5,
    },
  ],
  rows: [
    // Unit 1 · Foundations
    ["Foundations", "Cell theory", "2026-09-02", 12, 0, 95, 6, 0, 10, 0, 1],
    ["Foundations", "Prokaryotes", "2026-09-04", 10, 0, 88, 4, 1, 8, 1, 1],
    ["Foundations", "Organelles", "2026-09-09", 14, 3, 71, 5, 2, 9, 3, 1],
    ["Foundations", "Cytoskeleton", "2026-09-11", 12, 5, 64, 1, 3, 3, 3, 1],
    // Unit 2 · Membranes
    ["Membranes", "Lipid bilayers", "2026-10-01", 12, 2, 92, 7, 0, 11, 1, 1],
    ["Membranes", "Membrane proteins", "2026-10-06", 12, 6, 58, 6, 2, 7, 3, 1],
    ["Membranes", "Membrane transport", "2026-10-08", 0, 0, null, 5, 5, 0, 0, 0.4],
    ["Membranes", "Cell signalling", "2026-10-13", 0, 0, null, 0, 0, 0, 0],
    // Unit 3 · Division
    ["Division", "Cell cycle", "2026-10-27", 0, 0, null, 0, 0, 0, 0, 1],
    ["Division", "Mitosis", "2026-10-29", 10, 2, 80, 3, 0, 6, 1, 1],
    ["Division", "Apoptosis", "2026-11-03", 0, 0, null, 0, 0, 0, 0],
    // Unit 4 · Gene expression
    ["Gene expression", "DNA replication", "2026-11-05", 12, 0, 90, 4, 0, 9, 0, 1],
    ["Gene expression", "Transcription", "2026-11-10", 12, 0, 85, 2, 0, 8, 1, 1],
    ["Gene expression", "Translation", "2026-11-12", 10, 0, 78, 1, 0, 6, 0, 0.6],
  ],
};

const ORGANIC_CHEMISTRY: ClassSpec = {
  name: "Organic Chemistry",
  examInDays: 9,
  mastery: 0.64,
  plan: [
    "Draw every mechanism from unit 1",
    "Drill carbocation stability",
    "Practice SN1 vs SN2 problems",
    "Review stereochemistry cards",
    "Take the midterm practice quiz",
    "Summarise elimination reactions",
    "Re-read the nomenclature digest",
    "Review weak topics",
  ],
  planDone: 5,
  weak: [
    {
      label: "Carbocation stability",
      lecture: "SN1 and SN2 reactions",
      heading: "Carbocations",
      wrong: 4,
      correct: 5,
    },
  ],
  rows: [
    ["Structure", "Bonding and hybridisation", "2026-09-03", 10, 1, 80, 4, 1, 7, 1, 1],
    ["Structure", "Alkanes", "2026-09-08", 10, 0, 76, 3, 0, 6, 1, 1],
    ["Structure", "Stereochemistry", "2026-09-15", 12, 3, 60, 2, 2, 5, 3, 1],
    ["Reactions", "Acids and bases", "2026-10-02", 10, 0, 82, 4, 0, 7, 0, 1],
    ["Reactions", "Alkenes", "2026-10-07", 10, 2, 66, 3, 1, 6, 2, 1],
    ["Reactions", "Alkyl halides", "2026-10-14", 12, 3, 55, 2, 2, 5, 3, 1],
    ["Reactions", "SN1 and SN2 reactions", "2026-10-21", 14, 4, 40, 5, 4, 4, 5],
    ["Reactions", "Elimination", "2026-10-26", 10, 2, 58, 2, 1, 4, 2, 0.5],
    ["Spectroscopy", "Infrared spectroscopy", "2026-11-02", 8, 0, 70, 2, 0, 4, 0, 1],
    ["Spectroscopy", "NMR basics", "2026-11-09", 8, 0, 62, 1, 0, 3, 1, 0.3],
    ["Spectroscopy", "Mass spectrometry", "2026-11-12", 0, 0, null, 0, 0, 0, 0],
  ],
};

const MICROECONOMICS: ClassSpec = {
  name: "Microeconomics",
  examInDays: 31,
  mastery: 0.71,
  plan: ["Graph supply and demand shifts", "Drill elasticity", "Take the market structures quiz"],
  planDone: 1,
  weak: [
    {
      label: "Cross-price elasticity",
      lecture: "Price elasticity",
      heading: "Cross-price elasticity",
      wrong: 3,
      correct: 3,
    },
  ],
  rows: [
    ["Markets", "Supply and demand", "2026-09-07", 8, 0, 88, 4, 0, 7, 0, 1],
    ["Markets", "Consumer surplus", "2026-09-14", 8, 0, 80, 3, 0, 6, 0, 1],
    ["Markets", "Price controls", "2026-09-21", 8, 1, 74, 2, 1, 5, 1, 1],
    ["Elasticity", "Price elasticity", "2026-10-05", 10, 4, 50, 3, 3, 3, 2],
    ["Elasticity", "Income elasticity", "2026-10-12", 8, 3, 60, 2, 1, 4, 1, 0.2],
    ["Firms", "Costs of production", "2026-10-26", 8, 0, 72, 2, 0, 5, 0, 1],
    ["Firms", "Perfect competition", "2026-11-02", 8, 0, 70, 1, 0, 4, 0, 1],
    ["Firms", "Monopoly", "2026-11-09", 0, 0, null, 0, 0, 0, 0, 1],
    ["Firms", "Oligopoly", "2026-11-12", 0, 0, null, 0, 0, 0, 0],
  ],
};

const MODERN_HISTORY: ClassSpec = {
  name: "Modern History",
  examInDays: null,
  mastery: 0.9,
  plan: null,
  planDone: 0,
  weak: [],
  rows: [
    [null, "The French Revolution", "2026-09-02", 12, 0, 92, 4, 0, 10, 0, 1],
    [null, "The Napoleonic Wars", "2026-09-09", 12, 0, 94, 3, 0, 10, 0, 1],
    [null, "The Congress of Vienna", "2026-09-16", 10, 0, 88, 2, 0, 8, 0, 0.2],
    [null, "The Industrial Revolution", "2026-09-23", 12, 0, 90, 4, 0, 10, 0, 1],
    [null, "Liberalism and nationalism", "2026-09-30", 10, 0, 88, 3, 0, 8, 0, 1],
    [null, "The revolutions of 1848", "2026-10-07", 10, 0, 90, 3, 0, 8, 0, 1],
    [null, "Unification of Italy", "2026-10-14", 10, 0, 92, 2, 0, 8, 0, 1],
    [null, "Unification of Germany", "2026-10-21", 10, 0, 90, 2, 0, 8, 0, 1],
    [null, "The age of empire", "2026-10-28", 10, 0, 92, 2, 0, 8, 0, 1],
    [null, "The road to 1914", "2026-11-04", 10, 0, 90, 2, 0, 8, 0, 1],
    [null, "The First World War", "2026-11-09", 10, 0, 88, 2, 0, 8, 0, 1],
    [null, "Versailles and after", "2026-11-12", 10, 0, 90, 1, 0, 8, 0, 1],
  ],
};

const GENETICS: ClassSpec = {
  name: "Genetics",
  examInDays: null,
  mastery: null,
  plan: null,
  planDone: 0,
  weak: [],
  rows: [
    ["Inheritance", "Mendelian genetics", "2026-10-05", 0, 0, null, 0, 0, 0, 0, 1],
    ["Inheritance", "Linkage and mapping", "2026-10-12", 0, 0, null, 0, 0, 0, 0],
    ["Inheritance", "Pedigree analysis", "2026-10-19", 0, 0, null, 0, 0, 0, 0, 0.5],
    ["Genomes", "Mutation and repair", "2026-10-26", 0, 0, null, 0, 0, 0, 0],
    ["Genomes", "Population genetics", "2026-11-02", 0, 0, null, 0, 0, 0, 0],
    ["Genomes", "Genome sequencing", "2026-11-09", 0, 0, null, 0, 0, 0, 0],
  ],
};

const NEUROSCIENCE: ClassSpec = {
  name: "Neuroscience",
  examInDays: 21,
  mastery: 0.35,
  plan: ["Draw the action potential", "Review synaptic transmission", "Quiz on sensory systems", "Review weak topics"],
  planDone: 0,
  weak: [],
  rows: [
    ["Neurons", "The action potential", "2026-10-06", 10, 2, 40, 2, 1, 4, 1, 1],
    ["Neurons", "Synaptic transmission", "2026-10-13", 10, 2, 30, 1, 1, 3, 1, 0.5],
    ["Systems", "Sensory systems", "2026-10-27", 0, 0, null, 0, 0, 0, 0],
    ["Systems", "Motor control", "2026-11-03", 0, 0, null, 0, 0, 0, 0],
    ["Systems", "Memory and learning", "2026-11-10", 0, 0, null, 0, 0, 0, 0],
  ],
};

const SPECS: ClassSpec[] = [
  CELL_BIOLOGY,
  ORGANIC_CHEMISTRY,
  MICROECONOMICS,
  MODERN_HISTORY,
  GENETICS,
  NEUROSCIENCE,
];

/** The class names the older test fixtures use, mapped onto the design's classes. */
const ALIASES: Record<string, ClassSpec> = {
  "cell-biology": CELL_BIOLOGY,
  "organic-chemistry-ii": ORGANIC_CHEMISTRY,
  "linear-algebra": MICROECONOMICS,
  "medieval-europe": MODERN_HISTORY,
  "collab-notes": GENETICS,
};

/** The design's data for a class by its folder name, or an alias used by the test fixtures. */
export function designClassSpec(course: string): ClassSpec | undefined {
  return SPECS.find((spec) => spec.name === course) ?? ALIASES[course];
}

function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function stem(row: Row): string {
  return `${row[2]}-${slug(row[1])}`;
}

/** What `list_digests` returns: newest path first, with the unit folder. */
export function designDigests(course: string): DigestInfo[] {
  const spec = designClassSpec(course);
  if (!spec) {
    return [];
  }
  return spec.rows
    .map((row) => ({
      title: row[1],
      date: row[2],
      path: `${course}/digests/${stem(row)}.md`,
      unit: row[0],
      source_path: row[0] ? `${course}/${row[0]}/${slug(row[1])}.pdf` : `${course}/${slug(row[1])}.pdf`,
    }))
    .sort((a, b) => b.path.localeCompare(a.path));
}

/**
 * Each row paired with its `Course/digests/<file>.md` path. By default the path comes from the
 * row; `listed` (the paths another `list_digests` answer uses for this class, as the legacy
 * test fixtures do) is paired with the rows oldest first, so every source joins on one path.
 */
function pairedRows(course: string, listed?: readonly string[]): { row: Row; path: string }[] {
  const rows = designClassSpec(course)?.rows ?? [];
  if (!listed) {
    return rows.map((row) => ({ row, path: `${course}/digests/${stem(row)}.md` }));
  }
  const ascending = [...listed].sort();
  return ascending.slice(0, rows.length).map((path, index) => ({ row: rows[index]!, path }));
}

/** `study_progress digest-stats`: keyed by `digests/<file>.md`. */
export function designDigestStats(
  course: string,
  listed?: readonly string[],
): Record<string, DigestStatsRow> {
  const out: Record<string, DigestStatsRow> = {};
  for (const { row, path } of pairedRows(course, listed)) {
    const [, , , cards, due, mastery, quizRight, quizWrong, cardRight, cardWrong] = row;
    out[path.slice(course.length + 1)] = {
      cards,
      due,
      mastered: mastery === null ? 0 : Math.round((cards * mastery) / 100),
      mastery: mastery === null ? null : mastery / 100,
      quiz_correct: quizRight,
      quiz_wrong: quizWrong,
      card_correct: cardRight,
      card_wrong: cardWrong,
    };
  }
  return out;
}

/** `read_reading_state` for a library: keyed by `Course/digests/<file>.md`. */
export function designReadingState(
  courses: string[],
  listedByCourse: Record<string, readonly string[]> = {},
): Record<string, ReadingEntry> {
  const out: Record<string, ReadingEntry> = {};
  for (const course of courses) {
    for (const { row, path } of pairedRows(course, listedByCourse[course])) {
      const fraction = row[10];
      if (fraction === undefined) {
        continue;
      }
      out[path] = {
        fraction,
        last_opened: `${row[2]}T18:00:00Z`,
        read: fraction >= 0.9,
      };
    }
  }
  return out;
}

function dateInDays(now: Date, days: number): string {
  const when = new Date(now.getTime() + days * 86_400_000);
  return when.toISOString().slice(0, 10);
}

function dueTotal(spec: ClassSpec): number {
  return spec.rows.reduce((sum, row) => sum + row[4], 0);
}

function planTaskId(index: number): string {
  return `0a1b2c3d${index.toString(16).padStart(2, "0")}`;
}

const planToggles = new Map<string, boolean>();

export function resetDesignPlanToggles(): void {
  planToggles.clear();
}

/** `study_plan_status`; toggles persist for the session like the real plan state. */
export function designPlanStatus(course: string): StudyPlanStatus {
  const spec = designClassSpec(course);
  if (!spec?.plan) {
    return { done: 0, total: 0, tasks: [] };
  }
  const tasks = spec.plan.map((text, index) => {
    const id = planTaskId(index);
    return { id, text, done: planToggles.get(`${course}/${id}`) ?? index < spec.planDone };
  });
  return { done: tasks.filter((t) => t.done).length, total: tasks.length, tasks };
}

export function designPlanToggle(course: string, task: string, done: boolean): StudyPlanStatus {
  planToggles.set(`${course}/${task}`, done);
  return designPlanStatus(course);
}

export function designCourseRow(course: string, now: Date): TodayCourseRow {
  const spec = designClassSpec(course);
  if (!spec) {
    return {
      course,
      digest_count: 0,
      due_ids: [],
      deck_count: 0,
      mastered: 0,
      mastery: null,
      exam_date: null,
      days_to_exam: null,
      plan: null,
    };
  }
  const due = dueTotal(spec);
  const deck = spec.rows.reduce((sum, row) => sum + row[3], 0);
  const plan = designPlanStatus(course);
  return {
    course,
    digest_count: spec.rows.length,
    due_ids: Array.from({ length: due }, (_, i) => `fc-${slug(spec.name)}-${i + 1}`),
    deck_count: deck,
    mastered: spec.mastery === null ? 0 : Math.round(deck * spec.mastery),
    mastery: spec.mastery,
    exam_date: spec.examInDays === null ? null : dateInDays(now, spec.examInDays),
    days_to_exam: spec.examInDays,
    plan: spec.plan ? { done: plan.done, total: plan.total } : null,
  };
}

/** `study_today` for a library: the worker's JSON, weak topics carrying `wrong` and `correct`. */
export function designTodayPayload(courses: string[], now: Date = new Date()): TodayPayload {
  const rows = courses.map((course) => designCourseRow(course, now));
  const weak: WeakTopic[] = [];
  for (const course of courses) {
    const spec = designClassSpec(course);
    for (const topic of spec?.weak ?? []) {
      const row = spec!.rows.find((r) => r[1] === topic.lecture);
      weak.push({
        course,
        label: topic.label,
        digest: row ? `digests/${stem(row)}.md` : "digests/unknown.md",
        heading: topic.heading,
        wrong_rate: topic.wrong / (topic.wrong + topic.correct),
        wrong: topic.wrong,
        correct: topic.correct,
      });
    }
  }
  weak.sort((a, b) => b.wrong_rate - a.wrong_rate);
  const withExam = rows
    .filter((r) => r.exam_date !== null)
    .sort((a, b) => a.exam_date!.localeCompare(b.exam_date!))[0];
  return {
    courses: rows,
    weak_topics: weak,
    quiz_accuracy: {
      this_week: { correct: Math.round(courses.length * 6.5), total: courses.length * 8 },
      last_week: { correct: Math.round(courses.length * 5.4), total: courses.length * 8 },
    },
    next_exam: withExam
      ? { course: withExam.course, exam_date: withExam.exam_date!, days_to_exam: withExam.days_to_exam! }
      : null,
  };
}

/** `study_progress stats` for one class. */
export function designCourseStats(course: string): CourseStats {
  const spec = designClassSpec(course);
  const sum = (index: number) => (spec?.rows ?? []).reduce((total, row) => total + (row[index] as number), 0);
  const quiz = { correct: sum(6), total: sum(6) + sum(7) };
  const cards = { correct: sum(8), total: sum(8) + sum(9) };
  return {
    quiz: { this_week: quiz, last_week: { correct: Math.round(quiz.correct * 0.8), total: quiz.total } },
    cards: { this_week: cards, last_week: { correct: Math.round(cards.correct * 0.8), total: cards.total } },
  };
}

export const designUsageSummary: ProviderUsageSummary[] = [
  { provider: "grok", requests: 48, input_tokens: 182_400, output_tokens: 61_200, tokens_known: 48 },
  { provider: "codex", requests: 12, input_tokens: 40_100, output_tokens: 9_800, tokens_known: 10 },
];
