// Spawned-harness lifecycle safety (task 5.3 / 4.7).

import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const lifecycleUrl = pathToFileURL(join(packageRoot, 'scripts/a11y-harness-lifecycle.mjs')).href;

describe('a11y harness spawned lifecycle', () => {
  test('startup wait failure stops tracked spawned child in finally', async () => {
    const { runWithOptionalSpawnedHarness } = await import(lifecycleUrl);
    const stops = [];
    const fakeHandle = {
      spawned: true,
      child: { exitCode: null, signalCode: null, kill: () => {} },
      pid: 9001,
    };

    await expect(
      runWithOptionalSpawnedHarness(
        {
          url: 'http://127.0.0.1:5999/',
          cwd: packageRoot,
          port: 5999,
          probeTimeoutMs: 1,
          startupTimeoutMs: 1,
          spawnHarness: () => fakeHandle,
          waitFor: async () => {
            throw new Error('harness server did not start');
          },
          stop: async (handle) => {
            stops.push(handle);
            return { action: 'stopped', pid: handle.pid };
          },
        },
        async () => {
          throw new Error('task should not run');
        }
      )
    ).rejects.toThrow('harness server did not start');

    expect(stops).toEqual([fakeHandle]);
  });

  test('signal handler awaits stop before exit with conventional code', async () => {
    const { createSpawnedHarnessSignalHandlers } = await import(lifecycleUrl);
    const events = [];
    const fakeHandle = {
      spawned: true,
      child: { exitCode: null, signalCode: null, kill: () => {} },
      pid: 9002,
    };
    let releaseStop = () => {};
    const stopGate = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });

    const signals = createSpawnedHarnessSignalHandlers(() => fakeHandle, {
      stop: async (handle) => {
        events.push('stop-start');
        await stopGate;
        events.push('stop-done');
        return { action: 'stopped', pid: handle.pid };
      },
      exit: (code) => {
        events.push(`exit:${code}`);
      },
    });

    signals.install();
    const pending = signals.handleSignal('SIGINT');
    await Promise.resolve();
    expect(events).toEqual(['stop-start']);
    releaseStop();
    await pending;
    signals.remove();

    expect(events).toEqual(['stop-start', 'stop-done', 'exit:130']);
  });

  test('repeated signals stop and exit only once', async () => {
    const { createSpawnedHarnessSignalHandlers } = await import(lifecycleUrl);
    const stops = [];
    const exits = [];
    const fakeHandle = {
      spawned: true,
      child: { exitCode: null, signalCode: null, kill: () => {} },
      pid: 9004,
    };

    const signals = createSpawnedHarnessSignalHandlers(() => fakeHandle, {
      stop: async (handle) => {
        stops.push(handle);
        return { action: 'stopped', pid: handle.pid };
      },
      exit: (code) => {
        exits.push(code);
      },
    });

    signals.install();
    await Promise.all([signals.handleSignal('SIGINT'), signals.handleSignal('SIGTERM')]);
    signals.remove();

    expect(stops).toHaveLength(1);
    expect(exits).toEqual([130]);
  });

  test('signal handler skips cleanup when no spawned handle (reused server)', async () => {
    const { createSpawnedHarnessSignalHandlers } = await import(lifecycleUrl);
    const stops = [];
    const exits = [];

    const signals = createSpawnedHarnessSignalHandlers(() => null, {
      stop: async (handle) => {
        stops.push(handle);
        return { action: 'stopped' };
      },
      exit: (code) => {
        exits.push(code);
      },
    });

    signals.install();
    await signals.handleSignal('SIGTERM');
    signals.remove();

    expect(stops).toEqual([]);
    expect(exits).toEqual([143]);
  });

  test('removed signal handlers do not stop pre-existing server on later signal', async () => {
    const { createSpawnedHarnessSignalHandlers } = await import(lifecycleUrl);
    const stops = [];
    const fakeHandle = {
      spawned: true,
      child: { exitCode: null, signalCode: null, kill: () => {} },
      pid: 9003,
    };

    const signals = createSpawnedHarnessSignalHandlers(() => fakeHandle, {
      stop: async (handle) => {
        stops.push(handle);
        return { action: 'stopped' };
      },
      exit: () => {},
    });

    signals.install();
    signals.remove();
    await signals.handleSignal('SIGINT');

    expect(stops).toEqual([]);
  });

  test('stop waits for harness unavailability after child exit before resolving', async () => {
    const { stopSpawnedHarnessServer } = await import(lifecycleUrl);
    const events = [];
    let releaseWait = () => {};
    const waitGate = new Promise<void>((resolve) => {
      releaseWait = resolve;
    });
    const handle = {
      spawned: true,
      child: { exitCode: 0, signalCode: null, kill: () => {} },
      pid: 9005,
      baseUrl: 'http://127.0.0.1:5998/',
    };

    const pending = stopSpawnedHarnessServer(handle, {
      waitForUnavailable: async (url) => {
        events.push(`wait-start:${url}`);
        await waitGate;
        events.push('wait-done');
      },
    });

    await Promise.resolve();
    expect(events).toEqual(['wait-start:http://127.0.0.1:5998/']);

    let resolved = false;
    pending.then(() => {
      resolved = true;
    });
    await sleep(20);
    expect(resolved).toBe(false);

    releaseWait();
    await pending;
    expect(events).toEqual(['wait-start:http://127.0.0.1:5998/', 'wait-done']);
    expect(resolved).toBe(true);
  });

  test('stop fails clearly when harness stays reachable after child exit', async () => {
    const { stopSpawnedHarnessServer } = await import(lifecycleUrl);
    const handle = {
      spawned: true,
      child: { exitCode: 0, signalCode: null, kill: () => {} },
      pid: 9006,
      port: 5997,
    };

    await expect(
      stopSpawnedHarnessServer(handle, {
        releaseTimeoutMs: 100,
        waitForUnavailable: async (url, timeoutMs) => {
          await sleep(timeoutMs);
          throw new Error(`harness server still reachable after stop: ${url}`);
        },
      })
    ).rejects.toThrow('harness server still reachable after stop: http://127.0.0.1:5997/');
  });
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
