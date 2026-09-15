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
export async function registry(name, version = '', { waitForPublication = false } = {}) {
  const deadline = Date.now() + (waitForPublication ? 120_000 : 0);
  let networkAttempts = 0;
  for (;;) {
    let response;
    try {
      response = await fetch(
        `https://registry.npmjs.org/${encodeURIComponent(name)}${version ? '/' + version : ''}`,
        { signal: AbortSignal.timeout(30_000), headers: { 'cache-control': 'no-cache' } }
      );
    } catch (error) {
      if (++networkAttempts < 3 || (waitForPublication && Date.now() < deadline)) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      throw new Error(
        `Registry request failed: ${name}@${version}: ${error.cause?.code ?? error.message}`
      );
    }
    if (response.ok) return response.json();
    if (
      waitForPublication &&
      [404, 429, 500, 502, 503, 504].includes(response.status) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      continue;
    }
    throw new Error(`Registry lookup failed: ${name}@${version}: HTTP ${response.status}`);
  }
}
export function option(name, fallback) {
  const index = process.argv.indexOf('--' + name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} needs a value`);
  return value;
}
