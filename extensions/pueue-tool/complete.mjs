// SPDX-License-Identifier: GPL-3.0-only
// Pueue interpolates only its numeric task ID. Never interpolate task commands
// or output into the callback shell command.
import { randomUUID } from "node:crypto";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [directory, id] = process.argv.slice(2);
if (!directory || !/^\d+$/.test(id ?? "")) throw new Error("Usage: complete.mjs DIRECTORY TASK_ID");
const inbox = join(directory, "completions");
const name = randomUUID();
const temporary = join(inbox, `.${name}`);
try {
  writeFileSync(temporary, JSON.stringify({ task_id: Number(id) }), { mode: 0o600, flag: "wx" });
  renameSync(temporary, join(inbox, `event-${name}.json`));
} catch (error) {
  // A late callback must not recreate an instance directory after shutdown.
  if (error.code !== "ENOENT") throw error;
} finally {
  try { unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
