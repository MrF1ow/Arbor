import type { ConceptGraph, ConceptNeighbor, ConceptNode, ConceptSource } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonBlankString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function parseSource(value: unknown): ConceptSource {
  if (!isRecord(value)) throw new Error("concept source must be an object");
  const heading = value.heading;
  if (heading !== undefined && heading !== null && typeof heading !== "string") {
    throw new Error("source.heading must be a string or null");
  }
  return {
    digest: nonBlankString(value.digest, "source.digest"),
    heading: typeof heading === "string" ? heading : null,
  };
}

function parseNode(value: unknown): ConceptNode {
  if (!isRecord(value)) throw new Error("concept node must be an object");
  if (!Array.isArray(value.sources)) {
    throw new Error("node.sources must be an array");
  }
  return {
    id: nonBlankString(value.id, "node.id"),
    name: nonBlankString(value.name, "node.name"),
    summary: nonBlankString(value.summary, "node.summary"),
    sources: value.sources.map(parseSource),
  };
}

function parseEdge(value: unknown, nodeIds: Set<string>) {
  if (!isRecord(value)) throw new Error("concept edge must be an object");
  if (!Array.isArray(value.sources)) {
    throw new Error("edge.sources must be an array");
  }
  const from = nonBlankString(value.from, "edge.from");
  const to = nonBlankString(value.to, "edge.to");
  if (!nodeIds.has(from) || !nodeIds.has(to)) {
    throw new Error("edge endpoints must reference known nodes");
  }
  if (from === to) {
    throw new Error("concept edges must not be self-edges");
  }
  return {
    from,
    to,
    relation: nonBlankString(value.relation, "edge.relation"),
    sources: value.sources.map(parseSource),
  };
}

export function parseConceptGraph(value: unknown): ConceptGraph {
  if (!isRecord(value)) throw new Error("concept graph must be an object");
  if (value.schema_version !== 1) {
    throw new Error("concept graph schema_version must be 1");
  }
  if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
    throw new Error("concept graph must contain at least one node");
  }
  if (!Array.isArray(value.edges)) {
    throw new Error("concept graph edges must be an array");
  }
  const nodes = value.nodes.map(parseNode);
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    schema_version: 1,
    course: nonBlankString(value.course, "graph.course"),
    nodes,
    edges: value.edges.map((edge) => parseEdge(edge, nodeIds)),
  };
}

function digestKey(path: string): string {
  const index = path.indexOf("digests/");
  return index >= 0 ? path.slice(index) : path;
}

export function nodesForDigest(graph: ConceptGraph, digestPath: string): ConceptNode[] {
  const key = digestKey(digestPath);
  return graph.nodes.filter((node) =>
    node.sources.some((source) => digestKey(source.digest) === key),
  );
}

export function neighbors(graph: ConceptGraph, nodeId: string): ConceptNeighbor[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const found: ConceptNeighbor[] = [];
  for (const edge of graph.edges) {
    const otherId = edge.from === nodeId ? edge.to : edge.to === nodeId ? edge.from : null;
    if (otherId === null) continue;
    const other = byId.get(otherId);
    if (!other) continue;
    found.push({ id: other.id, name: other.name, relation: edge.relation });
  }
  return found;
}

export function conceptJobArgs(
  root: string,
  course: string,
  force: boolean,
  model: string,
) {
  return {
    root,
    course,
    skill: "concepts",
    force,
    model,
  };
}
