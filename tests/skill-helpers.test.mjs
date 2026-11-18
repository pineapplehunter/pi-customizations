import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

function helper(name, args) {
  const script = fileURLToPath(new URL(`../skills/${name}.ts`, import.meta.url));
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), "pi-skill-helpers-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("task directory helper resolves a workspace and creates its list", (t) => {
  const root = temporary(t);
  const result = helper("todo/scripts/task-dir", ["intree", "--root", root, "--create"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), join(root, "todo"));
  const first = helper("todo/scripts/task-dir", ["tmp", "--root", root]);
  const second = helper("todo/scripts/task-dir", ["tmp", "--root", root]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.match(first.stdout, /^\/tmp\/pi-tasks\/.+-[a-f0-9]{10}\/todo\n$/);
});

test("task metadata validates dates and lists pending tasks", (t) => {
  const directory = temporary(t);
  const path = join(directory, "task.md");
  const valid = "---\ntitle: Check portability\ncreated: 2024-02-29 12:30:00\nstatus: pending\npriority: P1\n---\n";
  writeFileSync(path, valid);
  const result = helper("todo/scripts/todo-stats", [directory]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Tasks \(1\)\n  \[P1\] Check portability/);
  writeFileSync(path, valid.replace("2024-02-29", "2025-02-29"));
  const invalid = helper("todo/scripts/todo-stats", [directory]);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /invalid created timestamp/);
});

test("initializer creates complete scaffolding and refuses to overwrite", (t) => {
  const directory = temporary(t);
  const args = ["example-skill", "--path", directory, "--resources", "scripts,references"];
  const result = helper("skill-creator/scripts/init-skill", args);
  assert.equal(result.status, 0, result.stderr);
  const skill = join(directory, "example-skill", "SKILL.md");
  const original = readFileSync(skill, "utf8");
  assert.match(original, /name: example-skill/);
  const repeated = helper("skill-creator/scripts/init-skill", args);
  assert.equal(repeated.status, 2);
  assert.match(repeated.stderr, /refusing to overwrite/);
  assert.equal(readFileSync(skill, "utf8"), original);
});
