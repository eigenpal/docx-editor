/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The scenario replaces `@docx-editor.dev/fonts-cjk` with a missing package, and the export
// remembers the lookup for its process. A child process keeps both away from every other test
// file, including a serial run that shares one process.
test('exports without the CJK package installed', () => {
  const run = spawnSync(process.execPath, ['test', './test/isolated/cjk-font-absent.isolated.ts'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
    timeout: 120_000,
  });
  const output = `${run.stdout}\n${run.stderr}`;
  expect(run.status, output).toBe(0);
  expect(output).toMatch(/\b2 pass\b/);
  expect(output).toMatch(/\b0 fail\b/);
});
