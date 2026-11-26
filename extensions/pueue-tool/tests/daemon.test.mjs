import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { test } from "node:test";
import { getRuntime, privateQueueBlocksRepeat, pueue, queryTasks, startDaemon, stopDaemon, taskKey } from "../daemon.ts";

const available = ["pueue", "pueued"].every((name) => spawnSync(name, ["--version"]).status === 0);

test("private daemon starts once and cleans up", { skip: !available, timeout: 15_000 }, async () => {
  assert.equal(await privateQueueBlocksRepeat(), false); // An inherited PUEUE_CONFIG_PATH is not our queue.
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

    assert.equal(await privateQueueBlocksRepeat(), false);
    const id = (await pueue(runtime, ["add", "--print-task-id", "sleep 60"])).trim();
    await pueue(runtime, ["wait", "--status", "running", id]);
    runtime.paused = true; // Notification delivery isn't task execution.
    assert.equal(await privateQueueBlocksRepeat(), true);
    runtime.paused = false;
    await pueue(runtime, ["kill", id]);
    await pueue(runtime, ["wait", id]);
    const [done] = await queryTasks(runtime);
    assert.equal(await privateQueueBlocksRepeat(), true); // Don't race the completion turn.
    runtime.processed.add(taskKey(done));
    assert.equal(await privateQueueBlocksRepeat(), false);
  } finally { await stopDaemon(runtime); }
  assert.equal(existsSync(runtime.directory), false);
  await assert.rejects(privateQueueBlocksRepeat()); // An unreadable queue is not an empty queue.
});
