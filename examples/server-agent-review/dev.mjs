import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('.', import.meta.url));
const envFile = fileURLToPath(new URL('.env', import.meta.url));
if (existsSync(envFile)) loadEnvFile(envFile);
const children = [
  ['node', ['--env-file-if-exists=.env', 'server/collaboration.ts']],
  ['node', ['--env-file-if-exists=.env', 'server/index.ts']],
  ['bun', ['run', 'dev']],
].map(([command, args]) => spawn(command, args, { cwd, stdio: 'inherit' }));
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
for (const child of children) child.on('exit', (code) => stop(code ?? 1));
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
