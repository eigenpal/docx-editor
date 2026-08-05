#!/usr/bin/env node
// The suite, sharded across processes.
//
// `bun test` runs every file in ONE process, one after another. That is the right default for
// isolation debugging and the wrong one for a suite whose wall clock is dominated by a handful of
// files: four TypeScript compiles in `editor-api` and the whole-package OOXML oracles in `core`
// account for a minute on their own while thirteen cores idle.
//
// So this runs `bun test <file>` per file over a worker pool. Each file keeps the isolation it had
// — one process, one module graph, the same `bunfig.toml` preload — and gains isolation it did not:
// a surface left mounted in `document.body` by one file can no longer be found by the next one's
// `document.querySelector`. Shorter AND stricter.
//
//   node scripts/test/run-parallel.mjs [--jobs N] [-- <args passed to every `bun test`>]
//
// Slowest-first, from a duration cache written on every run, so the long poles start immediately
// instead of landing last and leaving the pool half-idle.

import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SEARCH_ROOT = join(ROOT, 'packages');
const CACHE_FILE = join(ROOT, 'node_modules', '.cache', 'docx-editor', 'test-durations.json');

/** Directories that hold build output or dependencies, never sources to run. */
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'dist-types', 'temp', '.turbo']);

/** Bun's own test-file convention, minus the extensions this repository does not use. */
const TEST_FILE = /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/;

/**
 * A per-test budget for the whole run. The default is five seconds, which is under what a single
 * TypeScript compile or a quarter-megabyte OOXML round trip costs on a loaded box — and a timeout
 * reports "slow" as "broken". The genuinely slow tests state their own budget; this is the floor
 * for everything else, generous enough to survive contention and short enough to catch a hang.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

function discover(directory, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) discover(join(directory, entry.name), found);
    } else if (TEST_FILE.test(entry.name)) {
      found.push(relative(ROOT, join(directory, entry.name)));
    }
  }
  return found;
}

function readDurations() {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeDurations(durations) {
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(durations));
  } catch {
    // A missing cache costs ordering, not correctness. Never fail the run over it.
  }
}

/** Bun's tallies: ` 71 pass`, ` 1 skip`, ` 0 fail`, ` 3 todo`. */
function tally(output) {
  const counts = { pass: 0, fail: 0, skip: 0, todo: 0 };
  for (const [, count, kind] of output.matchAll(/^\s*(\d+) (pass|fail|skip|todo)\s*$/gm)) {
    counts[kind] += Number(count);
  }
  return counts;
}

/**
 * A `-t` filter that matches nothing in a file is an error to `bun test`, which is right when it
 * is running the whole suite and wrong when it is running one thirty-ninth of it. Sharded, most
 * files legitimately contain nothing the filter names.
 */
const NO_MATCHES = /matched 0 tests|had no matches/;

function parseArguments(argv) {
  const passthrough = [];
  let jobs = 0;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') {
      passthrough.push(...argv.slice(index + 1));
      break;
    }
    if (argument === '--jobs' || argument === '-j') {
      jobs = Number(argv[index + 1]);
      index += 1;
    } else if (argument.startsWith('--jobs=')) {
      jobs = Number(argument.slice('--jobs='.length));
    } else {
      passthrough.push(argument);
    }
  }
  return { jobs, passthrough };
}

function runFile(file, passthrough) {
  return new Promise((settle) => {
    const started = Date.now();
    const args = ['test', file];
    if (!passthrough.some((argument) => argument.startsWith('--timeout'))) {
      args.push('--timeout', String(DEFAULT_TIMEOUT_MS));
    }
    const child = spawn('bun', [...args, ...passthrough], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: process.stdout.isTTY ? '1' : '0' },
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', (error) => {
      settle({ file, output: `failed to spawn bun: ${error.message}`, code: 1, ms: 0 });
    });
    child.on('close', (code) => {
      settle({ file, output, code: code ?? 1, ms: Date.now() - started });
    });
  });
}

async function main() {
  const { jobs, passthrough } = parseArguments(process.argv.slice(2));
  const files = discover(SEARCH_ROOT);
  if (files.length === 0) {
    console.error('no test files found under packages/');
    process.exit(1);
  }

  const durations = readDurations();
  // Slowest first. An unseen file sorts high so a NEW slow file is not discovered last.
  files.sort(
    (a, b) => (durations[b] ?? Number.MAX_SAFE_INTEGER) - (durations[a] ?? Number.MAX_SAFE_INTEGER)
  );

  const workers = Math.max(1, jobs || availableParallelism());
  console.log(`Running ${files.length} test files across ${workers} workers`);

  const totals = { pass: 0, fail: 0, skip: 0, todo: 0 };
  const failures = [];
  const started = Date.now();
  let next = 0;
  let done = 0;

  async function worker() {
    while (next < files.length) {
      const file = files[next++];
      const result = await runFile(file, passthrough);
      durations[file] = result.ms;
      done += 1;

      const counts = tally(result.output);
      totals.pass += counts.pass;
      totals.fail += counts.fail;
      totals.skip += counts.skip;
      totals.todo += counts.todo;

      // A crash before the first test prints no tally at all, so the exit code is the authority
      // on whether a file passed — not the absence of a `fail` line.
      const emptyFilter = result.code !== 0 && counts.fail === 0 && NO_MATCHES.test(result.output);
      if (emptyFilter) {
        // nothing to run here, and nothing to report
      } else if (result.code !== 0 || counts.fail > 0) {
        failures.push(result);
        process.stdout.write(`FAIL ${file} (${(result.ms / 1000).toFixed(1)}s)\n`);
      } else if (process.stdout.isTTY) {
        // One redrawn line, padded to a fixed width so a shorter path cannot leave the tail of a
        // longer one behind it. Non-TTY output (CI) stays quiet apart from failures.
        process.stdout.write(`\r${`${done}/${files.length} ${file.slice(-72)}`.padEnd(96)}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(workers, files.length) }, worker));
  if (process.stdout.isTTY) process.stdout.write(`\r${''.padEnd(96)}\r`);
  writeDurations(durations);

  for (const failure of failures) {
    console.log(`\n${'─'.repeat(72)}\n${failure.file}\n${'─'.repeat(72)}`);
    console.log(failure.output.trimEnd());
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(2);
  console.log(
    `\n${totals.pass} pass  ${totals.fail} fail  ${totals.skip} skip  ${totals.todo} todo` +
      `\nRan ${files.length} files across ${workers} workers in ${elapsed}s`
  );
  process.exit(failures.length > 0 ? 1 : 0);
}

await main();
