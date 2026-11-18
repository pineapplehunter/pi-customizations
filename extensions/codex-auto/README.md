# Codex Auto

The extension activates only with `PI_WRAPPER_PROFILE=auto`, normally supplied
by the separate Nix-managed `pi-auto` wrapper. Ordinary `pi` and `pi-work` do
not register the provider or `/codex-auto-usage` command.

`pi-auto` uses `~/.pi/agent-auto` and separate `auth.json`, sharing configuration
and resources with the personal profile like `pi-work`. Its normal provider
registry does not inherit personal or work logins. Select a mirrored model with
`/model` or start, for example:

```sh
pi-auto --model codex-auto/gpt-6.1-sol
```

Log in to `openai-codex` separately using `pi` (personal) and `pi-work` (work).
Codex Auto explicitly accesses `~/.pi/agent/auth.json` and
`~/.pi/agent-work/auth.json` using Pi's locked OAuth refresh; it does not
duplicate credentials. These files remain accessible to Pi/extensions inside
the sandbox, so this separates default logins, not security privileges.

It uses personal while more than 15% of its five-hour allowance remains, then
work. Usage samples are cached for up to five minutes; personal is selected again
after reset. Quota reports and the reserve are best effort: long requests,
sampling, delayed accounting, and concurrent sessions can cross the limit.
If personal usage cannot be checked, work is used instead. If work is unavailable,
the request fails rather than spending the personal reserve.

The status line displays both accounts and reset countdowns, highlighting the
account used for the latest request. Usage refreshes every five minutes while
visible; countdowns repaint every minute. Routing fetches a new sample when the
cache expires or a reset passes.

`/codex-auto-usage` reports details and absolute reset times;
`/codex-auto-usage refresh` refreshes them;
`/codex-auto-usage reserve 20` sets a 20% reserve. The setting is shared in
`~/.pi/agent/codex-auto.json`. Ordinary `/usage` remains unchanged for other
providers. Switching accounts can cause a prompt-cache miss.

The plugin owns model-catalog refreshes: `/model` refreshes Codex through the
personal account runtime and publishes it under `codex-auto`. It does not depend
on agent-auto having its own default `openai-codex` login. Pi's normal catalog
cache/freshness policy applies separately from the usage cache.
