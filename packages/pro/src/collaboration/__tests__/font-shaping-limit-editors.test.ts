/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { beforeAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import {
  initializeHarfBuzz,
  HarfBuzzShapingError,
  linesOf,
  sha256FontBytes,
} from '@docx-editor.dev/core/layout';
import type { EditorFontError, FontConfiguration } from '@docx-editor.dev/core/contracts/editor';
import { paragraphTextOf } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

beforeAll(async () => {
  await initializeHarfBuzz();
});
test('real shared editors keep byte-limit diagnostics local through edits and one facade destruction', async () => {
  const bytes = new Uint8Array(16 * 1024 * 1024 + 1);
  bytes.set(
    readFileSync(
      new URL(
        '../../../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf',
        import.meta.url
      )
    )
  );
  const configuration: FontConfiguration = {
    epoch: 1,
    maxFontBytes: 64 * 1024 * 1024,
    sources: [
      {
        request: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
        id: 'public-peer-padded-dejavu',
        bytes,
        hash: sha256FontBytes(bytes),
        faceIndex: 0,
      },
    ],
    defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 28 },
  };
  const harness = createPeerHarness('font-shaping-limit-real-editors');
  const views: { editor: DocxEditorInstance; container: HTMLElement; errors: EditorFontError[] }[] =
    [];
  const mount = (peer: Peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.append(container);
    const errors: EditorFontError[] = [];
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
      fonts: configuration,
      onFontError: (error) => errors.push(error),
    });
    const view = { editor, container, errors };
    views.push(view);
    return view;
  };
  const source = zipDocument(
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="DejaVu Sans" w:hAnsi="DejaVu Sans"/><w:sz w:val="28"/></w:rPr><w:t>AB</w:t></w:r></w:p>'
  );
  const xml = async (editor: DocxEditorInstance) =>
    strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
  try {
    const { alice, bob, pause, resume } = await harness.pair(source);
    const left = mount(alice),
      right = mount(bob);
    for (let n = 0; n < 200; n++) {
      if (
        views.every(
          (view) =>
            !view.editor.fontMeasurement().resolving &&
            view.errors.some(
              (error) =>
                error.cause instanceof HarfBuzzShapingError && error.cause.code === 'fontOverLimit'
            )
        )
      )
        break;
      if (n === 199) throw Error('Real peer font resolution did not reach execution refusal');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(
      left.errors.filter(
        (error) =>
          error.cause instanceof HarfBuzzShapingError && error.cause.code === 'fontOverLimit'
      )
    ).toHaveLength(1);
    expect(
      right.errors.filter(
        (error) =>
          error.cause instanceof HarfBuzzShapingError && error.cause.code === 'fontOverLimit'
      )
    ).toHaveLength(1);
    expect(await xml(left.editor)).toBe(await xml(right.editor));
    expect(JSON.stringify(alice.awareness.getLocalState())).not.toContain('fontOverLimit');
    const id = harness.paragraphIdAt(alice, 0);
    const select = (editor: DocxEditorInstance, offset: number, end = offset) =>
      editor.exec({
        type: 'setSelection',
        range: { anchor: { paragraphId: id, offset }, head: { paragraphId: id, offset: end } },
      });
    pause();
    select(left.editor, 0);
    select(right.editor, 2);
    expect(left.editor.exec({ type: 'insertText', text: 'L' }).ok).toBe(true);
    expect(right.editor.exec({ type: 'insertText', text: 'R' }).ok).toBe(true);
    resume();
    harness.expectConverged(alice, bob);
    expect(await xml(left.editor)).toBe(await xml(right.editor));
    const geometry = (editor: DocxEditorInstance) =>
      linesOf(editor.surface!.layout()).map((line) => ({
        box: line.box,
        spans: line.spans.map((span) => ({ text: span.text, range: span.range, box: span.box })),
      }));
    expect(geometry(left.editor)).toEqual(geometry(right.editor));
    const text = (editor: DocxEditorInstance) =>
      paragraphTextOf(editor.surface!.session.part(), id);
    const expectShared = async (expected: string) => {
      harness.expectConverged(alice, bob);
      expect(text(left.editor)).toBe(expected);
      expect(text(right.editor)).toBe(expected);
      expect(await xml(left.editor)).toBe(await xml(right.editor));
      expect(geometry(left.editor)).toEqual(geometry(right.editor));
      for (const view of [left, right]) {
        expect(
          view.errors.filter(
            (error) =>
              error.cause instanceof HarfBuzzShapingError && error.cause.code === 'fontOverLimit'
          )
        ).toHaveLength(1);
      }
      expect(JSON.stringify(alice.awareness.getLocalState())).not.toContain('fontOverLimit');
      expect(JSON.stringify(bob.awareness.getLocalState())).not.toContain('fontOverLimit');
    };
    await expectShared('LABR');
    expect(left.editor.exec({ type: 'undo' }).ok).toBe(true);
    await expectShared('ABR');
    expect(left.editor.exec({ type: 'redo' }).ok).toBe(true);
    await expectShared('LABR');
    pause();
    select(left.editor, 1, 3);
    select(right.editor, 2);
    expect(left.editor.exec({ type: 'deleteText' }).ok).toBe(true);
    expect(right.editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
    resume();
    await expectShared('LXR');
    left.editor.destroy();
    left.container.remove();
    select(right.editor, 3);
    expect(right.editor.exec({ type: 'insertText', text: 'C' }).ok).toBe(true);
    harness.expectConverged(alice, bob);
    expect(paragraphTextOf(right.editor.surface!.session.part(), id)).toBe('LXRC');
    expect(JSON.stringify(bob.awareness.getLocalState())).not.toContain('fontOverLimit');
  } finally {
    for (const view of views) {
      view.editor.destroy();
      view.container.remove();
    }
    harness.cleanup();
  }
}, 10000);
