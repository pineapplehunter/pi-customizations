// Optional offline integration with a prepared npm prefix and a local Pi SDK.
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire, registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const prefix = process.env.PI_WEB_TEST_PACKAGE;
const sdk = process.env.PI_WEB_TEST_SDK;

test("installed extension routes web_search, source_check, and summary without paid fallback", { skip: !prefix || !sdk }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-tools-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [key, value] of Object.entries({ HOME: dir, PI_CODING_AGENT_DIR: dir,
    XDG_CONFIG_HOME: dir, XDG_CACHE_HOME: dir, XDG_DATA_HOME: dir, PI_WEB_ACCESS_CACHE_ROOT: dir, PI_OFFLINE: "1" })) {
    process.env[key] = value;
  }
  const config = join(dir, "web-search.json");
  await writeFile(config, JSON.stringify({ openaiApiKey: "fixture-openai-key", braveApiKey: "fixture-brave-key" }));
  const model = { id: "gpt-6-luna", provider: "codex-host", api: "openai-codex-responses", input: ["text"], contextWindow: 100_000 };
  const calls = [];
  let fail = false;
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/v1/catalog") return res.end(JSON.stringify({ routes: ["work", "personal", "auto"], models: [model] }));
    assert.equal(req.url, "/v1/search");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    calls.push(JSON.parse(Buffer.concat(chunks)));
    if (fail) { res.statusCode = 403; return res.end(JSON.stringify({ error: "Mock broker denial" })); }
    res.end(JSON.stringify({ account: "work", answer: "Public example answer.", results: [
      { title: "Pi docs", url: "https://docs.example.org/manual", snippet: "Generated evidence.", snippetSource: "generated" },
    ] }));
  }).listen(join(dir, "broker.sock"));
  await once(server, "listening");
  t.after(() => new Promise((done) => server.close(done)));
  process.env.PI_CODEX_HOST_SOCKET = join(dir, "broker.sock");
  const sdkEntry = resolve(sdk, "index.js");
  const requireFromPi = createRequire(sdkEntry);
  const hooks = registerHooks({ resolve(specifier, ctx, next) {
    if (specifier === "@earendil-works/pi-coding-agent") return { url: pathToFileURL(sdkEntry).href, shortCircuit: true };
    if (specifier.startsWith("@earendil-works/") || specifier === "typebox") {
      return next(specifier, { ...ctx, parentURL: pathToFileURL(sdkEntry).href });
    }
    // Match Pi's TypeScript resolution for the codex-host extension's local imports.
    if (ctx.parentURL?.includes("/extensions/codex-host/") && /^\.\/[^/]+\.js$/.test(specifier)) {
      return next(specifier.replace(/\.js$/, ".ts"), ctx);
    }
    return next(specifier, ctx);
  } });
  t.after(() => hooks.deregister());
  assert.ok(requireFromPi.resolve("typebox"));
  const registered = new Map();
  const commands = new Map();
  const events = new EventEmitter();
  const pi = {
    events, registerTool: (tool) => registered.set(tool.name, tool), registerProvider() {},
    registerCommand: (name, spec) => commands.set(name, spec), registerShortcut() {}, on() {}, appendEntry() {}, sendMessage() {},
  };
  const fetchCalls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    fetchCalls.push(String(url));
    if (String(url).startsWith("https://api.search.brave.com/")) return Response.json({ web: { results: [
      { title: "Independent result", url: "https://example.org/independent", description: "Independent source" },
    ] } });
    if (String(url) === "https://api.openai.com/v1/responses") return Response.json({ output: [
      { type: "web_search_call", sources: [{ title: "Standalone source", url: "https://example.org/standalone" }] },
    ] });
    throw new Error("Unexpected external network call");
  });
  const { default: installHost } = await import("../index.ts");
  await installHost(pi);
  const bundle = pathToFileURL(resolve(prefix, "dist/index.js"));
  (await import(bundle.href)).default(pi);
  const summaries = [];
  const ctx = { hasUI: false, mode: "print", model, scopedModels: [], ui: { notify() {} },
    sessionManager: { getSessionId: () => "mock", getBranch: () => [] },
    modelRegistry: { getAvailable: () => [model], find: (provider, id) => provider === model.provider && id === model.id ? model : undefined,
      getApiKeyAndHeaders: async (requested) => ({ ok: requested.provider === "codex-host", apiKey: "fixture-sentinel" }),
      streamSimple: (requested) => {
        summaries.push(requested.provider);
        return { result: async () => ({ stopReason: "stop", content: [{ type: "text", text: "Mock model summary." }] }) };
      },
    },
  };
  await commands.get("codex-route").handler("work", ctx);
  const execute = (name, params, context = ctx) => registered.get(name).execute("mock-call", params, undefined, undefined, context);
  const web = await execute("web_search", { query: "Public docs", domainFilter: ["docs.example.org"], recencyFilter: "week" });
  assert.match(JSON.stringify(web), /docs\.example\.org\/manual/);
  const check = await execute("source_check", { claim: "Example claim" });
  assert.equal(check.details.artifact.passages[0].origin, "provider_summary");
  assert.equal(check.details.artifact.sources[0].url, "https://docs.example.org/manual");
  assert.deepEqual(calls.map((call) => call.route), ["work", "work"]);
  assert.deepEqual(calls[0].domainFilter, ["docs.example.org"]);
  assert.equal(calls[0].recencyFilter, "week");
  const summary = await execute("web_search", { query: "Summarize", workflow: "auto-summary" });
  assert.match(JSON.stringify(summary), /Mock model summary/);
  assert.deepEqual(summaries, ["codex-host"]);
  fail = true;
  assert.match(JSON.stringify(await execute("web_search", { query: "Denied" })), /Mock broker denial/);
  assert.deepEqual(fetchCalls, []);
  const independent = await execute("web_search", { query: "Independent", provider: "brave" });
  assert.match(JSON.stringify(independent), /Independent result/);
  assert.equal(fetchCalls.length, 1);
  assert.ok(registered.has("fetch_content")); // The existing GitHub/fetch implementation is not replaced.
  const independentCtx = { ...ctx, model: { provider: "other" }, modelRegistry: { ...ctx.modelRegistry, getAll: () => [] } };
  const standard = await execute("web_search", { query: "Standard OpenAI", provider: "openai" }, independentCtx);
  assert.match(JSON.stringify(standard), /Standalone source/);
  assert.equal(fetchCalls.length, 2);

  await writeFile(config, JSON.stringify({ openaiSearchProviders: ["codex-host", "openai"], openaiApiKey: "fixture-openai-key" }));
  (await import(`${bundle.href}?explicit-config`)).default(pi);
  const configured = await execute("source_check", { claim: "Configured broker" }, independentCtx);
  assert.match(JSON.stringify(configured), /Mock broker denial/);
  events.removeAllListeners("codex-host:web-search:v1");
  assert.match(JSON.stringify(await execute("web_search", { query: "Missing broker" }, independentCtx)), /Host Codex search unavailable/);
  assert.equal(fetchCalls.length, 2);
});
