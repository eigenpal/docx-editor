import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

interface Work {
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

interface Report {
  readonly fixtureSha256: string;
  readonly scenarios: readonly { readonly name: string; readonly work: Work }[];
}

const EXPECTED: Readonly<Record<string, Work>> = {
  'steady-middle-text': {
    placed: 13,
    total: 3200,
    reusedPages: 154,
    fullPasses: 1,
    pagesBefore: 204,
    pagesAfter: 204,
    cache: { hits: 0, misses: 3213, evictions: 3213, size: 0 },
  },
  'wrap-middle-text': {
    placed: 13,
    total: 3200,
    reusedPages: 154,
    fullPasses: 1,
    pagesBefore: 204,
    pagesAfter: 204,
    cache: { hits: 0, misses: 3213, evictions: 3213, size: 0 },
  },
  'forced-middle-reflow': {
    placed: 13,
    total: 3200,
    reusedPages: 154,
    fullPasses: 1,
    pagesBefore: 204,
    pagesAfter: 204,
    cache: { hits: 0, misses: 3213, evictions: 3213, size: 0 },
  },
  'forced-early-reflow': {
    placed: 13,
    total: 3200,
    reusedPages: 155,
    fullPasses: 1,
    pagesBefore: 204,
    pagesAfter: 204,
    cache: { hits: 0, misses: 3213, evictions: 3213, size: 0 },
  },
};

test('long-document edit work stays bounded', () => {
  const root = resolve(import.meta.dir, '../..');
  const run = Bun.spawnSync({
    cmd: [
      process.execPath,
      'scripts/bench/edit-bench.ts',
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
  const report = JSON.parse(run.stdout.toString()) as Report;
  expect(report.fixtureSha256).toBe(
    'ca8ee28a8d40ae7914a820303b96ddbbe8f06d37325b0fc2ae6f1140aea96321'
  );
  expect(
    Object.fromEntries(report.scenarios.map((scenario) => [scenario.name, scenario.work]))
  ).toEqual(EXPECTED);
}, 90_000);
