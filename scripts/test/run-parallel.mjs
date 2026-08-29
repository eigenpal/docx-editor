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
//
// The pool is machine-aware: width is capped by installed memory as well as cores and split
// between concurrent runs on the same machine, and dispatch spends each file's measured peak
// footprint against the memory the machine actually has available right now, so the heavy files
// cannot all land at once. `--jobs N` pins the width but never lifts the dispatch gate.

import { execFile, execFileSync, spawn } from 'node:child_process';
import { availableParallelism, freemem, tmpdir, totalmem } from 'node:os';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// `scripts/` as well as `packages/`: the checks that guard the published manifests and the
// docs surface live next to the scripts they cover, and a suite that only walks `packages`
// leaves them sitting there passing locally and running nowhere.
//
// `docs/` and `examples/` for the same reason, learned the hard way: the typed feature matrix
// has a test beside it, and it never ran here, so a plain type error in that file survived
// review. A test the suite does not walk is worth nothing.
const SEARCH_ROOTS = [
  join(ROOT, 'packages'),
  join(ROOT, 'scripts'),
  join(ROOT, 'docs'),
  join(ROOT, 'examples'),
];
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

const GiB = 1024 ** 3;

/**
 * Memory guards, learned the hard way: slowest-first ordering starts the heaviest files (the
 * whole-package OOXML oracles, measured at 2–4 GiB each and worse under swap) all at once, and a
 * pool sized to cores alone once put fourteen multi-GiB bun processes on a 48 GiB machine. The
 * thrash starved trustd, tccd blocked on it, and the WindowServer watchdog killed the login
 * session. "Run the suite" must not be able to take down the machine, so the pool is bounded:
 *
 * 1. Width is capped by installed memory, not just cores, and split between concurrent runs on
 *    the same machine (two sessions, two worktrees), which find each other through a tmpdir
 *    registry. The split is re-read during the run, so the first run shrinks when a second one
 *    starts instead of only the newcomer paying.
 * 2. Dispatch spends each file's measured peak footprint against what the machine has available
 *    RIGHT NOW; commitments not yet materialized (dispatched but not yet grown, tracked from live
 *    RSS samples) are charged on top. A heavy head file reserves its share so cheap files can
 *    flow past it without starving it.
 * 3. Files with no measurement yet (a cold cache, a new file) are additionally limited to a few
 *    in flight at once, because "unknown" includes "another multi-GiB oracle".
 * 4. Dispatch pauses outright under real memory pressure. One file may always run, so the gate
 *    can stall but never deadlock.
 */
const WORKER_MEMORY_SLICE = 3 * GiB;
/** What an unmeasured file is charged against the allowance. */
const UNKNOWN_PEAK_BYTES = 1 * GiB;
/** What a file too fast to sample is charged; also the floor under noisy tiny measurements. */
const PEAK_FLOOR_BYTES = 128 * 1024 * 1024;
/** What an unmeasured file might REALLY cost — the incident's oracles; sizes the unknown limit. */
const HEAVY_UNKNOWN_BYTES = 6 * GiB;
const PEAK_SAMPLE_INTERVAL_MS = 500;
/** Registry entries older than this are dead runs whatever their pid now maps to. */
const RUN_ENTRY_MAX_AGE_MS = 3 * 60 * 60 * 1000;

/**
 * System memory still available, by the accounting the platform's own killer uses where one
 * exists. Raw free pages understate macOS headroom badly (file cache and inactive pages are
 * reclaimable), so `os.freemem()` is only the fallback. Cached briefly: the probe forks a
 * process on macOS, and the gate consults it from every blocked worker every poll.
 */
