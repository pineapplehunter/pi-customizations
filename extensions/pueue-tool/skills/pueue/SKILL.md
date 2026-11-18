---
name: pueue
description: "Use this skill whenever you are about to run a shell command that may take a long time, or when you want to run commands in parallel. Triggers include: builds, test suites, dependency installations, data processing, and other potentially long-running work. Use this skill even if the user does not explicitly mention Pueue or background execution. Also use when enqueueing background jobs, inspecting their status or logs, managing concurrency, or diagnosing automatic completion notifications in Pi's private Pueue queue."
---

# Pueue

The pi-pueue extension automatically starts a private daemon for each living
interactive/RPC Pi process. It sets `PUEUE_CONFIG_PATH` and
`PI_PUEUE_NOTIFY_DIR`; check that the current runtime is available before using
Pueue. Do not use a host queue as a fallback. No enable tool or manual daemon
startup is needed. Ordinary `--print`/JSON execution is unsupported.

The queue survives `/new`, `/fork`, `/resume`, `/tree`, and `/reload` in the
same Pi process. Completions reach the active conversation, which may not be the
one that submitted the task. Historical task IDs may belong to an older queue;
use current runtime information, not old setup messages. Quitting Pi stops its
jobs and removes its temporary queue and logs. A new Pi process starts fresh.

## Concurrency

The default group's initial parallelism is **ceil(available CPUs / 2)**, at least
one. The extension sets this once, not on reload. Do not automatically change it
to the full CPU count. For sequential execution use `pueue parallel 1`, or create
a separate group with parallelism one when mixing parallel and sequential work.
Lowering parallelism does not stop already-running jobs. Use `pueue --help` for
group commands and other options.

## Enqueue → process

Pueue executes shell commands. Quote the whole command to keep operators in the
queued shell and quote spaced arguments inside it. From the project root, with
script/inputs prepared:

```bash
pueue add --print-task-id -- 'python3 "scripts/check files.py" && printf "check complete\n"'
```

**Do not use tee or log redirection.** Pueue captures stdout/stderr; inspect
that output with `pueue log`. Keep file output only for required task artifacts.
Retain the returned task ID. After completion, substitute it for `TASK_ID`:

```bash
pueue log --lines 3 TASK_ID
```

Expand `--lines` or use `--full` only as needed. Verify terminal status and
required outputs before claiming success; failure/cancellation is terminal,
not success. Process the result in the context of the current request.

Every completion starts a turn when idle or queues a follow-up when busy.
There is no subscription/yield tool. Do independent work, then end your response
naturally **without exiting Pi**. Never `pueue wait`, follow logs merely to wait,
or poll for completion.

## Manage and diagnose

- `pueue status`/`--json`: diagnosis, not waiting.
- `/pueue-logs [task-id]`: browse live/finished logs without sending them to the
  model. Interactive Pi only.
- Running tasks with no new output for 30 minutes trigger a stall-inspection
  reminder. Inspect logs and process state; silence alone does not justify
  cancellation. `/pueue-inactivity 10m` changes the interval;
  `/pueue-inactivity off` disables it. These are Pi commands, not shell commands.
  Paused/queued tasks do not trigger reminders; diagnose them explicitly.
- Abort/error pauses automatic turns. A new explicit user prompt or
  `/pueue-notifications` resumes them; `/pueue-notifications off` pauses delivery
  without cancelling tasks.
- `pueue clean` removes **all finished tasks and logs**. First process every
  needed result and retain evidence. Required artifacts must live outside the
  temporary queue directory.
