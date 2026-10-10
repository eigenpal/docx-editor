import { expect, test } from 'bun:test';
import { ExportResourceError } from '@docx-editor.dev/core/export';
import { createSuccessfulValueCache, provisionWithExportDeadline } from '../src/export-deadline.ts';

test('resource deadline returns a typed timeout without waiting for stuck work', async () => {
  const never = new Promise<never>(() => {});
  try {
    await provisionWithExportDeadline(() => never, { resourceTimeoutMs: 5 });
    throw new Error('expected timeout');
  } catch (error) {
    expect(error).toBeInstanceOf(ExportResourceError);
    expect((error as ExportResourceError).code).toBe('timedOut');
  }
});

test('resource startup failures preserve their cause and typed failures pass through', async () => {
  const cause = new Error('packaged font read failed');
  try {
    await provisionWithExportDeadline(() => Promise.reject(cause), {});
    throw new Error('expected normalized failure');
  } catch (error) {
    expect(error).toBeInstanceOf(ExportResourceError);
    expect((error as ExportResourceError).code).toBe('layoutFailed');
    expect((error as Error & { cause?: unknown }).cause).toBe(cause);
  }

  const typed = new ExportResourceError('layoutFailed', 'font budget');
  await expect(provisionWithExportDeadline(() => Promise.reject(typed), {})).rejects.toBe(typed);
});

test('a failed or timed-out attempt does not poison retry and abort listeners are removed', async () => {
  const controller = new AbortController();
  const signal = controller.signal;
  const originalAdd = signal.addEventListener.bind(signal);
  const originalRemove = signal.removeEventListener.bind(signal);
  let adds = 0;
  let removes = 0;
  signal.addEventListener = ((...args: Parameters<AbortSignal['addEventListener']>) => {
    adds += 1;
    return originalAdd(...args);
  }) as AbortSignal['addEventListener'];
  signal.removeEventListener = ((...args: Parameters<AbortSignal['removeEventListener']>) => {
    removes += 1;
    return originalRemove(...args);
  }) as AbortSignal['removeEventListener'];

  await expect(
    provisionWithExportDeadline(() => Promise.reject(new Error('transient')), {
      signal,
      resourceTimeoutMs: 100,
    })
  ).rejects.toBeInstanceOf(ExportResourceError);
  await expect(
    provisionWithExportDeadline(() => Promise.resolve('ready'), {
      signal,
      resourceTimeoutMs: 100,
    })
  ).resolves.toBe('ready');
  expect(adds).toBe(2);
  expect(removes).toBe(2);
});

test('a timed-out cached attempt retries and a late older completion cannot replace success', async () => {
  const releases: Array<(value: string) => void> = [];
  const load = createSuccessfulValueCache(
    () =>
      new Promise<string>((resolve) => {
        releases.push(resolve);
      })
  );
  try {
    await provisionWithExportDeadline(load, { resourceTimeoutMs: 5 });
    throw new Error('expected first timeout');
  } catch (error) {
    expect(error).toBeInstanceOf(ExportResourceError);
    expect((error as ExportResourceError).code).toBe('timedOut');
  }

  const retry = provisionWithExportDeadline(load, { resourceTimeoutMs: 100 });
  await Promise.resolve();
  await Promise.resolve();
  expect(releases).toHaveLength(2);
  releases[1]!('new-success');
  await expect(retry).resolves.toBe('new-success');
  releases[0]!('late-old-success');
  await Promise.resolve();
  await expect(provisionWithExportDeadline(load, {})).resolves.toBe('new-success');
});

test('cold concurrent callers share one attempt and one timeout does not cancel survivors', async () => {
  let calls = 0;
  let release: ((value: string) => void) | undefined;
  const load = createSuccessfulValueCache(
    () =>
      new Promise<string>((resolve) => {
        calls += 1;
        release = resolve;
      })
  );
  const long = Array.from({ length: 50 }, () =>
    provisionWithExportDeadline(load, { resourceTimeoutMs: 200 })
  );
  const short = provisionWithExportDeadline(load, { resourceTimeoutMs: 5 });
  await expect(short).rejects.toMatchObject({ code: 'timedOut' });
  expect(calls).toBe(1);
  release?.('shared-success');
  expect(await Promise.all(long)).toEqual(Array.from({ length: 50 }, () => 'shared-success'));
  expect(calls).toBe(1);
});
