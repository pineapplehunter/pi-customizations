# Credits and provenance

## Personal customizations

The personal extensions, skills, and subagent reference documentation originated
in [Shogo Takata's nixos-config](https://github.com/pineapplehunter/nixos-config),
under `home/pi-coding-agent/pineapplehunter`, at revision
`927c2b6d3e71f5928804b2a9da57abaec5941038`.

Personal contributions are licensed under GPL-3.0-only. Third-party material
retains its original licenses and notices, as described below.

## Anthropic skills

The eleven vendored skill directories under `skills/anthropic/`, listed in
`upstream.json`, were copied unmodified from
[anthropics/skills](https://github.com/anthropics/skills), revision
`1780c5e5a552fd4d1c9d6a7b0cab26b0c2bef064` (the previous Nix flake pin).
Credit: Anthropic, PBC, and the contributors to that repository.

Each selected skill has an Apache-2.0 `LICENSE.txt`, retained alongside all
scripts, references, and assets. Fonts in
`skills/anthropic/canvas-design/canvas-fonts/` retain their separate SIL Open Font
License notices and author credits. Those
font licenses are not replaced by this repository's Apache license.

`doc-coauthoring` was previously selected by Nix but is deliberately not vendored:
that revision contains no skill-local license, and its general README does not
unambiguously identify that skill's license. Add it only after verifying explicit
permissive redistribution permission.

Upstream refreshes are explicit repository changes, not part of `pi-update`.
Review licenses again when changing the upstream revision; preserve all notices
and record modifications to upstream files.

## Pi and external packages

The extensions use the [Pi coding agent](https://github.com/earendil-works/pi),
created by Mario Zechner and maintained by its contributors. Pi is installed
separately and is not vendored here.

### Patched tools and compatibility references

| Tool | Upstream and baseline | Local code and update guide |
| --- | --- | --- |
| Web search, source checks, and page helpers | Nico Bailon's [pi-web-access](https://github.com/nicobailon/pi-web-access), [npm 0.48.0](https://www.npmjs.com/package/pi-web-access/v/0.48.0), MIT | We patch the published Pi extension bundle. See the [patch and upgrade procedure](extensions/codex-host/web/README.md#upgrading-the-upstream-package). |
| Image generation and editing | Jose Mocito's [pi-codex-image-gen](https://github.com/jvm/pi-mono/tree/main/packages/pi-codex-image-gen), [npm 0.3.2](https://www.npmjs.com/package/pi-codex-image-gen/v/0.3.2), Apache-2.0 | Nix fetches and patches the published package. The [host maintenance guide](https://github.com/pineapplehunter/nixos-config/blob/main/home/pi-coding-agent/UPSTREAM.md#codex-image-generation) describes the pins, patch, and broker code. |
| Codex `/usage`, reset credits, and Fast capability checks | [@narumitw/pi-usage](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-usage), [npm 0.69.3](https://www.npmjs.com/package/@narumitw/pi-usage/v/0.69.3), MIT | This package is a compatibility reference, not an installed fork. See [local usage UI](extensions/codex-host/usage.ts) and the [host maintenance guide](https://github.com/pineapplehunter/nixos-config/blob/main/home/pi-coding-agent/UPSTREAM.md#usage-reset-credits-and-fast-mode) for upstream files to compare. |

The host Codex broker and GitHub shim live in
[`nixos-config/home/pi-coding-agent`](https://github.com/pineapplehunter/nixos-config/tree/main/home/pi-coding-agent).
They are local integrations, not forks of the Pi SDK or the GitHub CLI.

### Separately installed packages

`settings.json` also declares unmodified third-party packages:

- `pi-web-access` (stock declaration; disabled when using the patched copy)
- `pi-compact-tools`
- [monotykamary/pi-double-esc](https://github.com/monotykamary/pi-double-esc)
- [pineapplehunter/pi-remote-server](https://github.com/pineapplehunter/pi-remote-server)

Those packages retain their own licenses; this repository's license does not
relicense them or any runtime dependencies installed by their package managers.
