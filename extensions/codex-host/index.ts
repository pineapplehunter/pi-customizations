import { request, type IncomingMessage } from "node:http";
import {
  lazyStream,
  type Api,
  type AssistantMessageEvent,
  type Model,
  type Provider,
  type SimpleStreamOptions,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installUsage, type Account } from "./usage.js";
import { chooseRoute, ID, isRoute, readRouteDefault, ROUTES, saveRouteDefault, sessionRoute, type Route } from "./route.js";

type Catalog = { routes: Route[]; models: Model<Api>[]; warning?: string };
const automaticRoute = (routes?: Route[]) => routes?.includes("auto") ? "auto" : routes?.[0];
const BASE = "http://codex-host.invalid"; // Never used as a network destination.
const AUTH = { apiKey: "local-codex-broker" }; // Non-secret availability marker.

function connect(socketPath: string, path: string, signal?: AbortSignal, data?: unknown): Promise<IncomingMessage> {
  const body = data === undefined ? undefined : Buffer.from(JSON.stringify(data));
  return new Promise((resolve, reject) => {
    const req = request({
      socketPath, path, signal, agent: false, method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json", "Content-Length": body.length,
        ...(path === "/v1/chat" ? { "X-Pi-Codex-Route-Events": "1" } : {}) } : undefined,
    }, resolve);
    req.on("error", reject);
    req.end(body);
  });
}

async function readJson<T>(res: IncomingMessage): Promise<T> {
  const buffers = [];
  for await (const chunk of res) buffers.push(chunk);
  return JSON.parse(Buffer.concat(buffers).toString("utf8"));
}

