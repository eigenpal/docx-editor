import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

const scenarios = {
  headers: 'retries a request that stalls before its headers',
  body: 'retries a request whose response body stalls',
  timeouts: 'fails after three timed-out attempts',
  transport: 'fails after three transport errors',
  http: 'retries HTTP errors',
  length: 'does not retry a byte-length mismatch',
  hash: 'does not retry a hash mismatch',
};

for (const [scenario, description] of Object.entries(scenarios)) {
  test(
    description,
    () => {
      // Keep native networking APIs, isolated from the shared DOM preload.
      const result = Bun.spawnSync({
        cmd: [
          process.execPath,
          '--tsconfig-override',
          fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
          fileURLToPath(new URL('./catalog-bytes.fixture.ts', import.meta.url)),
          scenario,
        ],
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect({ exitCode: result.exitCode, error: result.stderr.toString() }).toEqual({
        exitCode: 0,
        error: '',
      });
    },
    10_000
  );
}
