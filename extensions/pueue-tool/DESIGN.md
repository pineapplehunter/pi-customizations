# Per-instance Pueue design

The independently publishable `pi-pueue` package lives in this directory. It
contains the generic extension, callback helper, skill, and minimal tests.
The repository root GPLv3-or-later license applies. The surrounding repository
provides a separate private integration at
`../subagent-pueue/`; host launcher/runner sources remain in
`nixos-config/home/pi-coding-agent/pineapplehunter/tools/subagents/`.

## Runtime ownership

- Start automatically at `session_start` only for interactive/RPC Pi.
- Create a unique private directory under `os.tmpdir()`, mode 0700. Generate
  Pueue configuration pointing exclusively at that directory and socket.
- Start foreground `pueued` in its own process group, with output in the private
  daemon log. Await bounded readiness, then set the default-group parallelism
  once to `max(1, ceil(os.availableParallelism() / 2))`.
- Keep the runtime object on `globalThis` under a namespaced symbol. This is
  process-local, not inherited by children or reconstructed from chat history.
  Extension replacement detaches watchers/UI references but retains the daemon,
  processed attempts, inactivity monitor/settings, and user parallelism.
- Set `PUEUE_CONFIG_PATH` and `PI_PUEUE_NOTIFY_DIR` for subsequent shell commands.
  Never adopt inherited values. CLI calls made by the extension also specify
  the private config explicitly.
- On normal quit stop the daemon and managed tasks, then remove its temporary
  directory. New Pi processes never reconnect to old queues. No restart/replay
  machinery is provided.
- Missing binaries produce one concise installation message. The model gets
  current runtime availability, not a setup/concurrency notification. Workflow
  and concurrency instructions belong to the skill.

## Completion delivery

The callback invokes the current Node executable and bundled `complete.mjs`.
Only the numeric task ID is interpolated by Pueue. An atomically renamed event
file prompts reconciliation; the event body is not trusted as queue state.

`pueue status --json` is authoritative. Reconcile after hooks, every ten seconds,
and before final settlement. Deduplicate task attempts using ID and start/end
timestamps within the current process-owned queue. Completion messages include
a queue identity so historical messages cannot mark another runtime processed.

A task is processed only after its notification reaches model context and the
agent completes a run. Failed/cancelled tasks also notify. No claim of cognitive
attention, full log inspection, or crash-level exactly-once execution is made.

New sessions and branches retain processed state; unprocessed notifications can
be redelivered to the current conversation after runtime replacement. The core
never tells an unrelated conversation to continue the task's original request.
Abort/error pauses automatic delivery; a new explicit prompt or notification
command can resume it.

## Logs and inactivity

The existing bounded TUI browser retains 5,000 lines and limits individual line
length. It kills only its own log/follow subprocesses on close or replacement.
Output is not injected into model context. Optional formatters can turn raw
lines into readable activity; the raw toggle always remains available.

The inactivity monitor compares task-log inode, size, and mtime without reading
log contents. Quiet running tasks receive periodic reminders after 30 minutes
by default; output, a new attempt, or a timeout change resets the window. Paused
and queued tasks are not treated as stalled. Silence is not failure.

## Private subagent boundary

The generic hooks are documented in `README.md`. The private adapter owns label
interpretation, report paths, resume/cleanup guidance, RPC activity parsing, and
child shutdown. It requests shutdown only on a successful fully-processed queue
state after agent settlement, or reports explicit failure.

The host launcher explicitly loads both extensions, even with automatic resource
loading disabled. The runner checks both command registrations before sending
the prompt and requires the adapter's successful exit entry. Each child Pi
creates its own daemon; the host no longer provides a shared config/callback or
starts `pueued`.
