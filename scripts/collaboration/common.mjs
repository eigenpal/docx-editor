import { setTimeout as sleep } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '../..');
export const CATALOG = '.collaboration/releases.json';
export const PACKAGES = ['i18n', 'core', 'editor-api', 'pro'];
export const FIELDS = [
  'protocolVersion',
  'sharedSchemaVersion',
  'repairVersion',
  'canonicalModelVersion',
];
export const VERSION_SOURCE = 'packages/pro/src/collaboration/document-compatibility.ts';
export const GUIDE = 'docs/site/content/pro/collaboration-versions.mdx';
export const read = (file) => readFileSync(resolve(ROOT, file), 'utf8');
export const json = (file) => JSON.parse(read(file));
export const sha = (value) => createHash('sha256').update(value).digest('hex');
export function writeJSON(file, value) {
  const path = resolve(ROOT, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}
export function run(command, args, cwd = ROOT) {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: 300_000,
      env: { ...process.env, HUSKY: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const diagnostics = [error.stdout, error.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} failed:\n${diagnostics || error.message}`);
  }
}
export const git = (...args) => run('git', args).trim();
export function versions(source = read(VERSION_SOURCE)) {
  return Object.fromEntries(
    FIELDS.map((field) => {
      const match = source.match(new RegExp(`\\b${field}:\\s*(\\d+)\\s*[,}]`));
      if (!match) throw new Error(`Cannot read ${field} from compatibility constants`);
      return [field, Number(match[1])];
    })
  );
}
export const formatOf = (value) =>
  `docx-collaboration:${FIELDS.map((field) => value[field]).join('.')}`;
export function compareVersions(a, b) {
  if (![a, b].every((v) => /^\d+\.\d+\.\d+$/.test(v)))
    throw new Error('Expected stable npm versions');
  const left = a.split('.').map(Number),
    right = b.split('.').map(Number);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}
export { registry } from './registry.mjs';

/**
 * One GitHub API call, retried on temporary errors. A rate limit waits longer, because the
 * limit resets on a fixed window. A missing permission fails at once; `permission` says
 * which one the caller needs.
 */
export async function withRetries(
  call,
  { attempts = 8, delay = 10_000, rateLimitDelay = 60_000, permission, wait = sleep } = {}
) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      if (/Resource not accessible by integration/i.test(error.message))
        throw permission ? new Error(`${permission}\n${error.message}`) : error;
      const limited = /rate limit/i.test(error.message);
      const transient =
        /HTTP (?:5\d\d|429)|timed out|timeout|ECONNRESET|ETIMEDOUT|connection reset|error connecting|fetch failed/i.test(
          error.message
        );
      if (attempt >= attempts || !(limited || transient)) throw error;
      console.warn(`Temporary GitHub API error (attempt ${attempt}/${attempts}); retrying.`);
      // Capped: a job has a fixed budget, and an uncapped rate-limit wait can use all of it.
      await wait(Math.min((limited ? rateLimitDelay : delay) * attempt, 300_000));
    }
  }
}
export function option(name, fallback) {
  const index = process.argv.indexOf('--' + name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} needs a value`);
  return value;
}
