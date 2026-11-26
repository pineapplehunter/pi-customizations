import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  let prompt: string | undefined;
  let pueueRunning = false;

  function stop(ctx: ExtensionContext) {
    const wasArmed = prompt !== undefined;
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

  // Pueue checks its private queue before settlement. If absent, nothing blocks.
  const unsubscribe = pi.events.on("pueue:running", (running) => {
    pueueRunning = running === true;
  });

  pi.on("agent_settled", (event, ctx) => {
    const blocked = pueueRunning;
    pueueRunning = false;
    if (!prompt) return;
    if (event.aborted) {
      stop(ctx);
    } else if (blocked) {
      ctx.ui.setStatus("loop", "loop: waiting for Pueue");
    } else {
      ctx.ui.setStatus("loop", "loop: armed");
      if (!ctx.hasPendingMessages()) {
        pi.sendMessage({ customType: "loop-prompt", content: prompt, display: true }, { triggerTurn: true });
      }
    }
  });

  pi.on("session_tree", (_event, ctx) => { stop(ctx); });
  pi.on("session_shutdown", (_event, ctx) => {
    stop(ctx);
    unsubscribe();
  });
}
