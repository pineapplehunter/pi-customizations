import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ID, type Route } from "./route.js";

export type Account = "personal" | "work";
type Window = { label: string; remaining: number; minutes?: number; resetsAt?: number };
type Usage = { windows: Window[]; plan?: string; resetCount?: number; credits?: number | string };
type ResetOption = { key: string; title: string; description?: string; expiresAt?: number };
type BrokerCall = <T>(path: string, data: object, signal?: AbortSignal) => Promise<T>;
const title = { personal: "Personal", work: "Work" };

function duration(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes / 60) % 24;
  const rest = minutes % 60;
  return [days && `${days}d`, hours && `${hours}h`, rest && `${rest}m`].filter(Boolean).join(" ") || "0m";
}

function windowText(window: Window, compact = false): string {
  const reset = (window.resetsAt ?? 0) - Date.now();
  const countdown = reset > 0 ? ` ↻ ${duration(Math.ceil(reset / 60_000))}` : "";
  const period = window.minutes === 10_080 ? (compact ? "wk" : "weekly") :
    window.minutes === undefined ? "limit" : duration(window.minutes);
  return `${period} ${window.remaining.toFixed(0)}% left${countdown}`;
}

function statusWindows(windows: Window[], model: ExtensionContext["model"]): Window[] {
  const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const labels = [...new Set(windows.map(({ label }) => label))];
  const keys = model ? [model.id, model.name].map(normalize).filter(Boolean) : [];
  const variants = keys.flatMap((key) => key.match(/(?:^|-)codex-(.+)$/)?.slice(1) ?? []);
  const extras = labels.filter((label) => label !== "Codex");
  const exact = extras.filter((label) => keys.includes(normalize(label)));
  const related = extras.filter((label) => variants.some((variant) => `-${normalize(label)}-`.includes(`-${variant}-`)));
  const preferred = exact.length === 1 ? exact[0] : related.length === 1 ? related[0] :
    labels.includes("Codex") ? "Codex" : labels.length === 1 ? labels[0] : undefined;
  return windows.filter(({ label }) => label === preferred);
}

export function installUsage(pi: ExtensionAPI, call: BrokerCall,
  routeFor: () => Route | undefined, autoAccount: () => Account | undefined, fastEnabled: () => boolean) {
  let ctx: ExtensionContext | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let pending: { account: Account; controller: AbortController } | undefined;
  const samples = new Map<Account, { usage: Usage; at: number }>();
  const selectedRoute = (context?: ExtensionContext) => context?.model?.provider === ID ? routeFor() : undefined;
  const active = (context = ctx) => {
    const route = selectedRoute(context);
    return route === "auto" ? autoAccount() : route;
  };
  function paint() {
    if (!ctx || ctx.mode !== "tui") return;
    const account = active();
    const fast = fastEnabled() ? " · Fast on" : "";
    const usage = account && samples.get(account)?.usage;
    const windows = statusWindows(usage?.windows ?? [], ctx.model);
    const limits = windows.map((w) => windowText(w, true)).join(" · ");
    const detail = limits ? `${windows[0].label === "Codex" ? "" : `${windows[0].label} · `}${limits}` :
      usage?.credits !== undefined ? `Credits: ${usage.credits}` : "";
    ctx.ui.setStatus("codex-host-usage", !selectedRoute(ctx) ? undefined : !account ? `Codex Auto${fast} · awaiting first request` :
      `Codex ${title[account]}${fast}${detail ? ` · ${detail}` : ""}`);
  }
  function update() {
    paint();
    const account = ctx?.mode === "tui" ? active() : undefined;
    if (pending && pending.account !== account) {
      pending.controller.abort();
      pending = undefined;
    }
    if (!account || pending) return;
    const sample = samples.get(account);
    if (sample && Date.now() - sample.at < 5 * 60_000) return;
    const current = { account, controller: new AbortController() };
    pending = current;
    void call<Usage>("/v1/usage", { account }, current.controller.signal).then((usage) => {
      if (pending === current) samples.set(account, { usage, at: Date.now() });
    }).catch(() => {}).finally(() => {
      if (pending === current) {
        pending = undefined;
        paint();
      }
    });
  }
  pi.on("session_start", (_, context) => {
    ctx = context;
    update();
    timer = setInterval(update, 60_000);
    timer.unref?.();
  });
  pi.on("model_select", (_, context) => { ctx = context; update(); });
  pi.on("session_shutdown", () => {
    clearInterval(timer);
    pending?.controller.abort();
    pending = undefined;
    samples.clear();
    ctx?.ui.setStatus("codex-host-usage", undefined);
    ctx = undefined;
  });

  pi.registerCommand("usage", {
    description: "Show usage and reset credits for the active host Codex account",
    handler: async (_, context) => {
      if (!selectedRoute(context)) return context.ui.notify("Select a host Codex model to see usage.", "info");
      const account = active(context);
      if (!account) return context.ui.notify("Auto has not used an account yet. Send a prompt or choose Personal or Work in /codex-route.", "info");
      try {
        while (true) {
          const usage = await call<Usage>("/v1/usage", { account });
          if (active() === account) {
            if (pending?.account === account) {
              pending.controller.abort();
              pending = undefined;
            }
            samples.set(account, { usage, at: Date.now() });
            paint();
          }
          const lines = [`Codex ${title[account]}${usage.plan ? ` (${usage.plan})` : ""} · ChatGPT subscription limits`,
            ...usage.windows.map((w) => `${w.label}: ${windowText(w)}`),
            ...(usage.credits === undefined ? [] : [`Credits: ${usage.credits}`]),
            `Reset credits: ${usage.resetCount ?? "check availability"}`];
          if (!context.hasUI) return context.ui.notify(lines.join("\n"), "info");
          const choice = await context.ui.select(lines.join("\n"), ["Refresh", "Check reset credits", "Close"]);
          if (choice === "Refresh") continue;
          if (choice !== "Check reset credits") return;
          const { count, options } = await call<{ count: number; options: ResetOption[] }>("/v1/reset-options", { account });
          if (!options.length) {
            context.ui.notify(count ? "No selectable reset credits." : "No reset credits available.", "info");
            continue;
          }
          const labels = options.map((option, index) => `${index + 1}. ${option.title}${option.expiresAt ? ` (expires ${new Date(option.expiresAt).toLocaleString()})` : ""}`);
          const selected = await context.ui.select(`Reset credits: ${title[account]} (${count})`, labels);
          const option = options[labels.indexOf(selected ?? "")];
          if (!option) continue;
          const confirmed = await context.ui.confirm(`Redeem one reset credit for ${title[account]}?`,
            [selected, option.description, "This consumes one earned reset credit."].filter(Boolean).join("\n"));
          if (!confirmed) continue;
          const { code } = await call<{ code: string }>("/v1/reset", { account, key: option.key });
          const outcomes: Record<string, string> = { reset: "Usage reset.", already_redeemed: "Credit was already redeemed.",
            nothing_to_reset: "There is nothing to reset.", no_credit: "No reset credit was available." };
          context.ui.notify(`${title[account]}: ${outcomes[code] ?? "Unknown reset outcome."}`, "info");
        }
      } catch (error) {
        context.ui.notify(error instanceof Error ? error.message : "Codex usage unavailable.", "warning");
      }
    },
  });
  return update;
}
