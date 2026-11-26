import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { startReviewServer, type CloseReason, type ReviewServer } from "./server.ts";
import { ReviewStore } from "./store.ts";

const MESSAGE = "review-inbox-reply";
const SERVER_STATUS = "review-inbox-server";
const cardId = Type.String({ description: "Card ID returned by review_request or review_list" });
const options = Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 100 }), {
  maxItems: 10, description: 'Single-select labels, e.g. ["Approve", "Request changes"]',
}));
const closeLabels: Record<CloseReason, string> = {
  complete: "all cards answered",
  resolved: "no cards need a response",
  cleared: "inbox cleared",
  shutdown: "Pi session ended",
};
type Inbox = { store: ReviewStore; queued: Set<string>; opening?: Promise<ReviewServer> };

export default function (pi: ExtensionAPI) {
  let inbox: Inbox | undefined;
  const included = new Set<string>();
  pi.registerEntryRenderer<string>(SERVER_STATUS, (entry, _options, theme) => (
    new Text(theme.fg("dim", `Review inbox: ${entry.data}`), 1, 0)
  ));

  function showStatus(ctx: ExtensionContext, message: string) {
    if (ctx.mode === "tui") pi.appendEntry(SERVER_STATUS, message);
  }

  const getInbox = (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui" && ctx.mode !== "rpc") throw new Error("The review inbox needs a running interactive or RPC Pi session.");
    return inbox ??= { store: new ReviewStore(ctx.sessionManager.getSessionId()), queued: new Set() };
  };

  function deliver(current: Inbox, ctx: ExtensionContext) {
    const fresh = current.store.cards.flatMap(card => card.rounds.flatMap((round, roundIndex) => (
      round.replies.flatMap((reply, index) => reply.processed || current.queued.has(reply.id) || included.has(reply.id)
        ? [] : [{ card, reply, index, roundNumber: roundIndex + 1 }])
    )));
    if (!fresh.length) return;
    const ids = fresh.map(({ reply }) => reply.id);
    ids.forEach(id => current.queued.add(id));
    try {
      const responses = fresh.map(({ card, reply, index, roundNumber }) => (
        `${reply.comment ? "Comment on retracted card" : index === 0 ? "Answer" : "Follow-up"} for ${card.title} [${card.id}], Round ${roundNumber}\n`
        + [reply.choice !== undefined ? `Selected: ${reply.choice}` : "", reply.text].filter(Boolean).join("\n")
      ));
      pi.sendMessage({ customType: MESSAGE, content: responses.join("\n\n"), details: { ids }, display: true }, {
        triggerTurn: true, deliverAs: "steer",
      });
    } catch (error) {
      ids.forEach(id => current.queued.delete(id));
      ctx.ui.notify(`Review reply saved but not queued: ${String(error)}. Use review_list to try again.`, "error");
    }
  }

  async function publish(current: Inbox, ctx: ExtensionContext) {
    if (!current.store.pending) return;
    const opening = current.opening ??= startReviewServer(current.store, () => deliver(current, ctx), (port, reason) => {
      if (reason === "complete" || reason === "resolved") current.opening = undefined;
      showStatus(ctx, `Closed server on port ${port} (${closeLabels[reason]}).`);
    }).then(server => {
      showStatus(ctx, `Opened server on port ${server.port}.`);
      return server;
    });
    try {
      const server = await opening;
      if (current.opening !== opening) return;
      server.publish();
      return server.url;
    } catch (error) {
      if (current.opening === opening) current.opening = undefined;
      throw new Error(`Could not open the review inbox: ${String(error)}. After fixing the problem, use review_list to reopen it.`);
    }
  }

  async function stop(current: Inbox, reason: CloseReason) {
    const opening = current.opening;
    current.opening = undefined;
    const server = await opening?.catch(() => undefined);
    if (reason === "cleared") server?.publish();
    server?.stop(reason);
  }

  pi.on("context", event => {
    included.clear();
    for (const message of event.messages) {
      if (message.role === "custom" && message.customType === MESSAGE) {
        for (const id of (message.details as { ids: string[] }).ids) included.add(id);
      }
    }
  });

  pi.on("turn_end", event => {
    if (event.outcome === "completed") inbox?.store.markProcessed(included);
  });

  pi.on("agent_settled", () => {
    inbox?.queued.clear();
    included.clear();
  });

  pi.on("session_shutdown", async () => {
    const current = inbox;
    inbox = undefined;
    included.clear();
    if (current) await stop(current, "shutdown");
  });

  pi.registerTool({
    name: "review_request",
    label: "Request browser review",
    description: "Post one asynchronous question or review request to the user's browser inbox. Only use when the user wants asynchronous browser review. For grilling, include your recommendation in the Markdown body. Free-text responses are always allowed. This returns immediately; share the URL and continue independent work or finish your turn instead of polling. Browser replies arrive as steering messages.",
    parameters: Type.Object({
      title: Type.String({ minLength: 1, maxLength: 160 }),
      body: Type.String({ maxLength: 24_000, description: "Markdown question and context" }),
      options,
      images: Type.Optional(Type.Array(Type.Object({
        path: Type.String({ description: "Local PNG, JPEG, or WebP file (up to 8 MiB)" }),
        alt: Type.String({ description: "Brief description of the image" }),
      }), { maxItems: 4 })),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const current = getInbox(ctx);
      const card = current.store.post(params, ctx.cwd);
      deliver(current, ctx);
      const url = await publish(current, ctx);
      return { content: [{ type: "text", text: `Posted ${card.title} [${card.id}].${url ? ` Review inbox: ${url}` : ""}` }], details: { cardId: card.id, url } };
    },
  });

  pi.registerTool({
    name: "review_update",
    label: "Follow up on browser review",
    description: "Ask for another response on an existing card. Append a numbered Markdown round, keep earlier rounds and replies, and supersede any unanswered round. Choices are fresh; omit them for free text only. Retracted cards cannot be reopened. Returns immediately; share the URL rather than polling.",
    parameters: Type.Object({
      card_id: cardId,
      body: Type.String({ minLength: 1, maxLength: 24_000, description: "Markdown follow-up question and context" }),
      options,
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const current = getInbox(ctx);
      const card = current.store.update(params.card_id, params.body, params.options);
      deliver(current, ctx);
      const url = await publish(current, ctx);
      const round = card.rounds.length;
      return { content: [{ type: "text", text: `Posted Round ${round} for ${card.title} [${card.id}].${url ? ` Review inbox: ${url}` : ""}` }], details: { cardId: card.id, round, url } };
    },
  });

  pi.registerTool({
    name: "review_retract",
    label: "Retract browser review",
    description: "Mark an existing card as retracted, even if answered. Keep it and all its replies in history. The user can comment while the inbox is open, but the card no longer needs a response. This does not send a reply or start the server.",
    parameters: Type.Object({ card_id: cardId }),
    async execute(_id, { card_id }, _signal, _update, ctx) {
      const current = getInbox(ctx);
      const retracted = current.store.retract(card_id);
      const opening = current.opening;
      const server = await opening?.catch(() => undefined);
      if (server && current.opening === opening) {
        server.publish();
        if (!current.store.pending) server.stop("resolved");
      }
      return { content: [{ type: "text", text: retracted ? `Retracted card ${card_id}.` : `Card ${card_id} was already retracted.` }], details: { cardId: card_id, retracted: true } };
    },
  });

  pi.registerTool({
    name: "review_list",
    label: "List browser reviews",
    description: "Read this conversation's saved review cards and replies. Open the browser inbox if cards still need answers; otherwise leave the server off. Recover replies saved before a restart. Do not poll for replies.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _update, ctx) {
      const current = getInbox(ctx);
      deliver(current, ctx);
      const url = await publish(current, ctx);
      const cards = current.store.cards.map(card => ({
        ...card,
        images: card.images.map(image => image.alt),
        rounds: card.rounds.map((round, index) => ({
          ...round,
          superseded: index < card.rounds.length - 1 && !round.replies.length,
          replies: round.replies.map(({ processed: _, ...reply }) => reply),
        })),
      }));
      const heading = url ? `Review inbox: ${url}` : cards.length ? "No cards need a response; browser inbox closed." : "No review cards.";
      return { content: [{ type: "text", text: `${heading}${cards.length ? `\n${JSON.stringify(cards, null, 2)}` : ""}` }], details: { url, cards } };
    },
  });

  pi.registerCommand("review-clear", {
    description: "Clear this conversation's browser review inbox",
    async handler(_args, ctx) {
      const current = getInbox(ctx);
      if (!current.store.cards.length) { ctx.ui.notify("The review inbox is empty.", "info"); return; }
      if (!await ctx.ui.confirm("Clear the review inbox?", "Delete this conversation's review cards, replies, and images? The Pi transcript is kept.")) return;
      if (inbox !== current) return;
      current.store.clear();
      current.queued.clear();
      await stop(current, "cleared");
      ctx.ui.notify("Review inbox cleared.", "info");
    },
  });
}
