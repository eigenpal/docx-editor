import { afterEach, describe, expect, test } from 'bun:test';
import { createDocxEditor } from '../docx-editor.ts';
import { createDocumentRefresh } from '../document-refresh.ts';
import { refreshHostFor } from '../document-refresh-host.ts';
import { refreshFixture, refreshMetadata } from './document-refresh-fixture.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});
function open() {
  const scroll = document.createElement('div');
  scroll.className = 'docx-editor__scroll-container';
  const container = document.createElement('div');
  scroll.append(container);
  document.body.append(scroll);
  Object.defineProperties(scroll, {
    scrollHeight: { value: 3000 },
    clientHeight: { value: 500 },
    scrollWidth: { value: 1200 },
    clientWidth: { value: 800 },
  });
  const editor = createDocxEditor({ container, document: refreshFixture() });
  const refresh = createDocumentRefresh(editor);
  disposers.push(() => {
    editor.destroy();
    scroll.remove();
  });
  return { editor, refresh, container, scroll, text: () => editor.surface?.session.bodyText() };
}

describe('external document refresh', () => {
  test('preserves the instance, subscriptions, viewport, and focus; resets undo', async () => {
    const { editor, refresh, scroll } = open();
    expect(createDocumentRefresh(editor)).toBe(refresh);
    editor.surface!.type('local');
    const submission = await refresh.capture();
    const sources: unknown[] = [];
    editor.on('change', (change) => sources.push(change.source));
    scroll.scrollTop = 900;
    scroll.scrollLeft = 80;
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    const result = await refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: refreshFixture(1),
      changes: refreshMetadata(),
    });
    expect(result.ok).toBe(true);
    expect(scroll.scrollTop).toBe(900);
    expect(scroll.scrollLeft).toBe(80);
    expect(document.activeElement).toBe(button);
    button.remove();
    expect(editor.snapshot().canUndo).toBe(false);
    expect(sources).toEqual(['refresh']);
    expect(refresh.snapshot().changes[0]?.status).toBe('available');
  });
  test('highlights leave bytes and undo unchanged, then clear on local edits', async () => {
    const { editor, refresh, container } = open();
    const submission = await refresh.capture();
    await refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: refreshFixture(1),
      changes: refreshMetadata(),
    });
    const bytes = await editor.save();
    refresh.highlightChanges();
    expect(container.querySelector('[data-docx-refresh-highlight]')).not.toBeNull();
    expect(await editor.save()).toEqual(bytes);
    expect(editor.snapshot().canUndo).toBe(false);
    refresh.clearHighlights();
    expect(container.querySelector('[data-docx-refresh-highlight]')).toBeNull();
    refresh.highlightChanges();
    editor.surface!.type('edit');
    expect(refresh.snapshot().changes).toEqual([]);
    expect(container.querySelector('[data-docx-refresh-highlight]')).toBeNull();
  });
  test('rejects local edits, including buffered input', async () => {
    const { editor, refresh, text } = open();
    const submission = await refresh.capture();
    editor.surface!.enqueueType('local');
    const result = await refresh.applyUpdate({ submission, sequence: 1, bytes: refreshFixture(1) });
    expect(result).toMatchObject({ ok: false, code: 'local-edits' });
    expect(text()).toContain('local');
  });
  test('captures buffered input with its revision', async () => {
    const { editor, refresh } = open();
    editor.surface!.enqueueType('captured');
    const submission = await refresh.capture();
    const check = createDocxEditor({
      container: document.createElement('div'),
      document: submission.bytes,
    });
    expect(check.surface!.session.bodyText()).toContain('captured');
    check.destroy();
    expect(
      (await refresh.applyUpdate({ submission, sequence: 1, bytes: refreshFixture(1) })).ok
    ).toBe(true);
  });
  test('rejects invalid bytes before tearing down the surface', async () => {
    const { editor, refresh } = open();
    const surface = editor.surface;
    const submission = await refresh.capture();
    expect(
      await refresh.applyUpdate({ submission, sequence: 1, bytes: new Uint8Array([1]) })
    ).toMatchObject({ code: 'invalid-document' });
    expect(editor.surface).toBe(surface);
  });
  test('orders cumulative results by processor sequence and identifies only new changes', async () => {
    const { refresh } = open();
    const submission = await refresh.capture();
    await refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: refreshFixture(1),
      changes: refreshMetadata(),
    });
    const second = await refresh.applyUpdate({
      submission,
      sequence: 3,
      bytes: refreshFixture(2),
      changes: refreshMetadata(2),
      failures: ['unavailable-source'],
    });
    expect(second).toMatchObject({ ok: true, failures: ['unavailable-source'] });
    expect(refresh.snapshot().changes.map((c) => c.isNew)).toEqual([false, true]);
    for (const sequence of [1, 2, 3])
      expect(
        await refresh.applyUpdate({ submission, sequence, bytes: refreshFixture(1) })
      ).toMatchObject({ code: 'out-of-order' });
  });
  test('serializes queued results and owns their byte arrays', async () => {
    const { refresh, text } = open();
    const submission = await refresh.capture();
    const bytes = refreshFixture(1);
    const first = refresh.applyUpdate({ submission, sequence: 1, bytes });
    bytes.fill(0);
    const second = refresh.applyUpdate({ submission, sequence: 2, bytes: refreshFixture(2) });
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    expect(text()).toContain('Updated review date');
  });
  test('rejects cancelled, superseded, foreign, and switched submissions', async () => {
    const { editor, refresh } = open();
    const old = await refresh.capture();
    refresh.cancel();
    expect(
      (await refresh.applyUpdate({ submission: old, sequence: 1, bytes: refreshFixture(1) })).ok
    ).toBe(false);
    const next = await refresh.capture();
    await refresh.capture();
    expect(
      (await refresh.applyUpdate({ submission: next, sequence: 1, bytes: refreshFixture(1) })).ok
    ).toBe(false);
    const other = open();
    expect(
      (await other.refresh.applyUpdate({ submission: old, sequence: 1, bytes: refreshFixture(1) }))
        .ok
    ).toBe(false);
    const switched = await refresh.capture();
    editor.load(refreshFixture(2));
    expect(
      (await refresh.applyUpdate({ submission: switched, sequence: 1, bytes: refreshFixture(1) }))
        .ok
    ).toBe(false);
  });
  test('plain replacement reports unavailable change information', async () => {
    const { refresh } = open();
    const submission = await refresh.capture();
    expect(
      await refresh.applyUpdate({ submission, sequence: 1, bytes: refreshFixture(1) })
    ).toMatchObject({ ok: true, changeInformation: 'unavailable', changes: [] });
  });
  test('reports deleted, invalid, and unavailable locations without invented highlights', async () => {
    const { refresh, container } = open();
    const submission = await refresh.capture();
    await refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: refreshFixture(1),
      changes: [
        { id: 'deleted', unavailableReason: 'deleted' },
        { id: 'unknown' },
        { id: 'invalid', location: { paragraphIndex: 12, start: 0, end: 3, text: 'bad' } },
      ],
    });
    expect(refresh.snapshot().changes.map((c) => c.status)).toEqual([
      'deleted',
      'unavailable',
      'invalid',
    ]);
    refresh.highlightChanges();
    expect(container.querySelector('[data-docx-refresh-highlight]')).toBeNull();
    expect(refresh.navigateToChange('deleted')).toBe(false);
  });
  test('preserves tracked revisions in saved and reopened bytes', async () => {
    const { editor, refresh } = open();
    const submission = await refresh.capture();
    await refresh.applyUpdate({ submission, sequence: 1, bytes: refreshFixture(1, false, true) });
    const saved = await editor.save();
    expect(readOoxmlPackage(new Uint8Array(saved)).ok).toBe(true);
    editor.load(saved);
    expect(await editor.save()).toEqual(saved);
  });
  test('blocks writes during deferred loads and restores scroll on completion', async () => {
    const { editor, refresh, scroll } = open();
    const submission = await refresh.capture();
    scroll.scrollTop = 700;
    const applying = refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: refreshFixture(1, true),
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(refresh.snapshot().phase).toBe('refreshing');
    expect(editor.snapshot().isOpening).toBe(false);
    editor.surface!.type('must not land');
    expect(editor.surface!.session.bodyText()).not.toContain('must not land');
    expect((await applying).ok).toBe(true);
    expect(scroll.scrollTop).toBe(700);
  });
  test('cancels a deferred load without replacing content', async () => {
    const { editor, refresh, text } = open();
    const submission = await refresh.capture();
    const applying = refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: refreshFixture(1, true),
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(refresh.snapshot().phase).toBe('refreshing');
    expect(editor.snapshot().isOpening).toBe(false);
    refresh.cancel();
    expect(await applying).toMatchObject({ code: 'cancelled' });
    expect(text()).not.toContain('Updated delivery');
    editor.surface!.type('works');
    expect(text()).toContain('works');
  });
  test('never restores over a later document switch', async () => {
    const { editor, refresh, text } = open();
    const submission = await refresh.capture();
    const applying = refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: refreshFixture(1, true),
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    editor.load(refreshFixture(2));
    expect(await applying).toMatchObject({ code: 'document-changed' });
    expect(text()).toContain('Updated review');
  });
  test('recovers after mount failure and reports the result identity', async () => {
    const { editor, refresh, container, scroll, text } = open();
    scroll.scrollTop = 700;
    const submission = await refresh.capture();
    const original = container.replaceChildren.bind(container);
    let failed = false;
    container.replaceChildren = (...nodes) => {
      if (nodes.length && !failed) {
        failed = true;
        scroll.scrollTop = 0;
        throw new Error('mount failed');
      }
      original(...nodes);
    };
    expect(
      await refresh.applyUpdate({ submission, sequence: 1, bytes: refreshFixture(1) })
    ).toMatchObject({
      ok: false,
      code: 'load-failed',
      recovered: true,
      resultId: `${submission.id}:1`,
    });
    expect(scroll.scrollTop).toBe(700);
    expect(text()).toContain('Project schedule');
    expect(editor.surface).not.toBeNull();
  });
  test('retains recovery bytes and supports retry after two mount failures', async () => {
    const { refresh, container } = open();
    const submission = await refresh.capture();
    const original = container.replaceChildren.bind(container);
    container.replaceChildren = (...nodes) => {
      if (nodes.length) throw new Error('mount failed');
      original(...nodes);
    };
    expect(
      await refresh.applyUpdate({ submission, sequence: 1, bytes: refreshFixture(1) })
    ).toMatchObject({ code: 'recovery-failed' });
    expect(refresh.recoveryBytes()).not.toBeNull();
    expect(refresh.snapshot().recoveryAvailable).toBe(true);
    container.replaceChildren = original;
    expect(await refresh.recover()).toBe(true);
    expect(refresh.recoveryBytes()).toBeNull();
  });
  test('refuses collaboration even when its connection is unavailable', async () => {
    const { editor, refresh } = open();
    refreshHostFor(editor).collaboration = () => true;
    await expect(refresh.capture()).rejects.toMatchObject({ code: 'collaboration' });
    editor.load(refreshFixture(1));
    expect(editor.surface!.session.bodyText()).toContain('Updated delivery');
  });
  test('notifies for refusal without letting host observers break completion', async () => {
    const { refresh } = open();
    const submission = await refresh.capture();
    const ids: string[] = [];
    refresh.onResult((result) => {
      ids.push(result.resultId);
      throw new Error('host');
    });
    refresh.subscribe(() => {
      throw new Error('host');
    });
    expect(
      (await refresh.applyUpdate({ submission, sequence: 1, bytes: refreshFixture(1) })).ok
    ).toBe(true);
    await refresh.applyUpdate({ submission, sequence: 1, bytes: refreshFixture(1) });
    expect(ids).toHaveLength(2);
  });
});
