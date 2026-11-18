// SPDX-License-Identifier: GPL-3.0-only
import { readdirSync, unlinkSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getRuntime, queryTasks, startDaemon, stopDaemon, type Runtime } from "./daemon.ts";
import { inlineCode, type CompletionFormat, type LogFormat, type QueueState, type Task } from "./hooks.ts";
import { parseInactivityTimeout } from "./inactivity.ts";
import { registerLogViewer } from "./logs.ts";

const MESSAGE_TYPE = "pueue-completion";
const RECONCILE_MS = 10_000;
const STATUS_KEY = "usage-pueue";

function taskKey(task: Task): string | undefined {
  if (typeof task.status !== "object" || !task.status.Done) return undefined;
  return JSON.stringify([task.id, task.status.Done.start, task.status.Done.end]);
}

function runningStatus(tasks: Task[]): string | undefined {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    const status = typeof task.status === "string" ? task.status : Object.keys(task.status)[0];
    if (status === "Running") counts.set(task.group, (counts.get(task.group) ?? 0) + 1);
  }
  if (!counts.size) return undefined;
  if (counts.size === 1 && counts.has("default")) return `pueue: ${counts.get("default")}`;
  const groups = [...counts.entries()].sort(([left], [right]) => {
    if (left === "default") return -1;
    if (right === "default") return 1;
    return left.localeCompare(right);
  });
  return `pueue: ${groups.map(([group, count]) => `${count}(${group})`).join(" ")}`;
}

