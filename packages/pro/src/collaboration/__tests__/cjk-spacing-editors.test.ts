/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error('The shared text and spacing did not converge');
}

test('automatic inter-script spacing follows two-peer edits, carets, history, and a cold save', async () => {
  const harness = createPeerHarness('automatic-cjk-spacing');
  const views: { editor: DocxEditorInstance; container: HTMLElement }[] = [];
  const mount = (peer: Peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    const view = { editor, container };
    views.push(view);
    return view;
  };
  const parts = async (editor: DocxEditorInstance) =>
    unzipSync(new Uint8Array(await editor.save()));
  const geometry = (editor: DocxEditorInstance) =>
    editor
      .surface!.layout()
      .pages.flatMap((page) =>
        page.fragments.flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []))
      )
      .filter((line) => line.spans.length)
      .map((line) => ({
        text: line.spans.map((span) => span.text).join(''),
        spans: line.spans.map((span) => ({ text: span.text, range: span.range, box: span.box })),
        gaps: line.spans
          .slice(1)
          .map(
            (span, index) => span.box.x - line.spans[index]!.box.x - line.spans[index]!.box.width
          ),
      }));
  try {
    const pair = await harness.pair(
      zipDocument('<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>1汉2</w:t></w:r></w:p>', {
        overrides: '<Override PartName="/opaque.bin" ContentType="application/octet-stream"/>',
        extraXml: { 'opaque.bin': 'preserved-cjk-payload' },
      })
    );
    const left = mount(pair.alice),
      right = mount(pair.bob);
    await until(() => views.every((view) => !!view.editor.surface));
    const leftSession = left.editor.surface!.session,
      rightSession = right.editor.surface!.session;
    const id = harness.paragraphIdAt(pair.alice, 0);
    const select = (editor: DocxEditorInstance, start: number, end = start) =>
      editor.exec({
        type: 'setSelection',
        range: {
          anchor: { paragraphId: id, offset: start },
          head: { paragraphId: id, offset: end },
        },
      });
    const flush = () => {
      pair.alice.room.session.flushPendingJournals();
      pair.bob.room.session.flushPendingJournals();
    };
    const shared = async (expected: string, automaticGaps: number) => {
      flush();
      await until(() =>
        views.every((view) => view.editor.surface!.session.bodyText() === expected)
      );
      const first = geometry(left.editor),
        second = geometry(right.editor);
      expect(first).toEqual(second);
      expect(first.map((line) => line.text).join('')).toBe(expected);
      const gaps = first.flatMap((line) => line.gaps).filter((value) => value > 0.001);
      expect(gaps).toHaveLength(automaticGaps);
      // No fonts are admitted here. Only the fixed forward quarter-em gap applies.
      for (const gap of gaps) expect(gap).toBeCloseTo(2.75, 8);
      for (const line of first)
        for (const span of line.spans) {
          expect(span.text).toBe(expected.slice(span.range.start, span.range.end));
        }
      const a = await parts(left.editor),
        b = await parts(right.editor);
      expect(strFromU8(a['word/document.xml']!)).toBe(strFromU8(b['word/document.xml']!));
      expect(strFromU8(a['opaque.bin']!)).toBe('preserved-cjk-payload');
      expect(left.editor.surface!.session).toBe(leftSession);
      expect(right.editor.surface!.session).toBe(rightSession);
    };
    // Warm both layout caches before the first shared change.
    await shared('1汉2', 1);
    pair.pause();
    select(left.editor, 0);
    select(right.editor, 3);
    expect(left.editor.exec({ type: 'insertText', text: 'A' }).ok).toBe(true);
    expect(right.editor.exec({ type: 'insertText', text: 'B' }).ok).toBe(true);
    flush();
    pair.resume();
    await shared('A1汉2B', 1);
    expect(left.editor.exec({ type: 'undo' }).ok).toBe(true);
    await shared('1汉2B', 1);
    expect(left.editor.exec({ type: 'redo' }).ok).toBe(true);
    await shared('A1汉2B', 1);
    select(right.editor, 2);
    applyAwarenessUpdate(
      pair.alice.awareness,
      encodeAwarenessUpdate(pair.bob.awareness, [pair.bob.awareness.clientID]),
      'test-provider'
    );
    const caret = left.container.querySelector<HTMLElement>('.docx-remote-caret');
    expect(caret).not.toBeNull();
    expect(Number.isFinite(parseFloat(caret!.style.left))).toBe(true);
    expect(parseFloat(caret!.style.height)).toBeGreaterThan(0);
    pair.pause();
    select(left.editor, 1, 3);
    select(right.editor, 2);
    expect(left.editor.exec({ type: 'deleteText' }).ok).toBe(true);
    expect(right.editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
    flush();
    pair.resume();
    // Removing the only East Asian character must remove warm automatic advances.
    await shared('AX2B', 0);
    select(left.editor, 2);
    expect(left.editor.exec({ type: 'insertText', text: '汉' }).ok).toBe(true);
    await shared('AX汉2B', 1);
    const saved = new Uint8Array(await left.editor.save());
    const container = document.createElement('div');
    document.body.append(container);
    const cold = createDocxEditor({ container, document: saved });
    try {
      await until(() => !!cold.surface);
      expect(cold.surface!.session.bodyText()).toBe('AX汉2B');
      expect(cold.snapshot().canUndo).toBe(false);
      const offsets = (value: ReturnType<typeof geometry>) =>
        value.map((line) => ({
          ...line,
          spans: line.spans.map(({ range, ...span }) => ({
            ...span,
            range: { start: range.start, end: range.end },
          })),
        }));
      expect(offsets(geometry(cold))).toEqual(offsets(geometry(left.editor)));
      expect(strFromU8((await parts(cold))['opaque.bin']!)).toBe('preserved-cjk-payload');
    } finally {
      cold.destroy();
      container.remove();
    }
  } finally {
    for (const view of views) {
      view.editor.destroy();
      view.container.remove();
    }
    harness.cleanup();
  }
}, 10000);
