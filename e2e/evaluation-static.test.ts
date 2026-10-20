import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { staticHarness } from './evaluation-static.ts';

test('an unrelated nonempty directory remains unchanged', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'docx-static-safety-'));
  try {
    const sentinel = resolve(directory, 'keep.txt');
    await writeFile(sentinel, 'Keep this file');
    await expect(staticHarness(directory)).rejects.toThrow('Build cache must be empty');
    expect(await readFile(sentinel, 'utf8')).toBe('Keep this file');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('static server rejects malformed and escaping paths', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'docx-static-http-'));
  await mkdir(resolve(directory, 'e2e'));
  await writeFile(resolve(directory, '.complete'), 'static-harness-v1');
  await writeFile(
    resolve(directory, 'e2e/evaluation-browser.html'),
    '<!doctype html><title>synthetic</title>'
  );
  try {
    // The repository test preload replaces Fetch globals. Exercise the native server
    // in the same clean Bun process used by the browser CLI.
    const script = `import { staticHarness } from ${JSON.stringify(resolve(import.meta.dir, 'evaluation-static.ts'))};
      const server = await staticHarness(${JSON.stringify(directory)});
      try {
        const statuses = [];
        for (const path of ['/%ZZ', '/..%2f..%2fprivate', '/']) statuses.push((await fetch(server.url + path)).status);
        console.log(JSON.stringify(statuses));
      } finally { await server.stop(); }`;
    const result = spawnSync('bun', ['-e', script], { encoding: 'utf8', timeout: 10_000 });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([400, 404, 200]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