export default function (pi: ExtensionAPI) {
  let runtime: Runtime | undefined;
  let context: ExtensionContext | undefined;
  let watcher: FSWatcher | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let serial: Promise<unknown> = Promise.resolve();
  const included = new Set<string>();
  let ready = false;
  let failure: string | undefined;

  function exclusive<T>(action: () => Promise<T>): Promise<T> {
    const next = serial.then(action);
    serial = next.catch(() => undefined);
    return next;
  }

  function formatLog(task: Task): LogFormat {
    const presentation: LogFormat = {
      task, name: (task.label || task.original_command || task.command).replace(/\s+/g, " "),
      mode: "Raw output",
    };
    pi.events.emit("pueue:format-log", presentation);
    return presentation;
  }

  registerLogViewer(pi, () => {
    if (!runtime || failure) return Promise.reject(new Error(failure ?? "Pueue is unavailable in this Pi mode."));
    return queryTasks(runtime);
  }, formatLog, () => runtime?.config);

  function publishState(): void {
    const state: QueueState = { ready: ready && !runtime?.paused, error: failure ?? runtime?.error };
    if (state.error) state.ready = false;
    pi.events.emit("pueue:state", state);
  }

  function completionMessage(tasks: Task[]) {
    const blocks = tasks.map((task) => {
      const done = typeof task.status === "object" ? task.status.Done : undefined;
      const label = task.label ? ` ${JSON.stringify(task.label)}` : "";
      const group = task.group !== "default" ? ` (${task.group})` : "";
      const elapsed = done?.start ? Date.parse(done.end) - Date.parse(done.start) : NaN;
      const duration = Number.isFinite(elapsed) && elapsed >= 0 ? ` (elapsed: ${(elapsed / 1000).toFixed(1)}s)` : "";
      const summary = `Task ${task.id}${label}${group}: ${JSON.stringify(done?.result)}${duration}.`;
      const command = `${summary}  \n${inlineCode(task.original_command ?? task.command)}`;
      const presentation: CompletionFormat = {
        task, summary: command,
        content: `${command}${task.path ? `  \nWorking directory: ${inlineCode(task.path)}.` : ""}  \nInspect output with ${inlineCode(`pueue log ${task.id}`)}.`,
      };
      pi.events.emit("pueue:format-completion", presentation);
      return presentation;
    });
    return {
      customType: MESSAGE_TYPE,
      content: `${blocks.map((block) => block.content).join("\n\n")} Process these task results.`,
      display: true,
      details: { queue: runtime!.directory, keys: tasks.map(taskKey), summary: blocks.map((block) => block.summary).join("\n\n") },
    };
  }

  function cleanup(): void {
    generation++;
    watcher?.close();
    watcher = undefined;
    if (timer) clearInterval(timer);
    if (debounce) clearTimeout(debounce);
    timer = undefined;
    debounce = undefined;
    context?.ui.setStatus(STATUS_KEY, undefined);
    context?.ui.setStatus("pueue-notify", undefined);
    context = undefined;
    included.clear();
    ready = false;
  }

  function inactivityMessage(tasks: Task[]) {
    const overdue = runtime!.inactivity.check(tasks, runtime!.inactivityMs);
    if (!overdue.length) return undefined;
    const summary = overdue.map(({ task, idleMs }) =>
      `Task ${task.id}${task.label ? ` ${JSON.stringify(task.label)}` : ""} (${task.group}): no new output observed for ${(idleMs / 60_000).toFixed(1)} minutes.  \n${inlineCode(task.original_command ?? task.command)}  \nInspect ${inlineCode(`pueue log --lines 30 ${task.id}`)}.`,
    ).join("\n\n");
    return {
      customType: "pueue-inactivity",
      content: `${summary}\n\nThese running tasks exceeded the ${(runtime!.inactivityMs / 60_000).toFixed(1)} minute inactivity threshold. Inspect their logs and process state to determine whether they have stalled. Silence alone is not failure; do not cancel or restart solely because of this reminder.`,
      display: true,
      details: { taskIds: overdue.map(({ task }) => task.id), summary },
    };
  }

  async function collect(): Promise<{ tasks: Task[]; fresh: Task[] }> {
    const inbox = join(runtime!.directory, "completions");
    const events = readdirSync(inbox).filter((name) => name.endsWith(".json"));
    const tasks = await queryTasks(runtime!);
    if (context?.mode === "tui") context.ui.setStatus(STATUS_KEY, runningStatus(tasks));
    const fresh = tasks.filter((task) => {
      const key = taskKey(task);
      return key && !runtime!.processed.has(key) && !runtime!.queued.has(key);
    });
    for (const name of events) {
      try { unlinkSync(join(inbox, name)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return { tasks, fresh };
  }

  function enqueue(tasks: Task[]): void {
    ready = false;
    for (const task of tasks) runtime!.queued.add(taskKey(task)!);
  }

  function warn(ctx: ExtensionContext, error: unknown): void {
    failure = `Cannot check Pueue completions; restart Pi. ${String(error)}`;
    ready = false;
    ctx.ui.setStatus("pueue-notify", "pueue: unavailable; restart Pi");
    publishState();
  }

  function schedule(): void {
    if (!context || debounce || failure) return;
    const current = generation;
    debounce = setTimeout(() => {
      debounce = undefined;
      void exclusive(async () => {
        const ctx = context;
        if (!ctx || current !== generation) return;
        try {
          const { tasks, fresh } = await collect();
          if (current !== generation || runtime!.paused) return;
          if (fresh.length) {
            enqueue(fresh);
            pi.sendMessage(completionMessage(fresh), { triggerTurn: true, deliverAs: "steer" });
          }
          const reminder = inactivityMessage(tasks);
          if (reminder) pi.sendMessage(reminder, { triggerTurn: true, deliverAs: "steer" });
        } catch (error) {
          if (current === generation) warn(ctx, error);
        }
      });
    }, 100);
    debounce.unref?.();
  }

  pi.on("session_start", async (_event, ctx) => {
    cleanup();
    if (ctx.mode !== "tui" && ctx.mode !== "rpc") return;
    context = ctx;
    failure = undefined;
    try {
      runtime = getRuntime();
      runtime.queued.clear(); // Unprocessed deliveries from an old binding may need redelivery.
      await startDaemon(runtime);
      if (runtime.error) throw new Error(runtime.error);
      watcher = watch(join(runtime.directory, "completions"), schedule);
      watcher.on("error", (error) => warn(ctx, error));
      timer = setInterval(schedule, RECONCILE_MS);
      timer.unref?.();
      schedule();
    } catch (error) {
      failure = runtime?.error ?? String(error);
      if (!runtime?.notified) {
        ctx.ui.notify(failure, "warning");
        if (runtime) runtime.notified = true;
      }
      publishState();
    }
  });

  pi.on("session_tree", () => {
    // Navigation can hide a delivered-but-unprocessed notification. Reconcile
    // it again on the active branch; completed attempts remain deduplicated.
    runtime?.queued.clear();
    included.clear();
    ready = false;
    schedule();
  });

  pi.on("before_agent_start", (event) => {
    ready = false;
    included.clear();
    if (runtime && event.messageType === "user" && !runtime.error) {
      runtime.paused = false;
      failure = undefined;
    }
    publishState();
    const status = !context ? "Pueue is unavailable in single-shot mode; do not use it."
      : failure || runtime?.error ? `${failure ?? runtime?.error} Do not use Pueue.`
      : `Current Pueue queue: ${runtime!.directory}. It belongs to this Pi process, not the conversation. Historical task IDs may belong to an older queue.`;
    return { systemPrompt: `${event.systemPrompt}\n\n${status}` };
  });

  pi.on("context", (event) => {
    if (!runtime) return;
    for (const message of event.messages) {
      if (message.role === "custom" && message.customType === MESSAGE_TYPE) {
        const details = message.details as { queue?: string; keys: string[] };
        if (details.queue !== runtime.directory) continue;
        for (const key of details.keys) {
          if (!runtime.processed.has(key)) included.add(key);
        }
      }
    }
  });

  pi.on("agent_before_settle", async (event, ctx) => {
    if (!context) return;
    return exclusive(async () => {
      ready = false;
      if (event.outcome !== "completed") {
        runtime!.paused = true;
        failure = `Agent run ${event.outcome}; background results were not all processed.`;
        return;
      }
      if (failure || runtime!.error) return;
      for (const key of included) {
        runtime!.processed.add(key);
        runtime!.queued.delete(key);
      }
      included.clear();
      if (runtime!.paused) return;
      try {
        const { tasks, fresh } = await collect();
        if (fresh.length) {
          enqueue(fresh);
          return { entries: [{ type: "custom_message" as const, ...completionMessage(fresh) }], continue: true };
        }
        const reminder = inactivityMessage(tasks);
        if (reminder) return { entries: [{ type: "custom_message" as const, ...reminder }], continue: true };
        ready = tasks.every((task) => {
          const key = taskKey(task);
          return key !== undefined && runtime!.processed.has(key);
        }) && runtime!.queued.size === 0 && !event.continue && !ctx.hasPendingMessages();
      } catch (error) { warn(ctx, error); }
    });
  });

  pi.on("agent_settled", (event) => {
    if (!context) return;
    if (event.aborted) {
      runtime!.paused = true;
      ready = false;
      failure = "Agent run aborted; background results were not all processed.";
    }
    publishState();
  });

  pi.registerCommand("pueue-notifications", {
    description: "Resume automatic Pueue completion turns, or pause them with 'off'",
    handler: async (args, ctx) => {
      if (!runtime || runtime.error) { ctx.ui.notify(runtime?.error ?? "Pueue is unavailable in this Pi mode.", "warning"); return; }
      runtime.paused = args.trim() === "off";
      if (!runtime.paused) {
        failure = undefined;
        runtime.queued.clear();
      }
      ctx.ui.notify(`Pueue completion notifications ${runtime.paused ? "paused" : "enabled"}.`, "info");
      if (!runtime.paused) schedule();
    },
  });

  pi.registerCommand("pueue-inactivity", {
    description: "Set the no-output reminder timeout (default 30m): <duration s/m/h> | off; no argument shows the setting",
    handler: async (args, ctx) => {
      if (!runtime || failure) { ctx.ui.notify(failure ?? "Pueue is unavailable in this Pi mode.", "warning"); return; }
      const value = args.trim().toLowerCase();
      if (value) {
        const timeout = parseInactivityTimeout(value);
        if (timeout === undefined) { ctx.ui.notify("Usage: /pueue-inactivity <30s|30m|2h|off>", "warning"); return; }
        runtime.inactivityMs = timeout;
        runtime.inactivity.reset();
        schedule();
      }
      ctx.ui.notify(runtime.inactivityMs
        ? `Pueue inactivity reminders: ${runtime.inactivityMs / 60_000} minutes without output (checked every 10s).`
        : "Pueue inactivity reminders disabled.", "info");
    },
  });

  pi.on("session_shutdown", async (event) => {
    cleanup();
    await serial;
    runtime?.queued.clear();
    if (event.reason === "quit" && runtime) await stopDaemon(runtime);
  });
}
