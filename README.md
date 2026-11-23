# Pi customizations

Personal [Pi](https://pi.dev) extensions, skills, shared instructions, and external
package declarations. `package.json` declares the extensions and skill roots,
including the independently publishable `extensions/pueue-tool/` package.
Nix is optional for using the resources; the starter flake is only a dev shell.

Skills are grouped by provenance:

- `skills/personal/` — personal skills maintained here.
- `skills/anthropic/` — vendored Anthropic skills tracked in `upstream.json`.

Pi discovers both groups recursively. The Pueue skill lives with its standalone
package at `extensions/pueue-tool/skills/pueue/`. Skill names and `/skill:<name>`
commands are unchanged. `pi-update` installs both complete trees. Path-based
package filters referencing the old `skills/<name>/` paths must be updated to
include the group.

## Personal update workflow (NixOS)

`pi-update` is implemented and installed by
[nixos-config](https://github.com/pineapplehunter/nixos-config/tree/main/home/pi-coding-agent),
not this repository. After the one-time Home Manager/NixOS rebuild:

```sh
pi-update --local /absolute/path/to/pi-customizations
# After committing/pushing this repository to GitHub:
pi-update
```

Both modes hand a local npm tarball to `pi install`, so Pi installs the resources
and their dependencies. `--local` includes uncommitted edits without modifying
or fetching the checkout. Plain `pi-update` shallow-clones
`https://github.com/pineapplehunter/pi-customizations` at `main`; override it with
`--repo URL`, `--branch NAME`, `PI_CUSTOMIZATIONS_REPO`, or
`PI_CUSTOMIZATIONS_BRANCH`. Neither mode publishes the tarball or updates Pi itself.

The package is installed under `~/.pi/agent/npm/node_modules/pi-customizations`.
The active tarball and external package ownership state live in
`~/.pi/agent/pi-update/`. After a successful migration, the updater removes the
old copied snapshots and their settings entry. It leaves unrelated files alone.

The updater merges external package entries, copies `AGENTS.md`, and refreshes
global packages. It preserves unrelated settings, auth, and sessions. Package
updates are not transactional; an external update failure can leave the new
customizations installed. Fix the error and rerun. Restart Pi after updating.

## Use with ordinary Pi (Ubuntu and other systems)

With a current Pi and Node.js 22.18 or newer:

```sh
pi install git:github.com/pineapplehunter/pi-customizations@main
# Or install runtime dependencies and try a checkout for one invocation:
cd /absolute/path/to/pi-customizations
npm ci --omit=dev --legacy-peer-deps --ignore-scripts
pi -e .
```

Those are native Pi operations and may load a Git/local package directly; only
`pi-update` implements the personal workflow above. `pi install` loads the
extensions and skills, **not** the updater-specific `settings.json` or shared
`AGENTS.md`. To adopt those too, install the sources listed in `settings.json`
with `pi install <source>` and merge the instructions into your agent directory.
Native Git updates use `pi update --extensions`.

Portable resources work without Nix. Nix Bash/Search register only when their
executables exist; `/open-file` requires the separate host chooser;
`/subagents` requires the host launcher and `PI_CODING_AGENT_DIR`. Pueue requires
`pueue` and `pueued` on PATH; its standalone extension now initializes its own
private daemon/config/callback on Linux and macOS. The `codex-host` provider
requires the Nix-managed host broker. Use `/codex-route` to select Personal,
Work, or Auto. Installing this package does not provide the sandbox, brokers,
or subagent launcher.
See [brokered web tools](extensions/codex-host/web/README.md) for web setup and
[Pueue](extensions/pueue-tool/README.md) for independent installation and
completion delivery/log browsing. The private
[subagent adapter](extensions/subagent-pueue/README.md) is not part of that package.
See [Review inbox](extensions/review-inbox/README.md) for asynchronous browser Q&A,
SSH forwarding, and the setup and development instructions.

The TODO directory/status and skill initializer helpers use dependency-free
TypeScript, directly runnable with `node scripts/<helper>.ts`. The skill YAML
validator still requires Python 3 and PyYAML. Individual vendored skills have
their own optional runtime/tool requirements; install those only when needed.

## Editing and checks

Add extensions under `extensions/` or full personal skills (scripts/assets
included) under `skills/personal/`. Keep reviewed Anthropic copies under
`skills/anthropic/`. Edit external package sources in `settings.json`. Adding
other managed Pi settings requires an explicit updater change rather than
overwriting users' preferences. Project-specific NixOS skills remain in nixos-config's `.pi/skills`.

```sh
npm install --legacy-peer-deps
npm test
```

`references/SUBAGENTS.md` documents the separate host integration; the authoritative
runtime sources remain in nixos-config. The design in `extensions/pueue-tool/`
also describes the host-side requirements.

## Licenses and upstream refreshes

Personal contributions are GPL-3.0-only. The [upstream inventory](CREDITS.md#patched-tools-and-compatibility-references)
records the original projects, pinned releases, and upgrade instructions for
patched tools and compatibility references. See also `NOTICE`, `upstream.json`,
and the original licenses kept with vendored skills and font assets.
`doc-coauthoring` is intentionally omitted pending clear license permission.

To refresh Anthropic skills, fetch the desired revision of `anthropics/skills`,
review each selected directory's license (and nested assets), replace only the
directories under `skills/anthropic/` listed in `upstream.json`, and update its
revision and credits in the same commit. `pi-update` installs the repository's
reviewed copies; it does not silently refresh vendored upstream work.
