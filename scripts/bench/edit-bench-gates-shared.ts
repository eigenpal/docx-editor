// Shared by the edit-bench gate files. Each gate is its own test file so the suite runner can
// run the three benchmark processes at the same time instead of one after another.
import { expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Work {
  readonly placed: number;
  readonly total: number;
  readonly reusedPages: number;
  readonly fullPasses: number;
  readonly pagesBefore: number;
  readonly pagesAfter: number;
  readonly cache: {
    readonly hits: number;
    readonly misses: number;
    readonly evictions: number;
    readonly size: number;
  };
}

export interface Report {
  readonly fixtureSha256: string;
  readonly scenarios: readonly { readonly name: string; readonly work: Work }[];
}

const root = resolve(import.meta.dir, '../..');

export function runBench(fixture: string | null): Report {
  const run = Bun.spawnSync({
    cmd: [
      process.execPath,
      'scripts/bench/edit-bench.ts',
      ...(fixture ? [fixture] : []),
      '--runs',
      '1',
      '--warmup',
      '1',
      '--json',
    ],
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(run.exitCode, run.stderr.toString()).toBe(0);
  return JSON.parse(run.stdout.toString()) as Report;
}

export function workByName(report: Report): Record<string, Work> {
  return Object.fromEntries(report.scenarios.map((scenario) => [scenario.name, scenario.work]));
}

export const cache = (hits: number, misses: number, size: number) => ({
  hits,
  misses,
  evictions: 0,
  size,
});

// The 500+ page fixtures are generated on demand (they are too large to commit); the
// generator is byte-deterministic, so the sha still pins the content.
export function ensureMassiveFixtures(): void {
  const multi = resolve(root, 'e2e/fixtures/generated/synthetic-massive-multisection.docx');
  const single = resolve(root, 'e2e/fixtures/generated/synthetic-massive-singlesection.docx');
  if (existsSync(multi) && existsSync(single)) return;
  const run = Bun.spawnSync({
    cmd: [process.execPath, 'scripts/create-synthetic-massive-edit-fixture.mjs'],
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(run.exitCode, run.stderr.toString()).toBe(0);
}
