import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import type { WebSocket as ReviewSocket } from "ws";
import type { ReviewStore } from "./store.ts";

const requirePackage = createRequire(import.meta.url);

export type CloseReason = "complete" | "resolved" | "cleared" | "shutdown";
const assets = {
  "": ["index.html", "text/html; charset=utf-8"],
  "app.js": ["app.js", "text/javascript; charset=utf-8"],
} as const;

export async function startReviewServer(store: ReviewStore, onReply: () => void, onClose: (port: number, reason: CloseReason) => void) {
  const MarkdownIt = requirePackage("markdown-it");
  const { WebSocket, WebSocketServer } = requirePackage("ws");
  const markdown = new MarkdownIt({ html: false }).disable("image");
  const savedPort = store.port;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, closeTimeout: 1_000 });
  const localHost = (host?: string) => /^(?:127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/.test(host ?? "");
  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self' https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.3.5/dist/index.global.js; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (req.method !== "GET" || !localHost(req.headers.host) || !req.url?.startsWith("/")) {
      res.writeHead(404).end();
      return;
    }
    const path = req.url.slice(1);
    try {
      if (Object.hasOwn(assets, path)) {
        const [filename, mime] = assets[path as keyof typeof assets];
        const data = readFileSync(new URL(`./web/${filename}`, import.meta.url));
        res.writeHead(200, { "Content-Type": mime }).end(data);
        return;
      }
      if (path.startsWith("image/")) {
        const image = store.image(path.slice(6));
        if (image) {
          res.writeHead(200, { "Content-Type": image.mime }).end(image.data);
          return;
        }
      }
      res.writeHead(404).end();
    } catch {
      res.writeHead(500).end();
    }
  });

  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/socket" || !localHost(req.headers.host) || req.headers.origin !== `http://${req.headers.host}`) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws));
  });

  const snapshot = () => JSON.stringify({
    type: "state",
    inboxId: store.id,
    cards: store.cards.map(card => ({
      ...card, rounds: card.rounds.map(({ body, options, replies }) => ({
        html: markdown.render(body), options, replies: replies.map(({ processed: _, ...reply }) => reply),
      })),
    })),
  });
  const publish = () => {
    const state = snapshot();
    for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(state);
  };
  let stopped = false;
  const stop = (reason: CloseReason) => {
    if (stopped) return;
    stopped = true;
    server.close();
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: "closed", reason }));
      client.close();
    }
    wss.close();
    onClose(port, reason);
  };

  wss.on("connection", (ws: ReviewSocket) => {
    ws.on("error", () => {});
    ws.send(snapshot());
    ws.on("message", data => {
      if (stopped) return;
      try {
        const message = JSON.parse(data.toString());
        if (message?.type !== "reply" || typeof message.cardId !== "string") throw new Error("Invalid reply.");
        store.reply(message.cardId, message.round, message.text, message.choice, message.comment);
        ws.send(JSON.stringify({ type: "saved", cardId: message.cardId }));
      } catch (error) {
        ws.send(JSON.stringify({ type: "error", message: (error as Error).message }));
        return;
      }
      publish();
      onReply();
      if (!store.pending) stop(store.hasRetractions ? "resolved" : "complete");
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(savedPort ?? 0, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (savedPort && (error as NodeJS.ErrnoException).code === "EADDRINUSE") {
      throw new Error(`Review inbox port ${savedPort} is in use. Free that port and try again.`);
    }
    throw error;
  }
  const { port } = server.address() as AddressInfo;
  if (savedPort === undefined) {
    try { store.rememberPort(port); }
    catch (error) { server.close(); throw error; }
  }
  return { port, url: `http://localhost:${port}`, publish, stop };
}

export type ReviewServer = Awaited<ReturnType<typeof startReviewServer>>;
