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

test('reusable worker isolates documents and continues after an invalid input', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'layout-worker-'));
  try {
    const first = join(dir, 'first.docx');
    const second = join(dir, 'second.docx');
    const bad = join(dir, 'bad.docx');
    await writeFile(first, docx(paragraph('Alpha document')));
    await writeFile(second, docx(paragraph('Beta document')));
    await writeFile(bad, 'invalid');
    const worker = Bun.spawn(['bun', '--tsconfig-override', new URL('../../tsconfig.json', import.meta.url).pathname,
      new URL('./layout-worker.ts', import.meta.url).pathname], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    const paths = [first, bad, second, first];
    for (const [index, input] of paths.entries())
      worker.stdin.write(JSON.stringify({ input, output: join(dir, `${index}.json`) }) + '\n');
    worker.stdin.end();
    const output = await new Response(worker.stdout).text();
    expect(await worker.exited).toBe(0);
    expect(output.trim().split('\n').map((line) => JSON.parse(line).status)).toEqual(['laid-out', 'error', 'laid-out', 'laid-out']);
    for (const [index, expected] of [[0, 'Alpha document'], [2, 'Beta document'], [3, 'Alpha document']] as const) {
      const result = JSON.parse(await readFile(join(dir, `${index}.json`), 'utf8'));
      expect(result.text.pages[0].lines.map((line: {text: string}) => line.text).join(' ')).toBe(expected);
      expect(result.pageCount).toBe(1);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
