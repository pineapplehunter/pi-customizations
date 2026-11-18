#!/usr/bin/env node
/** Create a minimal Agent Skill directory without overwriting existing files. */
const { existsSync, mkdirSync, realpathSync, writeFileSync, readFileSync } = require('node:fs');
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

const usage = 'usage: init-skill.ts [-h] --path PATH [--resources RESOURCES] name';
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    path: { type: 'string' }, resources: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log(`${usage}\n\nCreate a minimal Agent Skill directory without overwriting existing files.\n\npositional arguments:\n  name\n\noptions:\n  -h, --help            show this help message and exit\n  --path PATH           parent directory\n  --resources RESOURCES`);
  } else {
    if (positionals.length !== 1) throw new Error('expected one name');
    if (values.path === undefined) throw new Error('the following arguments are required: --path');
    const resources = [...new Set((values.resources ?? '').split(',').map(item => item.trim()).filter(Boolean))];
    const invalid = resources.filter(item => !['scripts', 'references', 'assets'].includes(item)).sort();
    if (invalid.length) throw new Error(`argument --resources: unknown resources: ${invalid.join(', ')}; expected scripts,references,assets`);
    const name = positionals[0];
    if (name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*(?![\s\S])/.test(name)) throw new Error('name must be at most 64 characters and contain lowercase letters, digits, and single hyphens only');
    let parent = values.path;
    if (parent.startsWith('~')) {
      const user = parent.split('/')[0].slice(1);
      const home = user ? readFileSync('/etc/passwd', 'utf8').split('\n').find((line: string) => line.split(':')[0] === user)?.split(':')[5] : homedir();
      if (!home) throw new Error(`Could not determine home directory for ${user}`);
      parent = home + parent.slice(user.length + 1);
    }
    const directory = join(canonical(parent), name);
    if (existsSync(directory)) throw new Error(`refusing to overwrite existing path: ${directory}`);
    mkdirSync(dirname(directory), { recursive: true });
    mkdirSync(directory);
    const title = name.replaceAll('-', ' ').replace(/[a-z]+/g, word => word[0].toUpperCase() + word.slice(1));
    writeFileSync(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: TODO — explain what this skill does and when it should be used.\n---\n\n# ${title}\n\n## Instructions\n\nTODO: Add concise, actionable instructions.\n`, { encoding: 'utf8', flag: 'wx' });
    for (const resource of resources) mkdirSync(join(directory, resource));
    console.log(directory);
  }
} catch (error) {
  console.error(`${usage}\ninit-skill.ts: error: ${(error as Error).message}`);
  process.exitCode = 2;
}
