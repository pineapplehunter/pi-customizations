import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

export const ID = "codex-host";
export const ROUTES = { auto: "Auto", work: "Work", personal: "Personal" } as const;
export type Route = keyof typeof ROUTES;
export const isRoute = (value: unknown): value is Route => typeof value === "string" && Object.hasOwn(ROUTES, value);

export function sessionRoute(ctx: ExtensionContext): Route | undefined {
  for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
    if (entry.type === "custom" && entry.customType === "codex-route" && isRoute(entry.data)) return entry.data;
    if (entry.type === "model_change" && entry.provider.startsWith(`${ID}-`)) {
      const route = entry.provider.slice(ID.length + 1);
      if (isRoute(route)) return route;
    }
  }
}

const defaultPath = () => join(getAgentDir(), "codex-route-default");

export async function readRouteDefault(): Promise<Route | undefined> {
  try {
    const value = (await readFile(defaultPath(), "utf8")).trim();
    if (isRoute(value)) return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function saveRouteDefault(route: Route): Promise<void> {
  const path = defaultPath();
  const temp = `${path}.${randomUUID()}`;
  try {
    await writeFile(temp, `${route}\n`, { mode: 0o600, flag: "wx" });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}

export function chooseRoute(ctx: ExtensionContext, choices: Route[], current?: Route, saved?: Route) {
  type Choice = { route: Route; save: boolean };
  return ctx.ui.custom<Choice | undefined>((tui, theme, keys, done) => {
    let index = Math.max(0, current === undefined ? 0 : choices.indexOf(current));
    const hint = (key: "tui.select.confirm" | "app.models.save" | "tui.select.cancel", label: string) => {
      const binding = keys.getKeys(key)[0];
      return binding && `${binding === "enter" ? "Enter" : binding} ${label}`;
    };
    return {
      render(width) {
        return [
          theme.fg("accent", "Codex route"),
          ...choices.map((route, i) => {
            const tags = [route === current && "current", route === saved && "default"].filter(Boolean);
            const line = `${i === index ? "› " : "  "}${ROUTES[route]}${tags.length ? ` (${tags.join(", ")})` : ""}`;
            return theme.fg(i === index ? "accent" : "text", line);
          }),
          theme.fg("dim", [hint("tui.select.confirm", "select"), hint("app.models.save", "set as default"),
            hint("tui.select.cancel", "cancel")].filter(Boolean).join(" · ")),
        ].map((line) => truncateToWidth(line, width));
      },
      invalidate() {},
      handleInput(data) {
        if (keys.matches(data, "app.models.save")) return done({ route: choices[index], save: true });
        if (keys.matches(data, "tui.select.confirm")) return done({ route: choices[index], save: false });
        if (keys.matches(data, "tui.select.cancel")) return done(undefined);
        if (keys.matches(data, "tui.select.up")) index = (index + choices.length - 1) % choices.length;
        else if (keys.matches(data, "tui.select.down")) index = (index + 1) % choices.length;
        else return;
        tui.requestRender();
      },
    };
  }, { blocked: { kind: "question", message: "Choose a Codex route" } });
}
