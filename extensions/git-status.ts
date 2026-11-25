import { homedir } from "node:os";
import { isAbsolute, relative, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const STATUS_ARGS = [
	"--no-optional-locks", "--no-lazy-fetch", "status",
	"--porcelain=v2", "--branch", "--ahead-behind", "--untracked-files=normal", "--renames",
];

function formatStatus(stdout: string): string {
	const counts = { "=": 0, "+": 0, "!": 0, "»": 0, "✘": 0, "?": 0, "⇡": 0, "⇣": 0 };
	for (const line of stdout.split("\n")) {
		if (line.startsWith("1 ") || line.startsWith("2 ")) {
			// Porcelain v2 quotes paths with newlines, so only the record prefix matters.
			const index = line[2];
			const worktree = line[3];
			if (index !== ".") counts["+"]++;
			if (worktree !== "." && worktree !== "R" && worktree !== "D") counts["!"]++;
			if (index === "R" || worktree === "R") counts["»"]++;
			if (index === "D" || worktree === "D") counts["✘"]++;
		} else if (line.startsWith("u ")) {
			counts["="]++;
		} else if (line.startsWith("? ")) {
			counts["?"]++;
		} else if (line.startsWith("# branch.ab ")) {
			const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line);
			if (match) {
				counts["⇡"] = Number(match[1]);
				counts["⇣"] = Number(match[2]);
			}
		}
	}
	return Object.entries(counts).flatMap(([symbol, count]) => count ? [`${symbol}${count}`] : []).join(" ");
}

function tokens(count: number): string {
	if (count < 1_000) return String(count);
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}

function usageText(ctx: ExtensionContext): string {
	let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, cost = 0;
	for (const entry of ctx.sessionManager.getEntries()) {
		const usage = entry.type === "usage" || entry.type === "compaction" || entry.type === "branch_summary"
			? entry.usage
			: entry.type === "message" && (entry.message.role === "assistant" || entry.message.role === "toolResult")
				? entry.message.usage : undefined;
		if (!usage) continue;
		input += usage.input;
		output += usage.output;
		cacheRead += usage.cacheRead;
		cacheWrite += usage.cacheWrite;
		cost += usage.cost.total;
	}
	return [input && `↑${tokens(input)}`, output && `↓${tokens(output)}`, cacheRead && `R${tokens(cacheRead)}`,
		cacheWrite && `W${tokens(cacheWrite)}`, cost && `$${cost.toFixed(3)}`].filter(Boolean).join(" ");
}

function installFooter(ctx: ExtensionContext, getStatus: () => string, stop: () => void) {
	const fromHome = relative(homedir(), ctx.cwd);
	const cwd = !fromHome ? "~" : isAbsolute(fromHome) || fromHome === ".." || fromHome.startsWith(`..${sep}`)
		? ctx.cwd : `~${sep}${fromHome}`;
	let requestRender: (() => void) | undefined;
	ctx.ui.setFooter((tui, theme, data) => {
		let stats: { leaf: string | null; model: typeof ctx.model; left: string } | undefined;
		requestRender = () => tui.requestRender();
		const unsubscribe = data.onBranchChange(requestRender);
		return {
			invalidate() { stats = undefined; },
			dispose() {
				unsubscribe();
				requestRender = undefined;
				stop();
			},
			render(width) {
				const branch = data.getGitBranch();
				const status = getStatus();
				const name = ctx.sessionManager.getSessionName();
				const branchText = branch ? ` (${[branch, status].filter(Boolean).join(" ")})` : "";
				const path = cwd + branchText + (name ? ` • ${name}` : "");

				const leaf = ctx.sessionManager.getLeafId();
				const model = ctx.model;
				if (!stats || stats.leaf !== leaf || stats.model !== model) {
					const usage = usageText(ctx);
					const context = ctx.getContextUsage();
					const percent = context?.percent?.toFixed(1);
					const used = percent === undefined ? "?" : `${percent}%`;
					const window = tokens(context?.contextWindow ?? model?.contextWindow ?? 0);
					stats = { leaf, model, left: [usage, `${used}/${window}`].filter(Boolean).join(" ") };
				}
				const thinking = ctx.thinkingLevel ?? "off";
				const modelText = (model?.id ?? "no-model") + (model?.reasoning ? ` • ${thinking === "off" ? "thinking off" : thinking}` : "");
				const provider = model && data.getAvailableProviderCount() > 1 ? `(${model.provider}) ` : "";
				const leftWidth = visibleWidth(stats.left);
				const space = width - leftWidth - 2;
				const label = visibleWidth(provider + modelText) <= space ? provider + modelText : modelText;
				const right = space > 0 ? truncateToWidth(label, space, "") : "";
				const second = stats.left + (right ? " ".repeat(width - leftWidth - visibleWidth(right)) + right : "");
				const lines = [truncateToWidth(theme.fg("dim", path), width), truncateToWidth(theme.fg("dim", second), width)];
				const statuses = [...data.getExtensionStatuses()].sort(([a], [b]) => a.localeCompare(b))
					.map(([, text]) => text.replace(/[\r\n\t ]+/g, " ").trim());
				if (statuses.length) lines.push(truncateToWidth(statuses.join(" "), width));
				return lines;
			},
		};
	});
	return () => requestRender?.();
}

export default function (pi: ExtensionAPI) {
	let refresh: (() => Promise<void>) | undefined;
	let stop: (() => void) | undefined;

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		const controller = new AbortController();
		const { signal } = controller;
		let running = false;
		let retryAt = 0;
		let displayed = "";

		async function check() {
			if (signal.aborted || running || performance.now() < retryAt) return;
			running = true;
			let status = "";
			try {
				const result = await pi.exec("git", STATUS_ARGS, {
					cwd: ctx.cwd, signal, timeout: 1_000, maxBuffer: 1024 * 1024,
				});
				if (result.killed || result.truncated) retryAt = performance.now() + 60_000;
				else if (result.code === 0) status = formatStatus(result.stdout);
			} catch {
				// Git is unavailable; leave the footer empty.
			} finally {
				running = false;
			}
			if (!signal.aborted && status !== displayed) {
				displayed = status;
				redraw();
			}
		}

		refresh = check;
		const timer = setInterval(() => void check(), 10_000);
		timer.unref();
		stop = () => {
			clearInterval(timer);
			controller.abort();
		};
		const redraw = installFooter(ctx, () => displayed, stop);
		void check();
	});

	pi.on("turn_end", () => { void refresh?.(); });
	pi.on("session_shutdown", () => {
		stop?.();
		stop = refresh = undefined;
	});
}
