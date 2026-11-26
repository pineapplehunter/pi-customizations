import { execFile, spawn, type ChildProcess } from "node:child_process";
import { chmodSync, closeSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { InactivityMonitor } from "./inactivity.ts";
import type { Task } from "./hooks.ts";

export const MISSING_PUEUE = "Pueue not found. Install Pueue, which provides pueue and pueued, then restart Pi.";
const RUNTIME = Symbol.for("pi-pueue.runtime");

export interface Runtime {
  directory: string;
  config: string;
  daemon?: ChildProcess;
  start?: Promise<Runtime>;
  stop?: Promise<void>;
  error?: string;
  notified: boolean;
  processed: Set<string>;
  queued: Set<string>;
  inactivity: InactivityMonitor;
  inactivityMs: number;
  paused: boolean;
  onExit?: () => void;
}

// This belongs to the Node process, not a reloaded extension module or a
// conversation branch. Children do NOT inherit it, even if they inherit env.
export function getRuntime(): Runtime {
  const globals = globalThis as typeof globalThis & { [RUNTIME]?: Runtime };
  if (!globals[RUNTIME]) {
    const directory = mkdtempSync(join(tmpdir(), "pi-pueue-"));
    chmodSync(directory, 0o700);
    const config = join(directory, "config.json");
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const callback = [process.execPath, fileURLToPath(new URL("./complete.mjs", import.meta.url)), directory]
      .map(quote).join(" ") + " {{id}}";
    // JSON is YAML: no YAML dependency or unsafe path interpolation required.
    writeFileSync(config, JSON.stringify({
      shared: {
        pueue_directory: directory,
        runtime_directory: directory,
        use_unix_socket: true,
        unix_socket_path: join(directory, "socket"),
        pid_path: join(directory, "pid"),
      },
      daemon: { callback, callback_log_lines: 0 },
    }), { mode: 0o600 });
    mkdirSync(join(directory, "completions"), { mode: 0o700 });
    globals[RUNTIME] = {
      directory, config, notified: false,
      processed: new Set(), queued: new Set(),
      inactivity: new InactivityMonitor(directory),
      inactivityMs: 30 * 60_000, paused: false,
    };
  }
  const runtime = globals[RUNTIME]!;
  // Never attach to inherited or host configuration. This also makes normal
  // subsequent bash/nix/subprocess calls use the same private queue.
  process.env.PUEUE_CONFIG_PATH = runtime.config;
  process.env.PI_PUEUE_NOTIFY_DIR = runtime.directory;
  return runtime;
}

export function pueue(runtime: Runtime, args: string[], timeout = 5_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("pueue", ["--config", runtime.config, ...args], {
      encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024,
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

export async function queryTasks(runtime: Runtime): Promise<Task[]> {
  const status = JSON.parse(await pueue(runtime, ["status", "--json"])) as { tasks: Record<string, Task> };
  return Object.values(status.tasks);
}

function executable(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, ["--version"], { timeout: 5_000 }, (error) => error ? reject(error) : resolve());
  });
}

export function startDaemon(runtime: Runtime): Promise<Runtime> {
  runtime.start ??= (async () => {
    try {
      await Promise.all([executable("pueue"), executable("pueued")]);
      const log = openSync(join(runtime.directory, "daemon.log"), "a", 0o600);
      try {
        runtime.daemon = spawn("pueued", ["--config", runtime.config], {
          detached: true, stdio: ["ignore", log, log],
        });
      } finally { closeSync(log); }
      const daemon = runtime.daemon;
      daemon.on("error", (error) => { runtime.error = String(error); });
      daemon.on("exit", (code, signal) => {
        if (!runtime.stop) runtime.error = `Pueue stopped (${signal ?? code}); restart Pi.`;
      });
      daemon.unref();
      runtime.onExit = () => { daemon.kill("SIGTERM"); };
      process.once("exit", runtime.onExit);
      const deadline = Date.now() + 5_000;
      while (true) {
        if (runtime.error) throw new Error(runtime.error);
        try {
          await pueue(runtime, ["status", "--json"], 500);
          break;
        } catch (error) {
          if (Date.now() >= deadline) throw error;
          await delay(50);
        }
      }
      await pueue(runtime, ["parallel", String(Math.max(1, Math.ceil(availableParallelism() / 2)))]);
      return runtime;
    } catch (error) {
      runtime.error = (error as NodeJS.ErrnoException).code === "ENOENT"
        ? MISSING_PUEUE : `Pueue unavailable; restart Pi. ${String(error)}`;
      runtime.daemon?.kill("SIGTERM");
      throw new Error(runtime.error);
    }
  })();
  return runtime.start;
}

export function stopDaemon(runtime: Runtime): Promise<void> {
  runtime.stop ??= (async () => {
    const daemon = runtime.daemon;
    if (daemon?.pid && daemon.exitCode === null && daemon.signalCode === null) {
      // Pueue's normal SIGTERM path kills managed tasks before exiting.
      const exited = new Promise<void>((resolve) => daemon.once("exit", () => resolve()));
      daemon.kill("SIGTERM");
      const timer = setTimeout(() => daemon.kill("SIGKILL"), 5_000);
      try { await exited; } finally { clearTimeout(timer); }
    }
    if (runtime.onExit) process.off("exit", runtime.onExit);
    rmSync(runtime.directory, { recursive: true, force: true });
  })();
  return runtime.stop;
}
