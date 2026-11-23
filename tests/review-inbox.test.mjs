import assert from "node:assert/strict";
import { once, on } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startReviewServer } from "../extensions/review-inbox/server.ts";
import { ReviewStore } from "../extensions/review-inbox/store.ts";
import WebSocket from "ws";

test("saved replies update the inbox and the last answer closes the listener", { timeout: 5_000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "pi-review-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new ReviewStore("session", root);
  const a = store.post({ title: "Change A", body: "**Review this.**", options: ["Approve", "Request changes"] }, ".");
  const b = store.post({ title: "Change B", body: "Another item" }, ".");
  let notifications = 0;
  const closures = [];
  const server = await startReviewServer(store, () => notifications++, (port, reason) => closures.push({ port, reason }));
  assert.equal(server.url, `http://localhost:${server.port}`);
  t.after(() => server.stop("shutdown"));
  assert.equal((await fetch(server.url)).status, 200);
  assert.equal((await fetch(new URL("/not-a-route", server.url))).status, 404);
  const socket = new WebSocket(new URL("socket", server.url), { origin: new URL(server.url).origin });
  const messages = on(socket, "message");
  t.after(() => socket.terminate());
  const next = async () => JSON.parse((await messages.next()).value[0]);
  const state = await next();
  assert.equal(state.inboxId, store.id);
  assert.match(state.cards[0].rounds[0].html, /<strong>Review this\.<\/strong>/);

  const reply = async (cardId, text, choice, round = 1) => {
    socket.send(JSON.stringify({ type: "reply", cardId, round, text, choice }));
    assert.deepEqual(await next(), { type: "saved", cardId });
    return (await next()).cards;
  };
  assert.equal((await reply(a.id, "Looks good", 0))[0].rounds[0].replies[0].choice, "Approve");
  assert.equal((await reply(a.id, "One more note"))[0].rounds[0].replies.length, 2);
  store.update(a.id, "Could you confirm the scope?");
  server.publish();
  const updated = (await next()).cards[0];
  assert.equal(updated.rounds.length, 2);
  assert.deepEqual(updated.rounds[1].options, []);
  assert.equal(updated.rounds[0].replies.length, 2);
  socket.send(JSON.stringify({ type: "reply", cardId: a.id, round: 1, text: "Stale tab" }));
  assert.equal((await next()).type, "error");
  await reply(b.id, "Ship it");
  const closed = once(socket, "close");
  await reply(a.id, "Confirmed", undefined, 2);
  assert.deepEqual(await next(), { type: "closed", reason: "complete" });
  await closed;
  await assert.rejects(fetch(server.url));
  assert.equal(notifications, 4);
  server.stop("shutdown");
  assert.deepEqual(closures, [{ port: server.port, reason: "complete" }]);
  assert.equal(new ReviewStore("other-session", root).cards.length, 0);
  const reopened = new ReviewStore("session", root);
  assert.equal(reopened.pending, false);
  assert.equal(reopened.cards[0].rounds[0].replies[1].text, "One more note");
  assert.equal(reopened.cards[0].rounds[1].replies[0].text, "Confirmed");
  await messages.return();

  reopened.clear();
  const nextStore = new ReviewStore("session", root);
  assert.equal(nextStore.cards.length, 0);
  nextStore.post({ title: "Next round", body: "Another review" }, ".");
  const restarted = await startReviewServer(nextStore, () => {}, () => {});
  t.after(() => restarted.stop("shutdown"));
  assert.equal(restarted.url, server.url);
  const client = new WebSocket(new URL("socket", server.url), { origin: new URL(server.url).origin });
  t.after(() => client.terminate());
  const reconnected = JSON.parse((await once(client, "message"))[0]);
  assert.equal(reconnected.inboxId, state.inboxId);
  assert.equal(reconnected.cards[0].title, "Next round");
});

test("retraction retains answers and accepts comments without counting them as answers", t => {
  const root = mkdtempSync(join(tmpdir(), "pi-review-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new ReviewStore("session", root);
  const answered = store.post({ title: "Answered", body: "" }, ".");
  const pending = store.post({ title: "Pending", body: "", options: ["Yes"] }, ".");
  store.reply(answered.id, 1, "Original answer");
  assert.equal(store.retract(answered.id), true);
  assert.equal(store.retract(answered.id), false);
  assert.equal(store.pending, true);
  store.retract(pending.id);
  assert.equal(store.pending, false);
  assert.throws(() => store.update(pending.id, "New request"), /was retracted/);
  assert.throws(() => store.reply(pending.id, 1, "Stale answer"), /was retracted/);
  assert.throws(() => store.reply(pending.id, 1, "", 0, true), /was retracted/);
  store.reply(pending.id, 1, "A comment", undefined, true);
  const saved = new ReviewStore("session", root);
  assert.equal(saved.pending, false);
  assert.ok(saved.cards.every(card => card.retracted));
  assert.equal(saved.cards[0].rounds[0].replies[0].text, "Original answer");
  assert.equal(saved.cards[0].rounds[0].replies[0].comment, undefined);
  assert.equal(saved.cards[1].rounds[0].replies[0].text, "A comment");
  assert.equal(saved.cards[1].rounds[0].replies[0].comment, true);
});

test("legacy cards become round one and unanswered rounds can be superseded", t => {
  const root = mkdtempSync(join(tmpdir(), "pi-review-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { directory } = new ReviewStore("session", root);
  mkdirSync(directory);
  writeFileSync(join(directory, "cards.json"), JSON.stringify([{
    id: "old", title: "Legacy", body: "Original", options: ["Old option"], images: [],
    replies: [{ id: "reply", choice: "Old option", text: "Original reply", processed: true }],
  }]));
  const store = new ReviewStore("session", root);
  assert.equal(store.pending, false);
  store.update("old", "Second question", ["New option"]);
  store.update("old", "Third question");
  const [first, second, third] = store.cards[0].rounds;
  assert.equal(first.replies[0].processed, true);
  assert.equal(first.replies[0].choice, "Old option");
  assert.deepEqual(second.options, ["New option"]);
  assert.deepEqual(second.replies, []);
  assert.deepEqual(third.options, []);
  assert.equal(store.pending, true);
  assert.throws(() => store.reply("old", 2, "", 0), /round changed/);
  store.reply("old", 3, "Third answer");
  assert.equal(store.pending, false);
});
