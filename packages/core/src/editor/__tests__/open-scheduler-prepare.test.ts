// A large open runs in two tasks: one opens the bytes, the next mounts them.
//
// One task that parsed and laid out a long document froze the page for long enough to get it
// reported as unresponsive. These tests pin the order of the two tasks, `flush` on either side
// of the split, a failing first half, and single use of a prepared session.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { createOpenScheduler } from '../docx-editor-open-scheduler.ts';
import { prepareOpen, takePreparedOpen } from '../docx-editor-prepared-open.ts';
import { createDocxEditor } from '../docx-editor.ts';
import { docx } from './paginated-surface-fixtures.ts';

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));
const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

function recorder(options: { readonly failPrepare?: boolean } = {}) {
  const events: string[] = [];
  const scheduler = createOpenScheduler({
    mount: () => events.push('mount'),
    prepare: () => {
      events.push('prepare');
      if (options.failPrepare) throw new Error('prepare failed');
    },
    scheduled: () => events.push('scheduled'),
  });
  return { events, scheduler };
}

describe('open scheduler prepare task', () => {
  test('prepares in one task and mounts in a later one', async () => {
    const { events, scheduler } = recorder();
    scheduler.schedule(new Uint8Array(1));
    expect(events).toEqual(['scheduled']);
    await frame();
    await nextTask();
    expect(events).toEqual(['scheduled', 'prepare']);
    expect(scheduler.isScheduled()).toBe(true);
    await nextTask();
    expect(events).toEqual(['scheduled', 'prepare', 'mount']);
    expect(scheduler.isScheduled()).toBe(false);
  });

  test('flush before the prepare task mounts at once and never prepares', async () => {
    const { events, scheduler } = recorder();
    scheduler.schedule(new Uint8Array(1));
    scheduler.flush();
    await frame();
    await nextTask();
    await nextTask();
    expect(events).toEqual(['scheduled', 'mount']);
  });

  test('flush between the two tasks mounts once', async () => {
    const { events, scheduler } = recorder();
    scheduler.schedule(new Uint8Array(1));
    await frame();
    await nextTask();
    scheduler.flush();
    await nextTask();
    await nextTask();
    expect(events).toEqual(['scheduled', 'prepare', 'mount']);
  });

  test('a failing prepare still mounts, so the window cannot stay open', async () => {
    const { events, scheduler } = recorder({ failPrepare: true });
    scheduler.schedule(new Uint8Array(1));
    await frame();
    await nextTask();
    await nextTask();
    expect(events).toEqual(['scheduled', 'prepare', 'mount']);
    expect(scheduler.isScheduled()).toBe(false);
  });

  test('cancel between the two tasks drops the mount', async () => {
    const { events, scheduler } = recorder();
    const bytes = new Uint8Array(1);
    scheduler.schedule(bytes);
    await frame();
    await nextTask();
    expect(scheduler.cancel()).toBe(bytes);
    await nextTask();
    expect(events).toEqual(['scheduled', 'prepare']);
  });
});

describe('prepared open', () => {
  test('is taken once, for the exact bytes object', () => {
    const bytes = docx('<w:p><w:r><w:t>prepared</w:t></w:r></w:p>');
    prepareOpen(bytes, {});
    expect(takePreparedOpen(bytes.slice()).openedSession).toBeUndefined();
    expect(takePreparedOpen(bytes).openedSession?.ok).toBe(true);
    expect(takePreparedOpen(bytes).openedSession).toBeUndefined();
  });

  test('a mount uses the prepared session instead of opening the bytes again', () => {
    const bytes = docx('<w:p><w:r><w:t>prepared body</w:t></w:r></w:p>');
    prepareOpen(bytes, {});
    const container = document.createElement('div');
    const editor = createDocxEditor({ container, document: bytes });
    expect(takePreparedOpen(bytes).openedSession).toBeUndefined();
    expect(container.textContent).toContain('prepared body');
    editor.destroy();
  });

  test('a prepared failure reports exactly as an unprepared one', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const unprepared = createDocxEditor({
      container: document.createElement('div'),
      document: bytes,
    });
    prepareOpen(bytes, {});
    const prepared = createDocxEditor({
      container: document.createElement('div'),
      document: bytes,
    });
    expect(prepared.snapshot().parseError).toBe(unprepared.snapshot().parseError);
    expect(prepared.snapshot().parseError).not.toBeNull();
    unprepared.destroy();
    prepared.destroy();
  });
});