let memorySample = { at: 0, bytes: 0 };
function availableMemory() {
  if (Date.now() - memorySample.at < PEAK_SAMPLE_INTERVAL_MS) return memorySample.bytes;
  let bytes;
  try {
    if (process.platform === 'darwin') {
      const level = Number(
        execFileSync('sysctl', ['-n', 'kern.memorystatus_level'], { encoding: 'utf8' })
      );
      bytes = Number.isFinite(level) ? (level / 100) * totalmem() : freemem();
    } else if (process.platform === 'linux') {
      const match = readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+) kB/m);
      bytes = match ? Number(match[1]) * 1024 : freemem();
    } else {
      bytes = freemem();
    }
  } catch {
    bytes = freemem();
  }
  memorySample = { at: Date.now(), bytes };
  return bytes;
}

/** Real pressure, not just a busy machine: the point where dispatching more work makes it worse. */
function underMemoryPressure() {
  return availableMemory() < Math.max(2 * GiB, totalmem() * 0.05);
}

const RUN_REGISTRY = join(tmpdir(), 'docx-editor-test-runs');

function registerRun() {
  try {
    mkdirSync(RUN_REGISTRY, { recursive: true });
    const own = join(RUN_REGISTRY, String(process.pid));
    writeFileSync(own, String(Date.now()));
    process.on('exit', () => {
      try {
        rmSync(own, { force: true });
      } catch {
        // A stale entry is cleaned up by the next run's liveness check.
      }
    });
    // Signal death skips 'exit' handlers; route the common Ctrl+C through process.exit so the
    // registry entry is removed instead of haunting every later run's split.
    process.on('SIGINT', () => process.exit(130));
    process.on('SIGTERM', () => process.exit(143));
  } catch {
    // No registry means no sharing, which only costs politeness between runs.
  }
}

/**
 * How many suite runs are alive on this machine right now, this one included. A pid that no
 * longer exists, one this user may not signal (EPERM means the pid was recycled by someone
 * else's process — our runs share a user), or an entry past the age cap is a dead run: removed,
 * not counted, so a ghost can never permanently halve every future run.
 */
function liveRuns() {
  let count = 0;
  try {
    for (const name of readdirSync(RUN_REGISTRY)) {
      const pid = Number(name);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      const entry = join(RUN_REGISTRY, name);
      let alive = false;
      try {
        const born = Number(readFileSync(entry, 'utf8'));
        if (Number.isFinite(born) && Date.now() - born < RUN_ENTRY_MAX_AGE_MS) {
          process.kill(pid, 0);
          alive = true;
        }
      } catch {
        // Not signalable by us: dead or recycled either way.
      }
      if (alive) count += 1;
      else rmSync(entry, { force: true });
    }
  } catch {
    return 1;
  }
  return Math.max(1, count);
}

/** liveRuns is a directory walk with a kill(0) per entry; refresh it, don't spin on it. */
let runsSample = { at: 0, count: 1 };
function currentRuns() {
  if (Date.now() - runsSample.at > 5_000) runsSample = { at: Date.now(), count: liveRuns() };
  return runsSample.count;
}

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
    const raw = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    // The cache used to hold bare millisecond numbers; now each entry also carries the file's
    // measured peak footprint. Normalize old entries instead of discarding the ordering they hold.
    const durations = {};
    for (const [file, value] of Object.entries(raw)) {
      durations[file] = typeof value === 'number' ? { ms: value } : value;
    }
    return durations;
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

/** The child's current resident set in bytes, or 0 when it cannot be read. */
function sampleRss(pid, onSample) {
  execFile('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }, (error, stdout) => {
    if (!error) onSample(Number(stdout.trim()) * 1024 || 0);
  });
}

