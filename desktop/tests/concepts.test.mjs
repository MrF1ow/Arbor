import assert from "node:assert/strict";
import test from "node:test";

async function subject() {
  try {
    return await import("../src/concepts.ts");
  } catch (error) {
    assert.fail(`concept graph module could not load: ${error}`);
  }
}

const graph = {
  schema_version: 1,
  course: "Biology",
  nodes: [
    {
      id: "glycolysis",
      name: "Glycolysis",
      summary: "Cytoplasmic breakdown of glucose to pyruvate.",
      sources: [
        { digest: "digests/2026-08-15.md", heading: "Glycolysis" },
        { digest: "digests/2026-08-16.md", heading: null },
      ],
    },
    {
      id: "pyruvate",
      name: "Pyruvate",
      summary: "Three-carbon product of glycolysis.",
      sources: [{ digest: "digests/2026-08-15.md", heading: "Glycolysis" }],
    },
    {
      id: "nadh",
      name: "NADH",
      summary: "Reduced electron carrier.",
      sources: [{ digest: "digests/2026-08-16.md", heading: "Energy" }],
    },
  ],
  edges: [
    {
      from: "glycolysis",
      to: "pyruvate",
      relation: "produces",
      sources: [{ digest: "digests/2026-08-15.md", heading: "Glycolysis" }],
    },
    {
      from: "glycolysis",
      to: "nadh",
      relation: "produces",
      sources: [{ digest: "digests/2026-08-16.md", heading: "Energy" }],
    },
  ],
};

test("parses a concept graph at the JSON boundary", async () => {
  const { parseConceptGraph } = await subject();

  assert.deepEqual(parseConceptGraph(graph), graph);
  assert.throws(
    () => parseConceptGraph({ ...graph, nodes: [] }),
    /at least one node/,
  );
});

test("finds nodes whose sources include a digest", async () => {
  const { parseConceptGraph, nodesForDigest } = await subject();
  const parsed = parseConceptGraph(graph);

  assert.deepEqual(
    nodesForDigest(parsed, "Biology/digests/2026-08-15.md").map((node) => node.id),
    ["glycolysis", "pyruvate"],
  );
  assert.deepEqual(
    nodesForDigest(parsed, "digests/2026-08-16.md").map((node) => node.id),
    ["glycolysis", "nadh"],
  );
  assert.deepEqual(nodesForDigest(parsed, "digests/missing.md"), []);
});

test("lists neighbors with relations", async () => {
  const { parseConceptGraph, neighbors } = await subject();
  const parsed = parseConceptGraph(graph);

  assert.deepEqual(neighbors(parsed, "glycolysis"), [
    { id: "pyruvate", name: "Pyruvate", relation: "produces" },
    { id: "nadh", name: "NADH", relation: "produces" },
  ]);
  assert.deepEqual(neighbors(parsed, "pyruvate"), [
    { id: "glycolysis", name: "Glycolysis", relation: "produces" },
  ]);
  assert.deepEqual(neighbors(parsed, "missing"), []);
});

test("builds Codex study job arguments for concepts", async () => {
  const { conceptJobArgs } = await subject();

  assert.deepEqual(
    conceptJobArgs("/knowledge", "Biology", true, "gpt-5.6-sol"),
    {
      root: "/knowledge",
      course: "Biology",
      skill: "concepts",
      force: true,
      model: "gpt-5.6-sol",
    },
  );
});
