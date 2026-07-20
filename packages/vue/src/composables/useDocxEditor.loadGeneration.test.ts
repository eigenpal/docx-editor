import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

/**
 * Run the parser mock in a subprocess. Bun's `mock.module` is process-global
 * and cannot be safely restored, so using it in the main unit-test process
 * would leave every later parseDocx test waiting on the deferred mock.
 */
test('loadGeneration rejects stale parses across ownership transitions', async () => {
  const fixture = fileURLToPath(
    new URL('./useDocxEditor.loadGeneration.fixture.ts', import.meta.url)
  );
  const child = Bun.spawn([process.execPath, fixture], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  });
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);

  if (exitCode !== 0) throw new Error(stderr);
  expect(exitCode).toBe(0);
}, 15_000);