function runFile(file, passthrough, onRss) {
  return new Promise((settle) => {
    const started = Date.now();
    let peak = 0;
    // `./` matters: a bare relative path is a FILTER that bun matches against the files its
    // own scan finds, and that scan does not reach everything this one does. With the
    // prefix it is a path, and the file runs whether or not bun would have discovered it.
    const args = ['test', `./${file}`];
    if (!passthrough.some((argument) => argument.startsWith('--timeout'))) {
      args.push('--timeout', String(DEFAULT_TIMEOUT_MS));
    }
    const child = spawn('bun', [...args, ...passthrough], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: process.stdout.isTTY ? '1' : '0' },
    });
    const sampler = setInterval(() => {
      sampleRss(child.pid, (rss) => {
        peak = Math.max(peak, rss);
        onRss(rss);
      });
    }, PEAK_SAMPLE_INTERVAL_MS);
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', (error) => {
      clearInterval(sampler);
      settle({ file, output: `failed to spawn bun: ${error.message}`, code: 1, ms: 0, peak: 0 });
    });
    child.on('close', (code) => {
      clearInterval(sampler);
      const ms = Date.now() - started;
      // A file that finished before the sampler ever fired cannot have grown large; record the
      // floor so it is charged as small next time instead of falling back to "unknown" forever.
      if (peak === 0 && code !== null && ms <= PEAK_SAMPLE_INTERVAL_MS * 2) peak = PEAK_FLOOR_BYTES;
      settle({ file, output, code: code ?? 1, ms, peak });
    });
  });
}

