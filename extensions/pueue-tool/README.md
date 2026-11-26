# pi-pueue

Private background shell queues for [Pi](https://pi.dev), with automatic
completion turns, inactivity reminders, running-task status, and a log browser.
Supports Linux and macOS. No Nix, Bubblewrap, Python, or other plugins required.

## Install

Install Pueue (`pueue` and `pueued`) and Pi with Node.js 22.18 or newer, then:

```sh
pi install /absolute/path/to/pi-customizations/extensions/pueue-tool
```

This directory is a self-contained Pi/npm package. It can be packed with
`npm pack` and published independently; it does not install the surrounding
customizations or private subagent adapter. No npm publication is performed by
this repository change.

## Use

The extension automatically creates a private daemon, config, socket, callback,
and logs under the OS temporary directory for each interactive/RPC Pi process.
Its `PUEUE_CONFIG_PATH` environment points shell commands at that private queue;
it never attaches to an inherited or host queue. Ordinary print/JSON invocations
do not start a daemon.

```sh
pueue add --print-task-id -- 'your-command && another-command'
pueue log --lines 3 TASK_ID
```

The bundled `pueue` skill explains concurrency and the agent workflow. No enable
tool or manual daemon setup is needed. The callback wakes idle Pi or queues a
message while busy; a ten-second status reconciliation also recovers missed
callbacks. The model receives completion metadata, not whole task logs.

- `/pueue-logs [task-id]`: browse live/finished logs (interactive Pi only).
- `/pueue-notifications [off]`: resume/pause automatic turns, without cancelling jobs.
- `/pueue-inactivity [30m|10s|2h|off]`: inspect/change no-output reminders.

`/new`, `/fork`, `/resume`, `/tree`, and `/reload` preserve the queue, settings,
and processed-completion tracking within the same Pi process. Results go to the
active conversation. Navigation is not a rollback of commands or filesystem
changes. Historical task IDs may belong to another Pi process.

Quitting Pi stops its managed jobs and daemon, then deletes its temporary queue
and logs. Keep required artifacts outside that directory. A new Pi process
starts fresh. If the daemon becomes unavailable, restart Pi.

## Optional integrations

The shared `pi.events` bus provides these hooks:

- `pueue:format-completion`: synchronously mutate `{task, content, summary}` before
  the single completion message is sent.
- `pueue:format-log`: synchronously mutate `{task, name, mode, parseLine?}`. A
  formatter is created per log source; `parseLine` processes complete lines.
  The viewer still supplies raw-output mode and bounded streaming.
- `pueue:state`: observe `{ready, error?}`. `ready` is emitted at final agent
  settlement only when every retained task is terminal and its completion has
  been included in model context followed by a completed run. Errors never
  report readiness. The core never shuts down Pi itself.
- `pueue:running`: before final agent settlement, report a boolean indicating
  whether the queue check found a running job. Paused, queued, and finished
  jobs do not count. Reports `false` if the check is skipped or fails.

Listeners must unsubscribe on session shutdown. Formatting hooks are synchronous;
async handlers are not awaited. No integration is required for ordinary use.

## Checks and license

```sh
npm test
```

Tests use Node's built-in runner. Real-daemon tests require Pueue on `PATH`.
The package source is licensed under **GPL-3.0-or-later**; see [LICENSE](LICENSE).
