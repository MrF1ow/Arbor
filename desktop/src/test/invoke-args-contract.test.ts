import ts from "typescript";
import { describe, expect, it } from "vitest";

// `src` has no Node types: read the files through an untyped dynamic import (tests run from `desktop/`).
const NODE_FS = "node:fs";
const { readFileSync, readdirSync } = (await import(/* @vite-ignore */ NODE_FS)) as {
  readFileSync: (path: string, encoding: "utf8") => string;
  readdirSync: (path: string, options: { withFileTypes: true }) => { name: string; isDirectory(): boolean }[];
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      return entry.name === "test" ? [] : sourceFiles(path);
    }
    const isSource = /\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name);
    return isSource ? [path] : [];
  });
}

type Payload = { file: string; command: string; keys: string[] };

/** Every `invoke("cmd", { ...literal payload })` call: the command and the payload's top-level keys. */
function invokePayloads(file: string, text: string): Payload[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: Payload[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
      const [command, payload] = node.arguments;
      if (name === "invoke" && command && ts.isStringLiteralLike(command) && payload && ts.isObjectLiteralExpression(payload)) {
        const keys = payload.properties.flatMap((prop) => {
          if (ts.isShorthandPropertyAssignment(prop)) return [prop.name.text];
          if (ts.isPropertyAssignment(prop) && (ts.isIdentifier(prop.name) || ts.isStringLiteralLike(prop.name))) {
            return [prop.name.text];
          }
          return [];
        });
        found.push({ file, command: command.text, keys });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("invoke payload keys", () => {
  it("finds a snake_case key in a literal payload (the scanner works)", () => {
    const found = invokePayloads("x.ts", `invoke("set_course_meta", { root, exam_date: d, examDate: d });`);
    expect(found).toEqual([{ file: "x.ts", command: "set_course_meta", keys: ["root", "exam_date", "examDate"] }]);
  });

  it("sends only camelCase keys: Tauri v2 maps command args by camelCase, a snake_case key reaches Rust as None", () => {
    const payloads = sourceFiles("src").flatMap((file) => invokePayloads(file, readFileSync(file, "utf8")));
    expect(payloads.length).toBeGreaterThan(10);
    const offenders = payloads.flatMap((p) => p.keys.filter((k) => k.includes("_")).map((k) => `${p.file}: ${p.command} sends \`${k}\``));
    expect(offenders).toEqual([]);
  });
});