async function main() {
  const { jobs, passthrough } = parseArguments(process.argv.slice(2));
  const queue = SEARCH_ROOTS.flatMap((searchRoot) => discover(searchRoot));
  if (queue.length === 0) {
    console.error('no test files found under packages/, scripts/, docs/ or examples/');
    process.exit(1);
  }
  const total = queue.length;
  // A filtered run executes slivers of every file: its timings and peaks describe the filter,
  // not the file, and caching them would both scramble slowest-first ordering and teach the
  // memory gate that the multi-GiB oracles are tiny. Leave the cache alone entirely.
  const filteredRun = passthrough.some(
    (argument) =>
      argument === '-t' ||
      argument === '--test-name-pattern' ||
      argument.startsWith('--test-name-pattern=')
  );

  const durations = readDurations();
  // Slowest first. An unseen file sorts high so a NEW slow file is not discovered last.
  queue.sort(
    (a, b) =>
      (durations[b]?.ms ?? Number.MAX_SAFE_INTEGER) - (durations[a]?.ms ?? Number.MAX_SAFE_INTEGER)
  );

  registerRun();
  const memoryCap = Math.max(1, Math.floor(totalmem() / WORKER_MEMORY_SLICE));
  const maxWidth = Math.max(1, jobs || Math.min(availableParallelism(), memoryCap));
  // `--jobs` pins the width; otherwise it splits across live runs, re-read as the run goes so
  // the FIRST run shrinks when a second one starts. Workers past the current width park.
  function currentWidth() {
    return jobs ? maxWidth : Math.max(1, Math.floor(maxWidth / currentRuns()));
  }
  // What dispatch may commit: most of what the machine has available now, split between runs.
  // Floored so a bad probe stalls the pool at "a few GiB", never at zero.
  function currentAllowance() {
    return Math.max(WORKER_MEMORY_SLICE, (availableMemory() * 0.75) / currentRuns());
  }

  const startWidth = currentWidth();
  const startRuns = currentRuns();
  console.log(
    `Running ${total} test files across ${startWidth} workers` +
      ` (${(currentAllowance() / GiB).toFixed(0)} GiB allowance` +
      (startRuns > 1
        ? `, shared with ${startRuns - 1} concurrent run${startRuns > 2 ? 's' : ''})`
        : ')')
  );

  const totals = { pass: 0, fail: 0, skip: 0, todo: 0 };
  const failures = [];
  const started = Date.now();
  let done = 0;
  let pausedLogged = false;

  /** file → { expected, rss, unknown } for everything dispatched and not yet finished. */
  const inFlight = new Map();

  function expectedFor(file) {
    const peak = durations[file]?.peak;
    if (peak >= PEAK_FLOOR_BYTES) return { bytes: peak, unknown: false };
    if (peak > 0) return { bytes: PEAK_FLOOR_BYTES, unknown: false };
    return { bytes: UNKNOWN_PEAK_BYTES, unknown: true };
  }

  /** Commitment not yet materialized: what dispatched files are still expected to grow by. */
  function pendingBytes() {
    let sum = 0;
    for (const entry of inFlight.values()) sum += Math.max(0, entry.expected - entry.rss);
    return sum;
  }

  function unknownInFlight() {
    let count = 0;
    for (const entry of inFlight.values()) if (entry.unknown) count += 1;
    return count;
  }

  function take(index) {
    const [file] = queue.splice(index, 1);
    const { bytes, unknown } = expectedFor(file);
    const entry = { expected: bytes, rss: 0, unknown };
    inFlight.set(file, entry);
    return { file, entry };
  }

  /**
   * Pick the next file the machine has room for, or null to wait. The head is preferred and its
   * share stays reserved when skipping past it, so cheap files flow around a heavy head without
   * starving it. Taking the head whenever nothing is in flight guarantees forward progress.
   */
  function pickNext() {
    if (queue.length === 0) return null;
    if (inFlight.size === 0) return take(0);
    if (underMemoryPressure()) {
      if (!pausedLogged) {
        pausedLogged = true;
        console.warn('\nlow system memory: pausing dispatch until it recovers');
      }
      return null;
    }
    // Re-arm the warning once pressure clears so a later episode is reported too.
    pausedLogged = false;
    const allowance = currentAllowance();
    const pending = pendingBytes();
    const unknownSlots =
      unknownInFlight() < Math.max(4, Math.floor(allowance / HEAVY_UNKNOWN_BYTES));
    const head = expectedFor(queue[0]);
    if (pending + head.bytes <= allowance && (!head.unknown || unknownSlots)) return take(0);
    for (let index = 1; index < queue.length; index += 1) {
      const candidate = expectedFor(queue[index]);
      if (candidate.unknown && !unknownSlots) continue;
      if (pending + head.bytes + candidate.bytes <= allowance) return take(index);
    }
    return null;
  }

  async function worker(index) {
    while (queue.length > 0) {
      if (index >= currentWidth()) {
        await sleep(PEAK_SAMPLE_INTERVAL_MS * 2);
        continue;
      }
      const picked = pickNext();
      if (!picked) {
        await sleep(PEAK_SAMPLE_INTERVAL_MS);
        continue;
      }
      const { file, entry } = picked;
      const result = await runFile(file, passthrough, (rss) => (entry.rss = rss));
      inFlight.delete(file);
      done += 1;

      const counts = tally(result.output);
      totals.pass += counts.pass;
      totals.fail += counts.fail;
      totals.skip += counts.skip;
      totals.todo += counts.todo;

      // A crash before the first test prints no tally at all, so the exit code is the authority
      // on whether a file passed — not the absence of a `fail` line.
      const emptyFilter = result.code !== 0 && counts.fail === 0 && NO_MATCHES.test(result.output);
      if (!filteredRun && !emptyFilter) durations[file] = { ms: result.ms, peak: result.peak };
      if (emptyFilter) {
        // nothing to run here, and nothing to report
      } else if (result.code !== 0 || counts.fail > 0) {
        failures.push(result);
        process.stdout.write(`FAIL ${file} (${(result.ms / 1000).toFixed(1)}s)\n`);
      } else if (process.stdout.isTTY) {
        // One redrawn line, padded to a fixed width so a shorter path cannot leave the tail of a
        // longer one behind it. Non-TTY output (CI) stays quiet apart from failures.
        process.stdout.write(`\r${`${done}/${total} ${file.slice(-72)}`.padEnd(96)}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(maxWidth, total) }, (_, index) => worker(index)));
  if (process.stdout.isTTY) process.stdout.write(`\r${''.padEnd(96)}\r`);
  if (!filteredRun) writeDurations(durations);

  for (const failure of failures) {
    console.log(`\n${'─'.repeat(72)}\n${failure.file}\n${'─'.repeat(72)}`);
    console.log(failure.output.trimEnd());
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(2);
  console.log(
    `\n${totals.pass} pass  ${totals.fail} fail  ${totals.skip} skip  ${totals.todo} todo` +
      `\nRan ${total} files across ${startWidth} workers in ${elapsed}s`
  );
  process.exit(failures.length > 0 ? 1 : 0);
}

await main();
