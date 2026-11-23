---
name: modern-web-guidance
description: Consult Chrome's Modern Web Guidance before creating or updating any web-related content, including sites, web apps, UI, HTML/CSS, client-side JavaScript, and examples or docs about browser features. Use it for current platform patterns, accessibility, performance, and browser compatibility.
---

# Modern Web Guidance

Fetch and read the [official upstream skill](https://raw.githubusercontent.com/GoogleChrome/modern-web-guidance/main/skills/modern-web-guidance/SKILL.md). See [Chrome's Modern Web Guidance overview](https://developer.chrome.com/docs/modern-web-guidance?hl=ja) for context.

Follow the upstream search-and-retrieve workflow before choosing web platform APIs or patterns: search by user-visible capability, retrieve the relevant guides, and apply their browser support and fallback advice against the project's targets. No skill installation is needed.

Assume Bun is not on `PATH`. Use a temporary Nix shell by default, and pass `--bun` so the CLI runs with Bun rather than Node:

```sh
nix shell nixpkgs#bun -c env DISABLE_TELEMETRY=1 bunx --bun modern-web-guidance@latest search "responsive data table"
nix shell nixpkgs#bun -c env DISABLE_TELEMETRY=1 bunx --bun modern-web-guidance@latest retrieve responsive-table
```

If Nix is unavailable but `bunx` is already on `PATH`, run the commands starting at `env`. Otherwise, use the upstream `npx` commands with `DISABLE_TELEMETRY=1`. If the CLI is unavailable, consult the [published guides](https://github.com/GoogleChrome/modern-web-guidance/tree/main/skills/modern-web-guidance/guides) directly.
