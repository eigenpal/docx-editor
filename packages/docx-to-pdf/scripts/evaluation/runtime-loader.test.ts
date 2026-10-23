/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  statSync,
  utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const loader = fileURLToPath(new URL('./runtime-loader.mjs', import.meta.url));
const repository = resolve(dirname(loader), '../../../..');
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture(extension = 'ts') {
  const root = mkdtempSync(join(tmpdir(), 'typescript-process-cache-'));
  roots.push(root);
  const source = join(root, `example.${extension}`);
  writeFileSync(source, 'export class NumberBox { constructor(public value: number = 7) {} }');
  return { root, source, cache: join(root, 'cache') };
}
function command(source: string, selectedLoader = loader) {
  return [
    'node',
    '--import',
    selectedLoader,
    '--input-type=module',
    '--eval',
    `
    const { NumberBox } = await import(${JSON.stringify(pathToFileURL(source).href)});
    const { transpileCacheStats } = await import(${JSON.stringify(pathToFileURL(selectedLoader).href)});
    console.log(JSON.stringify({value: new NumberBox().value, stats: transpileCacheStats}));
  `,
  ];
}
function run(source: string, cache: string, selectedLoader = loader) {
  const result = Bun.spawnSync(command(source, selectedLoader), {
    env: { ...process.env, DOCX_EVAL_TRANSPILE_CACHE: cache },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  return JSON.parse(result.stdout.toString()) as {
    value: number;
    stats: { hits: number; compiled: number; disabled: boolean };
  };
}

test('fresh processes reuse compiled TypeScript, MTS, and TSX modules', () => {
  for (const extension of ['ts', 'mts', 'tsx']) {
    const f = fixture(extension);
    const cold = run(f.source, f.cache);
    expect(cold.value).toBe(7);
    expect(cold.stats).toEqual({ hits: 0, compiled: 1, disabled: false });
    const warm = run(f.source, f.cache);
    expect(warm).toEqual({ value: 7, stats: { hits: 1, compiled: 0, disabled: false } });
  }
});

test('content changes invalidate compiled code even with preserved timestamps', () => {
  const f = fixture();
  run(f.source, f.cache);
  const original = readFileSync(f.source, 'utf8');
  const times = statSync(f.source);
  writeFileSync(f.source, original.replace('= 7', '= 8'));
  utimesSync(f.source, times.atime, times.mtime);
  const changed = run(f.source, f.cache);
  expect(changed.value).toBe(8);
  expect(changed.stats.compiled).toBe(1);
  writeFileSync(f.source, original);
  expect(run(f.source, f.cache).stats.compiled).toBe(0);
});

test('different compiler options cannot reuse previous output', () => {
  const f = fixture();
  run(f.source, f.cache);
  const packageRoot = join(f.root, 'compiler');
  const folder = join(packageRoot, 'scripts/evaluation');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(packageRoot, 'tsconfig.json'), JSON.stringify({ compilerOptions: {} }));
  symlinkSync(join(repository, 'node_modules'), join(packageRoot, 'node_modules'));
  const changedLoader = join(folder, 'runtime-loader.mjs');
  writeFileSync(
    changedLoader,
    readFileSync(loader, 'utf8').replace('ts.ScriptTarget.ES2022', 'ts.ScriptTarget.ES2020')
  );
  expect(run(f.source, f.cache, changedLoader).stats.compiled).toBe(1);
  expect(run(f.source, f.cache, changedLoader).stats.hits).toBe(1);
});

test('damaged and mismatched cache entries compile again', () => {
  const f = fixture();
  run(f.source, f.cache);
  const entry = join(f.cache, readdirSync(f.cache).find((name) => name.endsWith('.json'))!);
  const record = JSON.parse(readFileSync(entry, 'utf8'));
  writeFileSync(
    entry,
    JSON.stringify({ ...record, code: 'throw new Error("invalid cached code")' })
  );
  expect(run(f.source, f.cache).value).toBe(7);
  writeFileSync(entry, '{');
  expect(run(f.source, f.cache).stats.compiled).toBe(1);
  expect(run(f.source, f.cache).stats.hits).toBe(1);
});

test('unavailable cache storage does not prevent compilation', () => {
  const f = fixture();
  writeFileSync(f.cache, 'this path is a file');
  expect(run(f.source, f.cache)).toEqual({
    value: 7,
    stats: { hits: 0, compiled: 1, disabled: true },
  });
});

test('simultaneous cold processes publish complete cache entries', async () => {
  const f = fixture();
  const processes = [0, 1].map(() =>
    Bun.spawn(command(f.source), {
      env: { ...process.env, DOCX_EVAL_TRANSPILE_CACHE: f.cache },
      stdout: 'pipe',
      stderr: 'pipe',
    })
  );
  for (const child of processes) {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exitCode, stderr).toBe(0);
    expect(JSON.parse(stdout).value).toBe(7);
  }
  expect(readdirSync(f.cache).filter((name) => name.endsWith('.tmp'))).toHaveLength(0);
  expect(run(f.source, f.cache).stats.compiled).toBe(0);
});
