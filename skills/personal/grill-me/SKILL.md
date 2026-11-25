---
name: grill-me
description: Stress-test a plan, design, or decision through Matt Pocock's grilling workflow in Pi's asynchronous browser review inbox. Use when the user says "grill me" or asks for asynchronous design grilling, not for an ordinary review.
---

# Grill me

Fetch [Matt Pocock's grill-me skill](https://raw.githubusercontent.com/mattpocock/skills/main/skills/productivity/grill-me/SKILL.md) and its delegated [grilling skill](https://raw.githubusercontent.com/mattpocock/skills/main/skills/productivity/grilling/SKILL.md). Follow the latter directly in Pi rather than invoking a separate Skill tool.

Unless the user asks to stay in chat, keep the entire interview in the asynchronous review inbox. In each round, post **one new `review_request` per question**. Each card contains exactly one numbered question and its recommended answer. Do not bundle questions on a card or repurpose an answered card for a different question. Omit card-level options so replies can be free text. Wait for the round’s answers before posting the next round.

Once all decisions are settled, post a separate approval card with `review_request` that summarizes the agreed plan and requests explicit final approval. Don't treat answers to earlier questions as approval or start implementation before the user approves.

Share the inbox URL after each round, including the approval request, then end the turn or continue independent fact-finding. Don't poll; replies arrive as steering messages. If the inbox tools are unavailable, tell the user and offer to continue in chat.
