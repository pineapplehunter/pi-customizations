import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { inlineCode, type CompletionFormat, type LogFormat, type QueueState } from "../pueue-tool/hooks.ts";
import { ActivityParser } from "./activity.ts";

// This is intentionally outside the standalone pi-pueue package. The public
// extension knows only optional presentation hooks and a generic readiness event.
export default function (pi: ExtensionAPI) {
  let context: ExtensionContext | undefined;
  let state: QueueState = { ready: false };
  let finished = false;
  const child = process.env.PI_SUBAGENT_ROLE === "child";

  function finish(): void {
    if (!child || !context || finished || !context.isIdle() || (!state.ready && !state.error)) return;
    finished = true;
    pi.appendEntry("pueue-subagent-exit", { success: !state.error, error: state.error });
    context.shutdown();
  }

  const unsubscribe = [
    pi.events.on("pueue:format-completion", (data) => {
      const event = data as CompletionFormat;
      const task = event.task;
      const match = task.group === "subagent" && task.label?.match(/^subagent:([^:]+):(.+)$/);
      if (!match) return;
      const summary = event.content.split("  \n", 1)[0].replace(JSON.stringify(task.label), JSON.stringify(match[2]));
      const name = `'${match[2].replaceAll("'", "'\\''")}'`;
      const resume = `pi-subagent ${name} WORKSPACE FOLLOW_UP_FILE --resume ${match[1]}`;
      event.summary = summary;
      event.content = `${summary}  \nRead ${inlineCode(`/tmp/pi-subagent-state/${match[1]}/response.md`)}; on failure inspect ${inlineCode(`pueue log ${task.id}`)}.  \nResume with ${inlineCode(resume)} (repeat original context and resource options). Remove the workspace when no longer needed; retain session state if you may resume.`;
    }),
    pi.events.on("pueue:format-log", (data) => {
      const event = data as LogFormat;
      const match = event.task.group === "subagent" && event.task.label?.match(/^subagent:[^:]+:(.+)$/);
      if (!match) return;
      event.name = match[1].replace(/\s+/g, " ");
      event.mode = "Activity";
      const parser = new ActivityParser();
      event.parseLine = (line) => parser.parse(line);
    }),
    pi.events.on("pueue:state", (data) => {
      state = data as QueueState;
      finish();
    }),
  ];

  pi.on("session_start", (_event, ctx) => {
    context = ctx;
    finish();
  });

  pi.registerCommand("subagent-pueue-status", {
    description: "Show the private subagent/Pueue lifecycle integration status",
    handler: async (_args, ctx) => {
      ctx.ui.notify(state.error ?? (state.ready ? "Background results processed." : "Subagent Pueue adapter loaded."), state.error ? "error" : "info");
    },
  });

  pi.on("session_shutdown", () => {
    context = undefined;
    for (const off of unsubscribe) off();
  });
}
