// SPDX-License-Identifier: GPL-3.0-only
import assert from "node:assert/strict";
import { test } from "node:test";
import { InactivityMonitor, parseInactivityTimeout } from "../inactivity.ts";

test("timeout parsing and a quiet task's reminder window", () => {
  assert.equal(parseInactivityTimeout("30m"), 1_800_000);
  assert.equal(parseInactivityTimeout("off"), 0);
  assert.equal(parseInactivityTimeout("invalid"), undefined);
  const monitor = new InactivityMonitor("/nonexistent-pueue-test-directory");
  const task = { id: 1, status: { Running: { start: "first" } } };
  assert.deepEqual(monitor.check([task], 1000, 0), []);
  assert.equal(monitor.check([task], 1000, 1000).length, 1);
  assert.deepEqual(monitor.check([task], 1000, 1500), []);
  assert.deepEqual(monitor.check([task], 0, 2000), []);
});
