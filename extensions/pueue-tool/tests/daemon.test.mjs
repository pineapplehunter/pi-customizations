import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { test } from "node:test";
import { getRuntime, pueue, startDaemon, stopDaemon } from "../daemon.ts";

const available = ["pueue", "pueued"].every((name) => spawnSync(name, ["--version"]).status === 0);

test("private daemon starts once and cleans up", { skip: !available, timeout: 15_000 }, async () => {
  const runtime = getRuntime();
  try {
    await startDaemon(runtime);
    assert.equal(process.env.PUEUE_CONFIG_PATH, runtime.config);
    const status = JSON.parse(await pueue(runtime, ["status", "--json"]));
    assert.deepEqual(status.tasks, {});
    assert.equal(status.groups.default.parallel_tasks, Math.max(1, Math.ceil(availableParallelism() / 2)));
    await pueue(runtime, ["parallel", "1"]);
    await startDaemon(runtime);
    assert.equal(JSON.parse(await pueue(runtime, ["status", "--json"])).groups.default.parallel_tasks, 1);
  } finally { await stopDaemon(runtime); }
  assert.equal(existsSync(runtime.directory), false);
});