export default async function (pi: ExtensionAPI): Promise<void> {
  const socket = process.env.PI_CODEX_HOST_SOCKET;
  if (!socket) return;

  let catalog: Catalog | undefined;
  let checkedAt = 0;
  const discover = async (signal?: AbortSignal, force = false, allowNetwork = false) => {
    if (!force && !allowNetwork && catalog && Date.now() - checkedAt < 5_000) return catalog;
    const timeout = AbortSignal.timeout(allowNetwork ? 12_000 : 2_000);
    const path = allowNetwork ? `/v1/catalog?${force ? "force" : "refresh"}=1` : "/v1/catalog";
    const res = await connect(socket, path, signal ? AbortSignal.any([signal, timeout]) : timeout);
    if (res.statusCode !== 200) {
      res.destroy();
      throw new Error("Codex broker catalog unavailable.");
    }
    catalog = await readJson<Catalog>(res);
    checkedAt = Date.now();
    return catalog;
  };
  const initial = await discover(undefined, false, process.env.PI_OFFLINE === undefined).catch(() => undefined);
  let defaultRoute = await readRouteDefault().catch(() => undefined);
  let route = defaultRoute ?? automaticRoute(initial?.routes);
  let autoAccount: Account | undefined;
  let sessionVersion = 0;
  let fast = false;
  let fastCheck: AbortController | undefined;
  const stopFast = () => {
    fast = false;
    fastCheck?.abort();
    fastCheck = undefined;
  };
  pi.on("model_select", ({ model, previousModel }) => {
    if (model.id !== previousModel?.id || model.provider !== previousModel?.provider) stopFast();
  });

  const clearAutoAccount = () => { autoAccount = undefined; sessionVersion++; };
  pi.on("session_start", (_, ctx) => {
    route = sessionRoute(ctx) ?? defaultRoute ?? automaticRoute(catalog?.routes);
    clearAutoAccount();
    stopFast();
  });
  pi.on("session_shutdown", () => { clearAutoAccount(); stopFast(); });
  const call = async <T>(path: string, data: object, signal?: AbortSignal, timeoutMs = 12_000) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const res = await connect(socket, path, signal ? AbortSignal.any([timeout, signal]) : timeout, data);
    const result = await readJson<T & { error?: string }>(res);
    if (res.statusCode !== 200) throw new Error(result.error ?? "Codex broker request failed.");
    return result;
  };
  const currentRoute = () => route ?? automaticRoute(catalog?.routes);
  const updateUsage = installUsage(pi, call, currentRoute, () => autoAccount, () => fast);
  pi.registerCommand("fast", {
    description: "Toggle priority for the current host Codex model and route",
    handler: async (args, ctx) => {
      if (args.trim()) return ctx.ui.notify("Usage: /fast", "warning");
      if (ctx.model?.provider !== ID) return ctx.ui.notify("Select a host Codex model to use /fast.", "info");
      if (fast) {
        stopFast();
        updateUsage();
        return ctx.ui.notify("Codex Fast off.", "info");
      }
      if (fastCheck) return ctx.ui.notify("Checking Codex Fast capability.", "info");
      const selected = currentRoute();
      if (!selected) return ctx.ui.notify("No host Codex route is available.", "warning");
      const check = new AbortController();
      fastCheck = check;
      try {
        const result = await call<{ account: Account; capability: "supported" | "unsupported" | "unknown" }>(
          "/v1/fast", { model: ctx.model.id, route: selected }, check.signal, 18_000);
        if (fastCheck !== check || currentRoute() !== selected) return;
        if (result.capability !== "supported") {
          const account = ROUTES[result.account];
          return ctx.ui.notify(result.capability === "unsupported"
            ? `Codex ${account} does not advertise Fast for this model.`
            : `Could not verify Fast on Codex ${account}. Fast remains off.`, "warning");
        }
        fast = true;
        updateUsage();
        ctx.ui.notify(`Codex Fast on (verified on ${ROUTES[result.account]}). Priority can use more quota.`, "info");
      } catch (error) {
        if (!check.signal.aborted) ctx.ui.notify(error instanceof Error ? error.message : "Could not verify Codex Fast.", "warning");
      } finally {
        if (fastCheck === check) fastCheck = undefined;
      }
    },
  });
  pi.on("session_tree", (_, ctx) => {
    const next = sessionRoute(ctx) ?? defaultRoute ?? automaticRoute(catalog?.routes);
    if (next !== route) stopFast();
    route = next;
    clearAutoAccount();
    updateUsage();
  });
  pi.registerCommand("codex-route", {
    description: "Choose the host Codex route for this session",
    handler: async (args, ctx) => {
      try {
        const choices = (await discover(undefined, true)).routes.filter(isRoute);
        if (!choices.length) return ctx.ui.notify("No Codex accounts are ready. Sign in with pi-codex-auth on the host.", "warning");
        const input = args.trim().toLowerCase();
        const selected = input ? choices.find((choice) => choice === input) : undefined;
        if ((input && !selected) || (!input && ctx.mode !== "tui")) {
          return ctx.ui.notify(`Usage: /codex-route ${choices.join(" | ")}`, "info");
        }
        const choice = selected ? { route: selected, save: false } :
          await chooseRoute(ctx, choices, route, await readRouteDefault().catch(() => undefined));
        if (!choice) return;
        if (choice.save) {
          await saveRouteDefault(choice.route);
          defaultRoute = choice.route;
        }
        pi.appendEntry("codex-route", choice.route);
        if (route !== choice.route) { clearAutoAccount(); stopFast(); }
        route = choice.route;
        updateUsage();
        ctx.ui.notify(choice.save ? `Codex route: ${ROUTES[route]} (saved as default)` :
          `Codex route: ${ROUTES[route]} (this session)`, "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : "Could not select a Codex route.", "warning");
      }
    },
  });

  pi.events.on("codex-host:web-search:v1", (event) => {
    const call = event as { query: string; model?: string; numResults?: number; recencyFilter?: string;
      domainFilter?: string[]; signal?: AbortSignal;
      reply: (result: Promise<{ answer: string; results: unknown[] }>) => void };
    if (typeof call?.reply !== "function") return;
    call.reply((async () => {
      const version = sessionVersion;
      const selected = route ?? automaticRoute((await discover(call.signal)).routes);
      if (!selected) throw new Error("Codex search route unavailable. Use /codex-route or log in on the host.");
      const timeout = AbortSignal.timeout(65_000);
      const signal = call.signal ? AbortSignal.any([call.signal, timeout]) : timeout;
      let res: IncomingMessage;
      try {
        res = await connect(socket, "/v1/search", signal, { route: selected, query: call.query, model: call.model,
          numResults: call.numResults, recencyFilter: call.recencyFilter, domainFilter: call.domainFilter });
      } catch {
        call.signal?.throwIfAborted();
        throw new Error(timeout.aborted ? "Host Codex search timed out." : "Host Codex search socket unavailable.");
      }
      const result = await readJson<{ account?: Account; answer: string; results: unknown[]; error?: string }>(res);
      if (res.statusCode !== 200) throw new Error(result.error ?? "Host Codex search failed.");
      if (selected === "auto" && version === sessionVersion && (result.account === "work" || result.account === "personal")) {
        autoAccount = result.account;
        updateUsage();
      }
      return { answer: result.answer, results: result.results };
    })());
  });

  const run = (model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) =>
    lazyStream(model, async () => {
      const version = sessionVersion;
      const fastRequested = fast;
      const selectedRoute = route;
      const available = await discover(options?.signal);
      const selected = selectedRoute ?? automaticRoute(available.routes);
      if (!selected || !available.routes.includes(selected)) {
        throw new Error("Codex route unavailable. Use /codex-route or log in on the host.");
      }
      const data = {
        model: model.id, route: selected, messages: context.messages,
        reasoning: options?.reasoning, sessionId: options?.sessionId, maxTokens: options?.maxTokens,
      };
      const payload = await options?.onPayload?.(data, model);
      if (payload !== undefined && (!payload || typeof payload !== "object" || Array.isArray(payload))) {
        throw new Error("Codex broker payload must be an object.");
      }
      const res = await connect(socket, "/v1/chat", options?.signal, {
        ...(payload ?? data), route: selected, model: model.id, fast: fastRequested,
      });
      try {
        // These are only the broker's response headers, never upstream auth or headers.
        await options?.onResponse?.({ status: res.statusCode ?? 0, headers: {} }, model);
        if (res.statusCode !== 200) {
          throw new Error((await readJson<{ error: string }>(res)).error);
        }
      } catch (error) {
        res.destroy();
        throw error;
      }
      return (async function* () {
        let pending = "";
        res.setEncoding("utf8");
        try {
          for await (const chunk of res) {
            pending += chunk;
            const lines = pending.split("\n");
            pending = lines.pop()!;
            for (const line of lines) {
              const event = JSON.parse(line) as AssistantMessageEvent | { type: "codex-account"; account: Account };
              if (event.type === "codex-account") {
                if (selected === "auto" && version === sessionVersion) {
                  autoAccount = event.account;
                  updateUsage();
                }
                continue;
              }
              const message = event.type === "done" ? event.message : event.type === "error" ? event.error : event.partial;
              message.provider = ID;
              yield event;
              if (event.type === "done" || event.type === "error") return;
            }
          }
          throw new Error("Codex broker stream ended before completion.");
        } finally {
          res.destroy();
        }
      })();
    }, undefined, options?.signal);

  const modelsFor = (list?: Catalog) => list?.models.map((model) => ({ ...model, provider: ID, baseUrl: BASE })) ?? [];
  let models = modelsFor(initial);
  const configured = async (signal?: AbortSignal) =>
    (await discover(signal).catch(() => undefined))?.routes.length;
  const provider: Provider = {
    id: ID, name: "Codex (host)", baseUrl: BASE,
    auth: { apiKey: {
      name: "Host Codex login",
      check: async ({ signal }) => await configured(signal)
        ? { type: "api_key", source: "Host Codex login" } : undefined,
      resolve: async ({ signal }) => await configured(signal)
        ? { auth: AUTH, source: "Host Codex login" } : undefined,
    } },
    getModels: () => models,
    async refreshModels(context) {
      const result = await discover(context.signal, context.force, context.allowNetwork);
      const fresh = modelsFor(result);
      await context.publish({ update: () => { models = fresh; } });
      if (result.warning && context.allowNetwork) throw new Error(result.warning);
    },
    stream: run, streamSimple: run,
  };
  pi.registerProvider(provider);
}
