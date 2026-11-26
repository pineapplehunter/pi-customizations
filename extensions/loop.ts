import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { privateQueueBlocksRepeat } from "./pueue-tool/daemon.ts";

export default function (pi: ExtensionAPI) {
  let prompt: string | undefined;
  let revision = 0;

  function stop(ctx: ExtensionContext) {
    const wasArmed = prompt !== undefined;
    revision++;
    prompt = undefined;
    ctx.ui.setStatus("loop", undefined);
    return wasArmed ? "Loop stopped." : "No loop is armed.";
  }

  pi.registerCommand("loop", {
    description: "Arm a prompt to repeat after the agent finishes: /loop <prompt> | /loop off",
    handler: async (args, ctx) => {
      const value = args.trim();
      if (value === "off") {
        ctx.ui.notify(stop(ctx), "info");
      } else if (value) {
        revision++;
        prompt = value;
        ctx.ui.setStatus("loop", "loop: armed");
      } else {
        ctx.ui.notify("Usage: /loop <prompt> | /loop off", "info");
      }
    },
  });

  pi.registerTool({
    name: "stop_loop",
    label: "Stop loop",
    description: "Stop the user's armed repeat prompt when the main task is finished. Does not cancel running jobs or end the current turn.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _update, ctx) {
      return { content: [{ type: "text", text: stop(ctx) }], details: {} };
    },
  });

  pi.on("agent_settled", async (event, ctx) => {
    if (!prompt) return;
    if (event.aborted) { stop(ctx); return; }
    if (ctx.hasPendingMessages()) return;
    const current = revision;
    let blocked: boolean;
    try {
      blocked = await privateQueueBlocksRepeat();
    } catch (error) {
      if (current === revision) {
        stop(ctx);
        ctx.ui.notify(`Loop stopped: cannot check the private Pueue queue. ${String(error)}`, "warning");
      }
      return;
    }
    if (current !== revision) return;
    if (blocked) {
      ctx.ui.setStatus("loop", "loop: waiting for Pueue");
    } else {
      ctx.ui.setStatus("loop", "loop: armed");
      if (!ctx.hasPendingMessages()) {
        pi.sendMessage({ customType: "loop-prompt", content: prompt, display: true }, { triggerTurn: true });
      }
    }
  });

  pi.on("session_tree", (_event, ctx) => { stop(ctx); });
  pi.on("session_shutdown", (_event, ctx) => { stop(ctx); });
}
