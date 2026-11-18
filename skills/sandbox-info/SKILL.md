---
name: sandbox-info
description: Inspect whether a Pi session uses the host-specific Bubblewrap wrapper and explain its sandbox capabilities. Use when tools are missing or sandbox/filesystem capabilities are unclear.
compatibility: pi
---

# Pi sandbox

Pi itself does not guarantee sandboxing. This package can also run in ordinary,
unsandboxed Pi sessions. First inspect the supplied session instructions,
environment, and mounts; do not infer isolation from this skill being installed.
Use `findmnt` if available to inspect the filesystem. Do not assume that only the
project is writable, that other paths are tmpfs, or that actions cannot affect
the host: wrapper mounts and access modes determine this.

## Nix tool usage

Check `command -v nix` before recommending Nix commands. If Nix is available,
use `nix shell` for additional tools or `nix_bash` (when registered) for the
current flake's development shell. Otherwise use available host tools and the
project's documented setup; this package does not install Nix.

## Temporary files

Do not assume `/tmp` persists across Pi restarts. The host wrapper may provide
persistent storage, while subagents have private temporary storage. Verify the
current session's instructions and mounts before relying on persistence.
