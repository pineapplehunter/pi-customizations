import { createHash, randomUUID } from "node:crypto";
import {
  closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync,
  readFileSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

export type Reply = { id: string; text: string; choice?: string; comment?: true; processed?: boolean };
type Image = { id: string; alt: string; mime: string };
type Round = { body: string; options: string[]; replies: Reply[] };
export type Card = { id: string; title: string; images: Image[]; rounds: Round[]; retracted?: true };
type LegacyCard = Omit<Card, "rounds"> & Round;
type Request = { title: string; body: string; options?: string[]; images?: { path: string; alt: string }[] };
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

function newRound(body: string, choices: string[] = []): Round {
  const options = choices.map(choice => choice.trim());
  if (options.some(option => !option) || new Set(options).size !== options.length) {
    throw new Error("Provide distinct, nonblank options.");
  }
  return { body, options, replies: [] };
}

function readImage(path: string) {
  const file = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = fstatSync(file);
    if (!info.isFile() || info.size > 8 * 1024 * 1024) throw new Error("Use a regular image file up to 8 MiB.");
    const data = readFileSync(file);
    const mime = data.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" ? "image/png"
      : data.subarray(0, 3).toString("hex") === "ffd8ff" ? "image/jpeg"
      : data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : undefined;
    if (!mime) throw new Error("Attachments must be PNG, JPEG, or WebP.");
    return { data, mime };
  } finally {
    closeSync(file);
  }
}

export class ReviewStore {
  readonly id: string;
  readonly directory: string;
  cards: Card[] = [];

  constructor(session: string, root = `/tmp/pi-review-${process.getuid?.() ?? "user"}`) {
    try { mkdirSync(root, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const info = lstatSync(root);
    if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) {
      throw new Error(`Not a private review storage directory: ${root}`);
    }
    this.id = createHash("sha256").update(session).digest("hex");
    this.directory = join(root, this.id);
    try {
      const saved: (Card | LegacyCard)[] = JSON.parse(readFileSync(join(this.directory, "cards.json"), "utf8"));
      this.cards = saved.map(card => {
        if ("rounds" in card) return card;
        const { body, options, replies, ...rest } = card;
        return { ...rest, rounds: [{ body, options, replies }] };
      });
    } catch (error) { if (!isMissing(error)) throw error; }
  }

  get pending() { return this.cards.some(card => !card.retracted && card.rounds.at(-1)!.replies.length === 0); }
  get hasRetractions() { return this.cards.some(card => card.retracted); }

  get port() {
    try {
      const port = Number(readFileSync(`${this.directory}.port`, "utf8"));
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid saved review inbox port.");
      return port;
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  rememberPort(port: number) {
    // Clearing cards must not invalidate the address of an open browser tab.
    writeFileSync(`${this.directory}.port`, String(port), { flag: "wx", mode: 0o600 });
  }

  private save(cards: Card[]) {
    const temp = join(this.directory, `${randomUUID()}.tmp`);
    try {
      writeFileSync(temp, JSON.stringify(cards), { flag: "wx", mode: 0o600 });
      renameSync(temp, join(this.directory, "cards.json"));
    } finally {
      rmSync(temp, { force: true });
    }
    this.cards = cards;
  }

  post(request: Request, cwd: string) {
    const title = request.title.trim();
    if (!title) throw new Error("Provide a title.");
    const round = newRound(request.body, request.options);
    const attachments = (request.images ?? []).map(({ path, alt }) => {
      const { data, mime } = readImage(resolve(cwd, path));
      return { data, image: { id: randomUUID(), alt, mime } };
    });
    const card: Card = { id: randomUUID(), title, images: attachments.map(a => a.image), rounds: [round] };
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    try {
      for (const { data, image } of attachments) {
        writeFileSync(join(this.directory, image.id), data, { flag: "wx", mode: 0o600 });
      }
      this.save([...this.cards, card]);
    } catch (error) {
      for (const { image } of attachments) rmSync(join(this.directory, image.id), { force: true });
      throw error;
    }
    return card;
  }

  update(cardId: string, body: string, options?: string[]) {
    const card = this.cards.find(card => card.id === cardId);
    if (!card) throw new Error("That card is no longer in the inbox.");
    if (card.retracted) throw new Error("This card was retracted. Post a new card to ask for another answer.");
    if (!body.trim()) throw new Error("Provide a follow-up question or context.");
    const updated = { ...card, rounds: [...card.rounds, newRound(body, options)] };
    this.save(this.cards.map(item => item === card ? updated : item));
    return updated;
  }

  retract(cardId: string) {
    const card = this.cards.find(card => card.id === cardId);
    if (!card) throw new Error("That card is no longer in the inbox.");
    if (card.retracted) return false;
    this.save(this.cards.map(item => item === card ? { ...card, retracted: true } : item));
    return true;
  }

  reply(cardId: string, roundNumber: unknown, input: unknown, index?: unknown, comment?: unknown) {
    const card = this.cards.find(card => card.id === cardId);
    if (!card) throw new Error("That card is no longer in the inbox.");
    if (roundNumber !== card.rounds.length) throw new Error("This round changed. Reply to the latest round.");
    const round = card.rounds.at(-1)!;
    if (card.retracted && (comment !== true || index !== undefined)) {
      throw new Error("This card was retracted. You can still add a text comment.");
    }
    if (typeof input !== "string" || input.length > 12_000) throw new Error("Use at most 12,000 characters.");
    const text = input.trim();
    let choice: string | undefined;
    if (index !== undefined) {
      if (round.replies.length) throw new Error("This round already has an answer. Add a comment instead.");
      if (typeof index !== "number" || !Number.isInteger(index) || !round.options[index]) throw new Error("Choose a listed option.");
      choice = round.options[index];
    }
    if (!text && choice === undefined) throw new Error("Enter a reply or choose an option.");
    const reply: Reply = { id: randomUUID(), text, choice, comment: card.retracted };
    const rounds = [...card.rounds.slice(0, -1), { ...round, replies: [...round.replies, reply] }];
    this.save(this.cards.map(item => item === card ? { ...card, rounds } : item));
  }

  markProcessed(ids: Set<string>) {
    if (!this.cards.some(card => card.rounds.some(round => round.replies.some(reply => !reply.processed && ids.has(reply.id))))) return;
    this.save(this.cards.map(card => ({ ...card, rounds: card.rounds.map(round => ({
      ...round, replies: round.replies.map(reply => ids.has(reply.id) ? { ...reply, processed: true } : reply),
    })) })));
  }

  image(id: string) {
    const image = this.cards.flatMap(card => card.images).find(image => image.id === id);
    if (!image) return;
    return { mime: image.mime, data: readFileSync(join(this.directory, image.id)) };
  }

  clear() {
    rmSync(this.directory, { recursive: true, force: true });
    this.cards = [];
  }
}
