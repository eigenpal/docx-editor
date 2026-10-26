/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { docx, paragraph } from '../../test/fixture.ts';

for (const runtime of ['bun', 'node'] as const)
  test(`${runtime} worker isolates documents and continues after an invalid input`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'layout-worker-'));
    let worker: ReturnType<typeof Bun.spawn> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const first = join(dir, 'first.docx');
      const second = join(dir, 'second.docx');
      const bad = join(dir, 'bad.docx');
      await writeFile(first, docx(paragraph('Alpha document')));
      await writeFile(second, docx(paragraph('Beta document')));
      await writeFile(bad, 'invalid');
      const command =
        runtime === 'bun'
          ? ['bun', '--tsconfig-override', new URL('../../tsconfig.json', import.meta.url).pathname]
          : ['node', '--import', new URL('./runtime-loader.mjs', import.meta.url).pathname];
      const child = Bun.spawn(
        [...command, new URL('./layout-worker.ts', import.meta.url).pathname],
        {
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
          // Exercise cold compilation without sharing cache state with other tests.
          env: { ...process.env, DOCX_EVAL_TRANSPILE_CACHE: join(dir, 'compile-cache') },
        }
      );
      worker = child;
      // Node compiles the source dependency graph before processing any requests.
      // Keep a bounded startup allowance on contended CI workers.
      deadline = setTimeout(() => child.kill(), 45_000);
      const streams = Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      const paths = [first, bad, second, first];
      for (const [index, input] of paths.entries())
        child.stdin.write(JSON.stringify({ input, output: join(dir, `${index}.json`) }) + '\n');
      child.stdin.end();
      const [output, stderr, exitCode] = await streams;
      expect(exitCode, `${runtime} worker failed or exceeded 45 seconds: ${stderr}`).toBe(0);
      expect(
        output
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line).status)
      ).toEqual(['laid-out', 'error', 'laid-out', 'laid-out']);
      for (const [index, expected] of [
        [0, 'Alpha document'],
        [2, 'Beta document'],
        [3, 'Alpha document'],
      ] as const) {
        const result = JSON.parse(await readFile(join(dir, `${index}.json`), 'utf8'));
        expect(
          result.text.pages[0].lines.map((line: { text: string }) => line.text).join(' ')
        ).toBe(expected);
        expect(result.pageCount).toBe(1);
      }
    } finally {
      clearTimeout(deadline);
      if (worker) {
        worker.kill();
        await worker.exited;
      }
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
