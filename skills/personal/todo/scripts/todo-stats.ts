#!/usr/bin/env node
/** Validate and list Markdown task files in priority order. */
const { readFileSync, readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');
const { parseArgs, TextDecoder } = require('node:util');

const required = ['title', 'created', 'status', 'priority'];
const statuses = new Set(['pending', 'in-progress', 'blocked', 'deferred', 'completed']);

function validateTimestamp(path: string, field: string, value: string): void {
  const parts = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (parts) {
    const [year, month, day, hour, minute, second] = parts.slice(1).map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && hour < 24 && minute < 60 && second < 60) return;
  }
  throw new Error(`${path}: invalid ${field} timestamp: ${value}`);
}

function readFrontmatter(path: string): Record<string, string> {
  const lines = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(path)).split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);
  if (lines.at(-1) === '') lines.pop();
  if (!lines.length || lines[0].trim() !== '---') throw new Error(`${path}: missing front matter`);
  const fields: Record<string, string> = Object.create(null);
  let closed = false;
  for (const line of lines.slice(1)) {
    if (line.trim() === '---') { closed = true; break; }
    const colon = line.indexOf(':');
    if (colon < 0) throw new Error(`${path}: invalid front matter line: ${line}`);
    const key = line.slice(0, colon).trim();
    if (!key) throw new Error(`${path}: empty front matter key`);
    if (Object.hasOwn(fields, key)) throw new Error(`${path}: duplicate front matter field: ${key}`);
    fields[key] = line.slice(colon + 1).trim();
  }
  if (!closed) throw new Error(`${path}: unterminated front matter`);
  const missing = required.filter(field => !Object.hasOwn(fields, field));
  if (missing.length) throw new Error(`${path}: missing front matter field(s): ${missing.join(', ')}`);
  const empty = required.filter(field => !fields[field]);
  if (empty.length) throw new Error(`${path}: empty front matter field(s): ${empty.join(', ')}`);
  for (const optional of ['base', 'tag']) {
    if (Object.hasOwn(fields, optional) && !fields[optional]) throw new Error(`${path}: empty front matter field: ${optional}`);
  }
  if (!/^P[0-3]$/.test(fields.priority)) throw new Error(`${path}: invalid priority: ${fields.priority}`);
  if (!statuses.has(fields.status)) throw new Error(`${path}: invalid status: ${fields.status}`);
  validateTimestamp(path, 'created', fields.created);
  if (fields.finished) validateTimestamp(path, 'finished', fields.finished);
  if (fields.status === 'completed' && !fields.finished) throw new Error(`${path}: completed task has no finished timestamp`);
  if (fields.status !== 'completed' && fields.finished) throw new Error(`${path}: unfinished task has a finished timestamp`);
  return fields;
}

const usage = 'usage: todo-stats.ts [-h] directory';
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { help: { type: 'boolean', short: 'h' } } });
  if (values.help) {
    console.log(`${usage}\n\nValidate and list Markdown task files in priority order.\n\npositional arguments:\n  directory\n\noptions:\n  -h, --help  show this help message and exit`);
  } else {
    if (positionals.length !== 1) throw new Error('expected one directory');
    const directory = positionals[0];
    let info;
    try { info = statSync(directory); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (info && !info.isDirectory()) throw new Error(`${directory}: not a directory`);
    const tasks: { name: string; fields: Record<string, string> }[] = [];
    if (info) {
      for (const name of readdirSync(directory)) {
        if (name.endsWith('.md') && name !== 'README.md') tasks.push({ name, fields: readFrontmatter(join(directory, name)) });
      }
    }
    const unfinished = tasks.filter(task => task.fields.status !== 'completed');
    const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
    unfinished.sort((a, b) => compare(a.fields.priority, b.fields.priority) || compare(a.fields.created, b.fields.created) || compare(a.name, b.name));
    console.log(`Tasks (${unfinished.length})`);
    for (const { name, fields } of unfinished) {
      const details = [`created ${fields.created}`];
      if (fields.base) details.push(`base ${fields.base}`);
      if (fields.tag) details.push(`tag ${fields.tag}`);
      console.log(`  [${fields.priority}] ${fields.title} -- ${fields.status} (${details.join('; ')}; ${name})`);
    }
  }
} catch (error) {
  console.error(`${usage}\ntodo-stats.ts: error: ${(error as Error).message}`);
  process.exitCode = 2;
}
