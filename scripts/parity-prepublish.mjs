#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const commands = [
  { cmd: 'bun', args: ['run', 'typecheck'] },
  { cmd: 'bun', args: ['run', 'check:parity'] },
  { cmd: 'bun', args: ['run', 'i18n:validate'] },
  {
    cmd: 'bun',
    args: ['run', 'build'],
    env: { NODE_OPTIONS: process.env.NODE_OPTIONS ?? '--max-old-space-size=8192' },
  },
  { cmd: 'bun', args: ['run', 'check:consumer-install'], env: { SKIP_CONSUMER_INSTALL_BUILD: '1' } },
  { cmd: 'bun', args: ['run', 'test:e2e:parity:smoke'] },
];

let failed = false;
for (const { cmd, args, env } of commands) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) {
    failed = true;
    break;
  }
}

if (failed) {
  console.error('\nParity prepublish gate failed.');
  process.exit(1);
}

console.log('\nParity prepublish gate passed.');
