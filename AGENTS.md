Prefer shallow clones in /tmp over repeated remote searches of public repositories.
Resolve bundled helper paths relative to the loaded skill's SKILL.md.
If the session uses the NixOS Bubblewrap wrapper, consult `sandbox-info` for its filesystem and tool constraints. Do not assume ordinary Pi sessions are sandboxed.
When Nix is available and the project has a flake, use `nix_bash` or `nix develop` for development-shell tools, and `nix shell` for additional tools. Otherwise use the project's native toolchain.

Pi’s TUI renders fenced `mermaid` code blocks natively. See [`markdown.mermaid` in Pi’s settings reference](https://pi.dev/docs/latest/settings#terminal-and-display).
