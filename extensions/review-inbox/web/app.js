const $ = id => document.getElementById(id);
const status = $("status");
const error = $("error");
const groups = { pending: $("pending"), answered: $("answered") };
const views = new Map();
let socket;
let synced = false;
let closed = false;
let sending;
let inboxId;
let retryDelay = 500;

const theme = $("theme");
const colorScheme = document.querySelector('meta[name="color-scheme"]');
theme.value = colorScheme.content;
theme.addEventListener("change", () => { colorScheme.content = theme.value; });
$("theme-control").hidden = false;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function showError(message = "") {
  error.textContent = message;
  error.hidden = !message;
}

function controls() {
  for (const { form, done, textarea, choices } of views.values()) {
    form.hidden = closed;
    done.disabled = !synced || !!sending;
    textarea.disabled = !synced;
    choices.disabled = !synced;
  }
}

function createCard(card) {
  const node = element("details", undefined, "review-card");
  const summary = element("summary", card.title);
  const marker = element("span", "Retracted", "ms-2 text-sm text-muted");
  marker.hidden = true;
  summary.append(marker);
  const body = element("div", undefined, "border-t border-rule p-4");
  const roundNumber = card.rounds.length;
  const replies = card.rounds.map((round, index) => {
    const section = element("section", undefined, index ? "mt-4 border-t border-rule pt-4" : "");
    const superseded = index < roundNumber - 1 && !round.replies.length;
    section.append(element("h3", `Round ${index + 1}${superseded ? " · Superseded" : ""}`, "mb-2 text-sm font-semibold text-muted"));
    const context = element("div", undefined, "context");
    context.innerHTML = round.html; // Server renders Markdown with raw HTML and remote images disabled.
    section.append(context);
    if (index === 0) for (const image of card.images) {
      const figure = element("figure", undefined, "my-4");
      const img = element("img", undefined, "h-auto max-w-full");
      img.src = `image/${encodeURIComponent(image.id)}`;
      img.alt = image.alt;
      img.loading = "lazy";
      figure.append(img);
      if (image.alt) figure.append(element("figcaption", image.alt, "mt-1 text-sm text-muted"));
      section.append(figure);
    }
    if (index < roundNumber - 1 && round.options.length) {
      section.append(element("p", `Choices: ${round.options.join(" · ")}`, "mt-2 text-sm text-muted wrap-anywhere"));
    }
    const log = element("div", undefined, "not-empty:mt-4 not-empty:border-t not-empty:border-rule not-empty:pt-3");
    section.append(log);
    body.append(section);
    return log;
  });
  const form = element("form", undefined, "mt-4");
  const choices = element("fieldset", undefined, "mb-3 flex flex-wrap gap-2");
  choices.append(element("legend", "Choose an option or write your own", "mb-1 text-sm font-semibold"));
  const buttons = card.rounds.at(-1).options.map(option => {
    const button = element("button", option, "review-control");
    button.type = "button";
    button.setAttribute("aria-pressed", "false");
    button.onclick = () => {
      const select = button.getAttribute("aria-pressed") === "false";
      for (const item of buttons) item.setAttribute("aria-pressed", String(select && item === button));
    };
    choices.append(button);
    return button;
  });
  const label = element("label", undefined, "text-sm font-semibold");
  label.htmlFor = `reply-${card.id}`;
  const textarea = element("textarea", undefined, "mt-1 mb-3 block w-full resize-y rounded-sm border border-rule bg-ground p-2 disabled:opacity-60");
  textarea.id = label.htmlFor;
  textarea.rows = 3;
  textarea.maxLength = 12_000;
  const done = element("button", "Done", "review-control review-submit");
  done.type = "submit";
  form.append(choices, label, textarea, done);
  form.onsubmit = event => {
    event.preventDefault();
    if (sending || !synced || closed || socket.readyState !== WebSocket.OPEN) return;
    const choice = choices.hidden ? -1 : buttons.findIndex(button => button.getAttribute("aria-pressed") === "true");
    if (choice < 0 && !textarea.value.trim()) {
      showError("Enter a reply or choose an option.");
      textarea.focus();
      return;
    }
    showError();
    sending = card.id;
    controls();
    socket.send(JSON.stringify({ type: "reply", cardId: card.id, round: roundNumber, text: textarea.value,
      choice: choice < 0 ? undefined : choice, comment: !marker.hidden }));
  };
  body.lastElementChild.append(form);
  node.append(summary, body);
  return { node, marker, replies, form, label, buttons, choices, textarea, done, roundNumber };
}

