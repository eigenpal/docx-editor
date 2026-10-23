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
  existsSync,
  chmodSync,
  realpathSync,
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
    stats: { hits: number; compiled: number; disabled: boolean; warning: string | null };
  };
}

function entries(cache: string) {
  return readdirSync(cache, { recursive: true })
    .filter((name) => name.endsWith('.json'))
    .map((name) => join(cache, name));
}

function alternateLoader(root: string, name: string, edit: (source: string) => string) {
  const packageRoot = join(root, 'compiler');
  const folder = join(packageRoot, 'scripts/evaluation');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(packageRoot, 'tsconfig.json'), JSON.stringify({ compilerOptions: {} }));
  if (!existsSync(join(packageRoot, 'node_modules'))) {
    symlinkSync(join(repository, 'node_modules'), join(packageRoot, 'node_modules'));
  }
  const path = join(folder, `${name}.mjs`);
  writeFileSync(path, edit(readFileSync(loader, 'utf8')));
  return path;
}

test('fresh processes reuse compiled TypeScript, MTS, and TSX modules', () => {
  for (const extension of ['ts', 'mts', 'tsx']) {
    const f = fixture(extension);
    const cold = run(f.source, f.cache);
    expect(cold.value).toBe(7);
    expect(cold.stats).toEqual({ hits: 0, compiled: 1, disabled: false, warning: null });
    const warm = run(f.source, f.cache);
    expect(warm).toEqual({
      value: 7,
      stats: { hits: 1, compiled: 0, disabled: false, warning: null },
    });
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
  expect(run(f.source, f.cache).stats.compiled).toBe(1);
  expect(entries(f.cache)).toHaveLength(1);
  expect(run(f.source, f.cache).stats.compiled).toBe(0);
});

test('different compiler versions and options cannot reuse previous output', () => {
  const f = fixture();
  const baseline = alternateLoader(f.root, 'baseline', (source) => source);
  run(f.source, f.cache, baseline);
  const changedLoader = alternateLoader(f.root, 'options', (source) =>
    source.replace('ts.ScriptTarget.ES2022', 'ts.ScriptTarget.ES2020')
  );
  expect(run(f.source, f.cache, changedLoader).stats.compiled).toBe(1);
  expect(run(f.source, f.cache, changedLoader).stats.hits).toBe(1);
  const changedVersion = alternateLoader(f.root, 'version', (source) =>
    source.replace('ts.version', '`${ts.version}-test-version`')
  );
  expect(run(f.source, f.cache, changedVersion).stats.compiled).toBe(1);
  expect(run(f.source, f.cache, changedVersion).stats.hits).toBe(1);
});

test('cached modules preserve aliases, relative imports, and their original source URL', () => {
  const f = fixture();
  const selected = alternateLoader(f.root, 'aliases', (source) => source);
  writeFileSync(join(f.root, 'dependency.ts'), 'export const amount = 5; export const token = {};');
  writeFileSync(join(f.root, 'other.ts'), 'export const amount = 8; export const token = {};');
  const config = join(f.root, 'compiler/tsconfig.json');
  const aliases = (target: string) =>
    JSON.stringify({ compilerOptions: { paths: { '@fixture/value': [target] } } });
  writeFileSync(config, aliases('../dependency.ts'));
  writeFileSync(
    f.source,
    `
    import { amount, token } from '@fixture/value';
    import { token as direct } from './dependency.ts';
    export class NumberBox {
      constructor(public value = amount + Number(token === direct) +
        Number(import.meta.url === ${JSON.stringify(pathToFileURL(realpathSync(f.source)).href)})) {}
    }
  `
  );
  expect(run(f.source, f.cache, selected).value).toBe(7);
  const warm = run(f.source, f.cache, selected);
  expect(warm.value).toBe(7);
  expect(warm.stats.hits).toBe(2);
  expect(warm.stats.compiled).toBe(0);
  writeFileSync(config, aliases('../other.ts'));
  const changed = run(f.source, f.cache, selected);
  expect(changed.value).toBe(9);
  expect(changed.stats.compiled).toBe(1);
});

test('damaged and mismatched cache entries compile again', () => {
  const f = fixture();
  run(f.source, f.cache);
  const entry = entries(f.cache)[0];
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
  expect(run(f.source, f.cache)).toMatchObject({
    value: 7,
    stats: { hits: 0, compiled: 1, disabled: true },
  });
});

test('an empty setting uses the default private cache', () => {
  const f = fixture();
  const child = Bun.spawnSync(command(f.source), {
    env: {
      ...process.env,
      DOCX_EVAL_TRANSPILE_CACHE: '',
      TMPDIR: f.root,
      TMP: f.root,
      TEMP: f.root,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(child.exitCode, child.stderr.toString()).toBe(0);
  expect(JSON.parse(child.stdout.toString()).stats.disabled).toBe(false);
  expect(JSON.parse(child.stdout.toString()).stats.warning).toBeNull();
  expect(existsSync(join(f.root, `docx-editor-typescript-${process.getuid?.() ?? 'user'}`))).toBe(
    true
  );
});

test('insecure cache directories produce one actionable diagnostic on stderr', () => {
  const f = fixture();
  mkdirSync(f.cache);
  chmodSync(f.cache, 0o755);
  const child = Bun.spawnSync(command(f.source), {
    env: { ...process.env, DOCX_EVAL_TRANSPILE_CACHE: f.cache },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(child.exitCode).toBe(0);
  expect(JSON.parse(child.stdout.toString()).stats.disabled).toBe(true);
  expect(JSON.parse(child.stdout.toString()).stats.warning).toContain('0700');
  expect(child.stderr.toString()).toContain('DOCX_TRANSPILE_CACHE');
  expect(child.stderr.toString()).toContain('0700');
  expect(readdirSync(f.cache)).toHaveLength(0);
});

test('cache write failures preserve output and report the configuration problem', () => {
  const f = fixture();
  run(f.source, f.cache);
  const path = entries(f.cache)[0];
  rmSync(path);
  mkdirSync(path);
  const child = Bun.spawnSync(command(f.source), {
    env: { ...process.env, DOCX_EVAL_TRANSPILE_CACHE: f.cache },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(child.exitCode).toBe(0);
  expect(JSON.parse(child.stdout.toString()).value).toBe(7);
  expect(JSON.parse(child.stdout.toString()).stats.warning).toContain('cache writes failed');
  expect(child.stderr.toString()).toContain('cache writes failed');
  expect(child.stderr.toString().match(/DOCX_TRANSPILE_CACHE/g)).toHaveLength(1);
});

test('retain eight compiler checkouts and preserve unrelated cache-directory contents', () => {
  const f = fixture();
  const unrelated = join(f.cache, `compile-${'a'.repeat(64)}`);
  mkdirSync(unrelated, { recursive: true, mode: 0o700 });
  writeFileSync(join(unrelated, 'keep.txt'), 'unrelated content');
  for (let index = 0; index < 9; index++) {
    const selected = alternateLoader(f.root, `compiler-${index}`, (source) =>
      source.replace('ts.version', `\`${'${ts.version}'}-test-${index}\``)
    );
    expect(run(f.source, f.cache, selected).stats.compiled).toBe(1);
  }
  expect(entries(f.cache)).toHaveLength(8);
  expect(readFileSync(join(unrelated, 'keep.txt'), 'utf8')).toBe('unrelated content');
}, 20000);

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
    expect(JSON.parse(stdout).stats.disabled).toBe(false);
    expect(stderr).not.toContain('DOCX_TRANSPILE_CACHE');
  }
  expect(
    readdirSync(f.cache, { recursive: true }).filter((name) => name.endsWith('.tmp'))
  ).toHaveLength(0);
  expect(run(f.source, f.cache).stats.compiled).toBe(0);
});
