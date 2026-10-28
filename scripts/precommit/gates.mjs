#!/usr/bin/env node
// The pre-commit gates, run side by side.
//
// Every gate here reads the working tree and none writes it, so they need no order. Run one after
// another they cost the sum of their times (about 20 seconds); run together they cost about the
// slowest one, the whole-repository type check. Each gate's output is held back and printed only
// when it fails, so a failure is not buried in the others' progress lines.
//
// `lint-staged` stays in the hook before this script: it rewrites staged files, and every gate
// must see the result.
//
// The API snapshot gate compares the committed reports with the declarations in each package's
// `dist/`. A `dist/` older than its sources describes an API that no longer exists, so the gate
// would fail a correct commit or pass a wrong one. Stale packages are skipped with a notice
// instead; CI checks every package against a fresh build.

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGES } from '../lib/packages.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '__tests__', 'test']);

/** The newest modification time under `directory`, or 0 when it does not exist. */
function newestMtime(directory) {
  if (!existsSync(directory)) return 0;
  let newest = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) {
        newest = Math.max(newest, newestMtime(join(directory, entry.name)));
      }
    } else {
      newest = Math.max(newest, statSync(join(directory, entry.name)).mtimeMs);
    }
  }
  return newest;
}

/** The oldest declaration file directly in `dist/`, or 0 when there is none. */
function oldestDeclaration(dist) {
  if (!existsSync(dist)) return 0;
  const times = readdirSync(dist)
    .filter((file) => file.endsWith('.d.ts'))
    .map((file) => statSync(join(dist, file)).mtimeMs);
  return times.length === 0 ? 0 : Math.min(...times);
}

/** Split the API packages into those whose build matches their sources and those that lag. */
export function apiPackagesByFreshness(packages = PACKAGES, root = ROOT) {
  const fresh = [];
  const stale = [];
  for (const pkg of packages) {
    if (pkg.disconnected) continue;
    const built = oldestDeclaration(join(root, pkg.root, 'dist'));
    const sources = Math.max(
      newestMtime(join(root, pkg.root, 'src')),
      existsSync(join(root, pkg.root, 'package.json'))
        ? statSync(join(root, pkg.root, 'package.json')).mtimeMs
        : 0
    );
    (built > 0 && built >= sources ? fresh : stale).push(pkg);
  }
  return { fresh, stale };
}

function run(label, command, args) {
  const started = Date.now();
  return new Promise((resolveGate) => {
    const child = spawn(command, args, { cwd: ROOT, env: process.env });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', (error) => {
      output += `\nfailed to start ${command}: ${error.message}`;
    });
    child.on('close', (code) =>
      resolveGate({ label, code: code ?? 1, output, seconds: (Date.now() - started) / 1000 })
    );
  });
}

function mergeBase() {
  return new Promise((resolveBase) => {
    const attempt = (refs) => {
      if (refs.length === 0) return resolveBase('');
      const child = spawn('git', ['merge-base', 'HEAD', refs[0]], { cwd: ROOT });
      let out = '';
      child.stdout.on('data', (chunk) => (out += chunk));
      child.on('close', (code) => (code === 0 ? resolveBase(out.trim()) : attempt(refs.slice(1))));
    };
    attempt(['origin/main', 'main']);
  });
}

async function main() {
  const gates = [];
  const notes = [];

  // The collaboration policy CI job needs a decision record for any change under the covered
  // implementation paths. It reads the working tree and untracked files too, so it sees what
  // this commit adds. A checkout without a main ref (a shallow clone, a fork) leaves it to CI.
  const base = await mergeBase();
  if (base) {
    gates.push(
      run('collaboration policy', 'node', [
        'scripts/collaboration/cli.mjs',
        'check',
        '--base',
        base,
      ])
    );
  } else {
    notes.push('Skipped collaboration policy: no main ref to compare against.');
  }

  // bun check keeps no cache, so every commit checks every workspace from source.
  gates.push(run('TypeScript type check', 'bun', ['run', 'typecheck']));
  gates.push(run('parity gates', 'bun', ['run', 'check:parity']));
  gates.push(run('license header checks', 'bun', ['run', 'check:license-headers']));

  const { fresh, stale } = apiPackagesByFreshness();
  if (stale.length > 0) {
    notes.push(
      `Skipped the API snapshot check for ${stale.length} package(s) whose dist/ is older than ` +
        `their sources (${stale.map((pkg) => pkg.name.replace('@docx-editor.dev/', '')).join(', ')}). ` +
        'CI checks them on a fresh build. To check them here, run `bun run build:packages` first.'
    );
  }
  // One package at a time: each API Extractor run loads a TypeScript program, and the type
  // check already runs one process per workspace beside it. With every build current, one run
  // covers all packages, including the shared forgotten-export baseline.
  if (stale.length === 0) {
    gates.push(run('API snapshot check', 'node', ['scripts/api-extractor.mjs']));
  } else if (fresh.length > 0) {
    gates.push(
      (async () => {
        const started = Date.now();
        let output = '';
        for (const pkg of fresh) {
          const result = await run(pkg.name, 'node', [
            'scripts/api-extractor.mjs',
            '--package',
            pkg.name,
          ]);
          output += result.output;
          if (result.code !== 0) {
            return { label: 'API snapshot check', code: result.code, output, seconds: 0 };
          }
        }
        return {
          label: `API snapshot check (${fresh.length} current builds)`,
          code: 0,
          output,
          seconds: (Date.now() - started) / 1000,
        };
      })()
    );
  }

  // Content hashes survive branch switches and catch edits even when mtimes match.
  gates.push(
    run('formatting check', 'bun', [
      'run',
      'format:check',
      '--cache',
      '--cache-strategy',
      'content',
      '--cache-location',
      'node_modules/.cache/precommit/prettier',
    ])
  );
  // The lint script also runs the whole-file max-lines guard; oxlint lints the whole tree in
  // about a second, so it needs no cache.
  gates.push(run('lint', 'bun', ['run', 'lint']));

  const started = Date.now();
  const results = await Promise.all(gates);
  for (const note of notes) console.log(note);
  const failed = results.filter((result) => result.code !== 0);
  for (const result of results) {
    const status = result.code === 0 ? 'Passed' : 'Failed';
    console.log(`${status} ${result.label} (${result.seconds.toFixed(1)}s)`);
  }
  for (const result of failed) {
    console.error(
      `\n${'─'.repeat(72)}\n${result.label} failed (exit ${result.code})\n${'─'.repeat(72)}`
    );
    console.error(result.output.trimEnd());
  }
  console.log(`Pre-commit gates finished in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  process.exit(failed.length > 0 ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
