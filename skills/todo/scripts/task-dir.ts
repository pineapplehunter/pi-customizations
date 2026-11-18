#!/usr/bin/env node
/** Resolve the in-tree or temporary task-list directory for a workspace. */
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { mkdirSync, realpathSync, readFileSync } = require('node:fs');
const { homedir } = require('node:os');
const { basename, dirname, join, resolve } = require('node:path');
const { parseArgs } = require('node:util');

function canonical(path: string): string {
  path = resolve(path);
  try { return realpathSync(path); } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    return join(canonical(dirname(path)), basename(path));
  }
}

const usage = 'usage: task-dir.ts [-h] [--root ROOT] [--create] {intree,tmp}';
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    root: { type: 'string' }, create: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log(`${usage}\n\nResolve the in-tree or temporary task-list directory for a workspace.\n\npositional arguments:\n  {intree,tmp}\n\noptions:\n  -h, --help   show this help message and exit\n  --root ROOT\n  --create`);
  } else {
    if (positionals.length !== 1 || !['intree', 'tmp'].includes(positionals[0])) throw new Error('expected one mode: intree or tmp');
    let start = values.root ?? process.cwd();
    if (start.startsWith('~')) {
      const user = start.split('/')[0].slice(1);
      const home = user ? readFileSync('/etc/passwd', 'utf8').split('\n').find((line: string) => line.split(':')[0] === user)?.split(':')[5] : homedir();
      if (!home) throw new Error(`Could not determine home directory for ${user}`);
      start = home + start.slice(user.length + 1);
    }
    let root = canonical(start);
    try { root = canonical(execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()); } catch { /* Not a Git workspace. */ }
    const slug = basename(root).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'workspace';
    const digest = createHash('sha256').update(root).digest('hex').slice(0, 10);
    const directory = positionals[0] === 'intree' ? join(root, 'todo') : join('/tmp/pi-tasks', `${slug}-${digest}`, 'todo');
    if (values.create) mkdirSync(directory, { recursive: true });
    console.log(directory);
  }
} catch (error) {
  console.error(`${usage}\ntask-dir.ts: error: ${(error as Error).message}`);
  process.exitCode = 2;
}
