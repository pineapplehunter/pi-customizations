# Private subagent/Pueue adapter

This extension belongs to `pi-customizations`, not the standalone `pi-pueue`
package. It uses the public package's three optional event hooks to preserve:

- report paths, resume commands, and cleanup guidance in parent completions;
- readable RPC activity and short task names in the log browser;
- child shutdown only after every background result has been processed by a
  completed model run, or an explicit failure has been recorded.

Only `PI_SUBAGENT_ROLE=child` enables automatic exit. Ordinary parent Pi stays
alive. Before requesting child shutdown the adapter appends
`pueue-subagent-exit` with `{success, error}`; the host RPC runner validates it.
`/subagent-pueue-status` also lets the runner verify this adapter is loaded.

The host launcher must explicitly load both `../pueue-tool/index.ts` and this
`index.ts`, including with `--no-inherit-resources`. No parent daemon/config is
shared with the child: the public extension owns a fresh queue per Pi process.
