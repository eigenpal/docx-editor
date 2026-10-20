// Run many scenario seeds at once, one child process per seed.
//
// A seed is single-threaded and holds its replicas in memory (about 1.5 GB for the
// `everything` shape on the sample document), so the matrix fans seeds out to child
// processes and caps how many run together by cores and by memory.

import { spawn } from 'node:child_process';
import os from 'node:os';

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

/** Every config and delivery for `count` seeds from `first`, heaviest shapes first. */
export function matrixJobs(
  configs: readonly string[],
  deliveries: (config: string) => readonly string[],
  first: number,
  count: number
): MatrixJob[] {
  const jobs: MatrixJob[] = [];
  for (const config of configs) {
    for (const delivery of deliveries(config)) {
      for (let seed = first; seed < first + count; seed += 1) jobs.push({ config, delivery, seed });
    }
  }
  // The longest seeds start first, so the pool does not end on one long straggler.
  const weight = (job: MatrixJob) => (job.config === 'everything' ? 0 : 1);
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

/** Run the jobs with at most `width` child processes at a time. */
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
    while (next < jobs.length) {
      const job = jobs[next]!;
      next += 1;
      const result = await runOne(script, document, job, extraArgs);
      results.push(result);
      onResult(result);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, jobs.length) }, worker));
  return results;
}
