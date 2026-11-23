---
name: grill-me
description: Stress-test a plan, design, or decision through Matt Pocock's grilling workflow in Pi's asynchronous browser review inbox. Use when the user says "grill me" or asks for asynchronous design grilling, not for an ordinary review.
---

# Grill me

Fetch [Matt Pocock's grill-me skill](https://raw.githubusercontent.com/mattpocock/skills/main/skills/productivity/grill-me/SKILL.md) and its delegated [grilling skill](https://raw.githubusercontent.com/mattpocock/skills/main/skills/productivity/grilling/SKILL.md). Follow the latter directly in Pi rather than invoking a separate Skill tool.

Unless the user asks to stay in chat, keep the entire interview in the asynchronous review inbox. Post the first round with `review_request`. After each reply, use `review_update` on the same card for every subsequent round; don't switch to chat for follow-up questions. Put the whole round in the Markdown body, with numbered questions and your recommended answer for each. Omit card-level options for question rounds so the user can answer each question in free text.

Once all decisions are settled, use `review_update` again on the same card to summarize the agreed plan and request explicit final approval. Don't treat answers to earlier questions as approval or start implementation before the user approves.

Share the inbox URL after each round, including the approval request, then end the turn or continue independent fact-finding. Don't poll; replies arrive as steering messages. If the inbox tools are unavailable, tell the user and offer to continue in chat.
