# Pi customizations

Personal [Pi](https://pi.dev) extensions, skills, shared instructions, and external
package declarations. Resources are a conventional Pi package: `extensions/`
and complete `skills/` directories are discovered without generated manifests.
Nix is optional for using the resources; the starter flake is only a dev shell.

Skills are grouped by provenance:

- `skills/personal/` — personal skills maintained here.
- `skills/anthropic/` — vendored Anthropic skills tracked in `upstream.json`.

Pi discovers both groups recursively; skill names and `/skill:<name>` commands
are unchanged. `pi-update` copies the entire `skills/` tree, so no updater change
is needed. Path-based package filters referencing the old `skills/<name>/` paths
must be updated to include the group.

## Personal update workflow (NixOS)

`pi-update` is implemented and installed by
[nixos-config](https://github.com/pineapplehunter/nixos-config/tree/main/home/pi-coding-agent),
not this repository. After the one-time Home Manager/NixOS rebuild:

```sh
pi-update --local /absolute/path/to/pi-customizations
# After committing/pushing this repository to GitHub:
pi-update
```

Both commands **copy** resources into `~/.pi/customizations/package/` and update
all configured global Pi packages, including external and manually installed
packages. `--local` uses even uncommitted source changes, never edits/fetches your
checkout, and does not leave Pi loading directly from it. Plain `pi-update`
shallow-clones `https://github.com/pineapplehunter/pi-customizations`, branch
`main`. Override with `--repo URL`, `--branch NAME`, or `PI_CUSTOMIZATIONS_REPO`
and `PI_CUSTOMIZATIONS_BRANCH`. Local mode still requires network access for
external package updates. Neither command updates the Pi executable itself.

Run `/reload` or restart Pi after updating; restart when host infrastructure
changes. Edit this source repository, not installed copies: the next update
replaces the whole managed snapshot, removing obsolete managed resources.
The previous snapshot is retained at `~/.pi/customizations/previous/` until the
next installation; this is not automatic rollback.

The updater merges package entries and copies `AGENTS.md`. It preserves other
settings and unrelated packages. Manual filters/version overrides are preserved;
entries it owns are tracked in `~/.pi/customizations/managed-packages.json`.
Existing `pi`, `pi-work`, and `pi-auto` profiles share the snapshot; linked settings
are updated once, independent settings individually. Existing profile-specific
instructions remain untouched. Authentication, sessions, model preferences,
keybindings, trust, and host MCP settings are not copied or managed here.

Invalid sources or clone failures leave the installed snapshot alone. An external
package failure exits nonzero but leaves the new snapshot/settings installed;
external package updates are not transactional. Correct the problem and rerun.
Do not edit settings concurrently with an update. The updater only removes
obsolete files in its own snapshot, never arbitrary user skill directories.

## Use with ordinary Pi (Ubuntu and other systems)

With a current Pi and Node.js 22.18 or newer:

```sh
pi install git:github.com/pineapplehunter/pi-customizations@main
# Or try a checkout for one invocation:
pi -e /absolute/path/to/pi-customizations
```

Those are native Pi operations and may load a Git/local package directly; only
`pi-update` implements the personal copy-based workflow. `pi install` loads the
extensions and skills, **not** the updater-specific `settings.json` or shared
`AGENTS.md`. To adopt those too, install the sources listed in `settings.json`
with `pi install <source>` and merge the instructions into your agent directory.
Native Git updates use `pi update --extensions`.

Portable resources work without Nix. Nix Bash/Search register only when their
executables exist; `/open-file` requires the separate host chooser;
`/subagents` requires the host launcher and profile environment. Pueue delivery
requires the private daemon/notification environment. Codex Auto activates only
in the wrapper's `auto` profile. Host sandbox, Pueue, clipboard, portal, MCP,
subagent launcher/runner, and separate-account wrappers remain Nix-managed;
installing this package does not provide them or guarantee sandboxing.
See [Codex Auto](extensions/codex-auto/README.md) for account routing and
[Pueue](extensions/pueue-tool/DESIGN.md) for completion delivery/log browsing.

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
node --test tests/*.test.mjs
```

`references/SUBAGENTS.md` documents the separate host integration; the authoritative
runtime sources remain in nixos-config. The design in `extensions/pueue-tool/`
also describes the host-side requirements.

## Licenses and upstream refreshes

Personal contributions are GPL-3.0-only. See `CREDITS.md`, `NOTICE`, `upstream.json`,
and the original licenses kept with vendored skills and font assets.
`doc-coauthoring` is intentionally omitted pending clear license permission.

To refresh Anthropic skills, fetch the desired revision of `anthropics/skills`,
review each selected directory's license (and nested assets), replace only the
directories under `skills/anthropic/` listed in `upstream.json`, and update its
revision and credits in the same commit. `pi-update` installs the repository's
reviewed copies; it does not silently refresh vendored upstream work.
