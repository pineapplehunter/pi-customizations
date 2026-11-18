# Credits and provenance

## Personal customizations

The personal extensions, skills, and subagent reference documentation originated
in [Shogo Takata's nixos-config](https://github.com/pineapplehunter/nixos-config),
under `home/pi-coding-agent/pineapplehunter`, at revision
`927c2b6d3e71f5928804b2a9da57abaec5941038`.

Shogo Takata authorized releasing his contributions here under Apache-2.0.
This does not change the license of the original nixos-config repository or
third-party work. The migration changes resource paths, makes host-specific
integrations optional, and ports selected dependency-free skill helpers to
TypeScript. Subsequent local changes are recorded in Git.

## Anthropic skills

The eleven vendored skill directories listed in `upstream.json` were copied
unmodified from [anthropics/skills](https://github.com/anthropics/skills), revision
`1780c5e5a552fd4d1c9d6a7b0cab26b0c2bef064` (the previous Nix flake pin).
Credit: Anthropic, PBC, and the contributors to that repository.

Each selected skill has an Apache-2.0 `LICENSE.txt`, retained alongside all
scripts, references, and assets. Fonts in `skills/canvas-design/canvas-fonts/`
retain their separate SIL Open Font License notices and author credits. Those
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

`settings.json` declares separately installed third-party packages, credited to
their respective authors:

- `@narumitw/pi-usage`
- `pi-web-access`
- `pi-codex-image-gen`
- `pi-compact-tools`
- [monotykamary/pi-double-esc](https://github.com/monotykamary/pi-double-esc)
- [pineapplehunter/pi-remote-server](https://github.com/pineapplehunter/pi-remote-server)

Those packages retain their own licenses; this repository's license does not
relicense them or any runtime dependencies installed by their package managers.
