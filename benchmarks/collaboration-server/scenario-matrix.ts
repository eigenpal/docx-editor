// Run many scenario seeds at once, in worker processes that each run seeds one at a time.
//
// A seed is single-threaded and holds its replicas in memory (about 1.5 GB for the
// `everything` shape on the sample document), so the matrix fans seeds out to child
// processes and caps how many run together by cores and by memory.
//
// Starting a process and loading the engine costs about half a second, as long as a whole
// seed of a shape on a small document, so a worker runs many seeds. It starts fresh after
// `SEEDS_PER_WORKER` seeds, or once it holds `WORKER_RESTART_BYTES`, so its memory stays
// bounded. A seed that fails in a worker runs again in a process of its own, and that run
// is the result: every failure the matrix reports reproduces with `scenarios.ts one`.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import os from 'node:os';
import { createInterface } from 'node:readline';

export interface MatrixJob {
  readonly config: string;
  readonly delivery: string;
  readonly seed: number;
}

export interface MatrixResult extends MatrixJob {
  readonly applied: number;
  /** The seed's first problem, or null when it ran clean. */
  readonly problem: string | null;
}

/** Peak footprint of the heaviest seed shape, with headroom. */
const BYTES_PER_JOB = 4 * 1024 ** 3;

/** Half the cores, and no more seeds than memory holds at the heaviest seed's peak. */
export function defaultMatrixWidth(): number {
  const byCores = Math.max(1, Math.floor(os.cpus().length / 2));
  const byMemory = Math.max(1, Math.floor(os.totalmem() / BYTES_PER_JOB));
  return Math.min(byCores, byMemory);
}

/** Seeds one worker runs before it starts fresh. */
const SEEDS_PER_WORKER = 25;

/** A worker that holds more than this after a seed starts fresh. */
const WORKER_RESTART_BYTES = 3 * 1024 ** 3;

/**
 * Every config and delivery for `count` seeds from `first`, heaviest shapes first. `heavy`
 * names the shapes whose seeds take long, as those on the large sample document do.
 */
export function matrixJobs(
  configs: readonly string[],
  deliveries: (config: string) => readonly string[],
  first: number,
  count: number,
  heavy: (config: string) => boolean = () => false
): MatrixJob[] {
  const jobs: MatrixJob[] = [];
  for (const config of configs) {
    for (const delivery of deliveries(config)) {
      for (let seed = first; seed < first + count; seed += 1) jobs.push({ config, delivery, seed });
    }
  }
  // The longest seeds start first, so the pool does not end on one long straggler.
  const weight = (job: MatrixJob) => (job.config === 'everything' ? 0 : heavy(job.config) ? 1 : 2);
  return jobs.sort((left, right) => weight(left) - weight(right));
}

function runOne(
  script: string,
  document: string,
  job: MatrixJob,
  extraArgs: readonly string[]
): Promise<MatrixResult> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        script,
        'one',
        '--config',
        job.config,
        '--delivery',
        job.delivery,
        '--seed',
        String(job.seed),
        '--document',
        document,
        ...extraArgs,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    // A crash is a problem too, not a missing result: a process that could not start, or
    // exited badly even after printing its line, does not count as clean.
    const failed = (detail: string) =>
      resolve({ ...job, applied: 0, problem: `seed process failed: ${detail}` });
    child.on('error', (error) => failed(error.message));
    child.on('close', (code, signal) => {
      const line = stdout.trim().split('\n').pop() ?? '';
      let parsed: { applied: number; problem: string | null } | null = null;
      try {
        parsed = JSON.parse(line) as { applied: number; problem: string | null };
      } catch {
        parsed = null;
      }
      if (parsed && code === 0) {
        resolve({ ...job, applied: parsed.applied, problem: parsed.problem });
        return;
      }
      // The error line names the cause; the stack under it only says where.
      const lines = stderr.trim().split('\n');
      const cause =
        lines.find((line) => /^\s*(\w*Error\b|error:|panic|Killed|out of memory)/i.test(line)) ??
        lines.at(-1);
      failed(`${cause?.trim() || 'no output'} (exit ${code ?? signal})`);
    });
  });
}

/** One worker process: `scenarios.ts worker`, which reads a job per line and answers one. */
class SeedWorker {
  readonly child: ChildProcessWithoutNullStreams;
  private readonly lines: string[] = [];
  private waiting: ((line: string | null) => void) | null = null;
  private closed = false;
  private stderr = '';
  ran = 0;

  constructor(script: string, document: string, extraArgs: readonly string[]) {
    this.child = spawn(process.execPath, [script, 'worker', '--document', document, ...extraArgs], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      if (this.waiting) {
        const waiting = this.waiting;
        this.waiting = null;
        waiting(line);
      } else this.lines.push(line);
    });
    this.child.stderr.on('data', (chunk) => (this.stderr = (this.stderr + chunk).slice(-4000)));
    const close = () => {
      this.closed = true;
      this.waiting?.(null);
      this.waiting = null;
    };
    this.child.on('close', close);
    this.child.on('error', close);
  }

  /** Run one job: its result, and the worker's memory after it, or null if the worker died. */
  async run(job: MatrixJob): Promise<{ result: MatrixResult; rss: number } | { died: string }> {
    this.ran += 1;
    this.child.stdin.write(`${JSON.stringify(job)}\n`);
    const line =
      this.lines.shift() ??
      (this.closed
        ? null
        : await new Promise<string | null>((resolve) => (this.waiting = resolve)));
    try {
      const parsed = JSON.parse(line ?? '') as {
        applied: number;
        problem: string | null;
        rss: number;
      };
      return {
        result: { ...job, applied: parsed.applied, problem: parsed.problem },
        rss: parsed.rss,
      };
    } catch {
      const lines = this.stderr.trim().split('\n');
      const cause =
        lines.find((entry) => /^\s*(\w*Error\b|error:|panic|Killed|out of memory)/i.test(entry)) ??
        lines.at(-1);
      return { died: cause?.trim() || 'no output' };
    }
  }

  /** Let the worker finish and exit. */
  async stop(): Promise<void> {
    if (this.closed) return;
    const exited = new Promise<void>((resolve) => this.child.once('close', () => resolve()));
    this.child.stdin.end();
    await exited;
  }
}

/** Run the jobs with at most `width` worker processes at a time. */
export async function runMatrix(
  script: string,
  document: string,
  jobs: readonly MatrixJob[],
  width: number,
  onResult: (result: MatrixResult) => void,
  extraArgs: readonly string[] = []
): Promise<MatrixResult[]> {
  const results: MatrixResult[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    let current: SeedWorker | null = null;
    while (next < jobs.length) {
      const job = jobs[next]!;
      next += 1;
      current ??= new SeedWorker(script, document, extraArgs);
      const outcome = await current.run(job);
      let result: MatrixResult;
      if ('died' in outcome) {
        // A worker that dies takes only its current seed with it; that seed runs alone.
        current = null;
        result = await runOne(script, document, job, extraArgs);
      } else {
        result = outcome.result;
        if (result.problem) {
          // Confirmed alone, so the failure is the seed's own and `one` reproduces it.
          const alone = await runOne(script, document, job, extraArgs);
          result = alone.problem
            ? alone
            : { ...result, problem: `only after other seeds in one process: ${result.problem}` };
        }
        if (current.ran >= SEEDS_PER_WORKER || outcome.rss > WORKER_RESTART_BYTES) {
          await current.stop();
          current = null;
        }
      }
      results.push(result);
      onResult(result);
    }
    await current?.stop();
  };
  await Promise.all(Array.from({ length: Math.min(width, jobs.length) }, worker));
  return results;
}
