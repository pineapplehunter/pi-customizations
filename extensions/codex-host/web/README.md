# Brokered search for `pi-web-access` 0.48.0

**Upstream:** Nico Bailon's [`nicobailon/pi-web-access`](https://github.com/nicobailon/pi-web-access)
(MIT). The patch base is the [published npm 0.48.0 tarball](https://registry.npmjs.org/pi-web-access/-/pi-web-access-0.48.0.tgz),
not a build from upstream `main`. See [Upgrading the upstream package](#upgrading-the-upstream-package).

`web_search` and `source_check` use the host Codex account when the active Pi
model belongs to `codex-host`. To opt into the broker even with a different
active model, set `"openaiSearchProviders": ["codex-host"]` in `web-search.json`.
In both cases the existing `openai` search provider slot uses the broker, not
an OpenAI API key. Explicit independent search providers, allowlists, and
configured search routing retain their existing meaning. An unconfigured
`auto` prefers the broker when selected; a broker failure is an error, not a
retry against paid OpenAI. The standalone MCP build is unchanged.

The request follows `/codex-route` (including Auto’s Personal reserve). The host
chooses a model from its public Codex catalog; a supplied `model` or
`openaiSearchModel` must match that catalog. `searchRouting.useCurrentModel`
can select the active Codex model. The broker handles only hosted Responses
`web_search`, not alpha/search or custom OpenAI endpoints. Recency is a prompt
preference; include/exclude filters apply to returned citation URLs, not a
guarantee about every link in the provider's answer. Citation snippets are
labeled as generated, not quotations from the page.

The existing curator, storage, page fetching and GitHub `gh` shim remain
separate. With a `codex-host` model active, default summaries use it (or the
deterministic fallback if unavailable); an explicit `summaryModel` still
wins. `fetch_content` answer mode continues to use the active model by default;
for a pinned answer mode set `fetch.answerProvider` to `codex-host` and
`fetch.answerModel` to its model ID. Model-backed helpers use the Pi registry
and normal chat transport rather than the search endpoint.

## Activate from a host terminal

1. After review, apply the NixOS/Home Manager change containing `codex_search.mjs`
   and the broker wiring. Start `pi-codex-host.socket` if not active, restart
   `pi-codex-host.service` if running an old build, and make sure the desired
   host account is configured. Update `pi-customizations` normally.
2. Install the exact public npm release into a **dedicated**, sandbox-visible
   prefix. Do not patch the Pi-managed npm copy or Nix store. From the
   customizations checkout, with Node (22.19+) and GNU patch:

   ```sh
   prefix="$HOME/.pi/web-access-codex-0.48.0"
   npm install --prefix "$prefix" --save-exact --ignore-scripts --omit=peer --no-audit --no-fund pi-web-access@0.48.0
   node extensions/codex-host/web/apply.mjs "$prefix/node_modules/pi-web-access"
   ```

   The installer verifies the version and hashes of the published and patched
   bundle and may be run again safely. No upstream or npm tree is vendored.
3. In canonical `~/.pi/agent/settings.json`, replace the original `pi-web-access`
   npm entry in `packages` with an entry disabling its extensions, then add
   the patched **absolute** path. Keep all other entries. For example:

   ```json
   { "source": "npm:pi-web-access", "extensions": [] },
   "/home/your-user/.pi/web-access-codex-0.48.0/node_modules/pi-web-access"
   ```

   Disabling rather than deleting the npm declaration avoids `pi-update`
   re-enabling it. Disable any extra declaration of that original extension in
   project settings too. Restart plain `pi`, select a `codex-host` model, and
   set `/codex-route` as desired. `openai` remains the search-provider name in
   tool parameters and results. If needed, remove a stale `openaiSearchModel`
   or other old search preference so the new configuration can take effect.

To roll back, remove the local package entry, restore the npm entry's original
filters, remove any explicit `codex-host` search provider setting, and restart
Pi. No account login changes are needed.

## Upgrading the upstream package

1. Read upstream's [changelog](https://github.com/nicobailon/pi-web-access/blob/main/CHANGELOG.md)
   and unpack the exact candidate npm release in a temporary directory. Keep an
   untouched copy of `dist/index.js`; this is the file loaded by Pi, not the
   standalone MCP bundle.
2. Port [the current patch](pi-web-access-0.48.0.patch) to a copy of that bundle.
   Check hosted OpenAI provider selection, the `codex-host:web-search:v1` event
   bridge, and default summary model selection. Keep independent providers
   working and do not let a failed broker request fall back to paid OpenAI.
3. Generate a unified diff with `a/dist/index.js` and `b/dist/index.js` headers.
   Name it for the new version and update `version`, `original`, and `patched`
   in [`apply.mjs`](apply.mjs), using SHA-256 hashes of the untouched and patched
   bundles. Update the activation example and [credits](../../../CREDITS.md).
   Keep the upstream [MIT license](LICENSE).
4. Apply the regenerated patch to a fresh install in a new versioned prefix.
   Run the tests below, then switch the configured package path. Do not upgrade
   the active prefix in place. When the release changes GitHub fetches, also
   check the [host shim's upstream contract](https://github.com/pineapplehunter/nixos-config/blob/main/home/pi-coding-agent/UPSTREAM.md#github-fetch-shim).

## Offline coverage

Run `node --test nixos-config/home/pi-coding-agent/pineapplehunter/wrapper/codex_search.test.mjs`
in the combined workspace for the mocked broker and public SSE shape. For a
full extension wiring check using the prepared npm prefix, run:

```sh
PI_WEB_TEST_PACKAGE="$prefix/node_modules/pi-web-access" \
PI_WEB_TEST_SDK="/path/to/pi-monorepo/dist" \
  node --test extensions/codex-host/web/integration.test.mjs
```

This uses a temporary config/cache, mock registry, mock fetch, and mock Unix
socket. Neither test calls an account or spends quota.