function render(cards) {
  const ids = new Set(cards.map(card => card.id));
  for (const [id, view] of views) {
    if (!ids.has(id)) { view.node.remove(); views.delete(id); }
  }
  const next = { pending: [], answered: [] };
  for (const card of cards) {
    let view = views.get(card.id);
    if (view?.roundNumber !== card.rounds.length) {
      const nextView = createCard(card);
      if (view) {
        nextView.node.open = view.node.open;
        view.node.remove();
      }
      view = nextView;
      views.set(card.id, view);
    }
    const latest = card.rounds.at(-1);
    const resolved = card.retracted || latest.replies.length > 0;
    view.marker.hidden = !card.retracted;
    view.choices.hidden = resolved || !latest.options.length;
    view.label.textContent = resolved ? "Add a comment" : "Your reply";
    card.rounds.forEach((round, roundIndex) => view.replies[roundIndex].replaceChildren(...round.replies.map((reply, index) => {
      const block = element("div", undefined, "mb-3 wrap-anywhere whitespace-pre-wrap");
      block.append(element("strong", reply.comment ? "Comment" : index === 0 ? "Answer" : "Follow-up", "text-sm text-muted"));
      if (reply.choice !== undefined) block.append(element("p", reply.choice));
      if (reply.text) block.append(element("p", reply.text));
      return block;
    })));
    next[resolved ? "answered" : "pending"].push(view.node);
  }
  for (const group of Object.keys(groups)) {
    const container = groups[group];
    const nodes = next[group];
    nodes.forEach((node, index) => {
      if (container.children[index] !== node) container.insertBefore(node, container.children[index] ?? null);
    });
    container.parentElement.hidden = nodes.length === 0;
    $(`${group}-count`).textContent = nodes.length;
  }
  const count = next.pending.length;
  status.textContent = count === 1 ? "1 card needs your response." : count ? `${count} cards need your response.` : "No unanswered cards.";
  controls();
}

function connect() {
  socket = new WebSocket(new URL("socket", location.href).href.replace(/^http:/, "ws:"));
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    switch (message.type) {
      case "state":
        if (inboxId !== undefined && message.inboxId !== inboxId) {
          socket.close();
          return;
        }
        inboxId = message.inboxId;
        retryDelay = 500;
        closed = false;
        synced = true;
        render(message.cards);
        break;
      case "saved": {
        const view = views.get(message.cardId);
        view?.form.reset();
        for (const button of view?.buttons ?? []) button.setAttribute("aria-pressed", "false");
        sending = undefined;
        controls();
        break;
      }
      case "error":
        sending = undefined;
        showError(message.message);
        controls();
        break;
      case "closed":
        closed = true;
        synced = false;
        showError();
        status.textContent = message.reason === "complete" ? "All cards answered. Continue in the Pi prompt."
          : message.reason === "resolved" ? "No cards need a response. Continue in the Pi prompt."
          : message.reason === "cleared" ? "The review inbox was cleared."
          : "The review server stopped. This tab will reconnect when it reopens.";
        controls();
        break;
    }
  };
  socket.onclose = () => {
    if (sending) showError("Connection lost before confirmation. Check the card before sending again.");
    sending = undefined;
    synced = false;
    if (!closed) status.textContent = "Disconnected. Reconnecting…";
    controls();
    setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 5000);
  };
}

connect();
