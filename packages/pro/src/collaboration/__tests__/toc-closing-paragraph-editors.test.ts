/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { detectBodyTocs } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

const closing =
  '<w:p><w:pPr><w:spacing w:line="360" w:lineRule="exact"/></w:pPr>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
const field =
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve"> TOC </w:instrText>' +
  '<w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Cached entry</w:t></w:r></w:p>' +
  closing;
const following =
  '<w:p><w:r><w:t>ABCD</w:t></w:r></w:p>' +
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>' +
  '<w:tr><w:tc><w:p><w:r><w:t>Following table</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error('Collaborative editors did not converge');
}

function geometry(editor: DocxEditorInstance) {
  const firstPage = editor.surface!.layout().pages[0]!;
  const second = firstPage.fragments[1];
  const close =
    second?.kind === 'paragraph' &&
    second.lines.every((line) => line.spans.every((span) => !span.text))
      ? second
      : undefined;
  const table = firstPage.fragments.find((fragment) => fragment.kind === 'table');
  return { closing: close?.box.height, tableTop: table?.box.y };
}

async function closingLineScenario(documentBody: string, room: string) {
  const harness = createPeerHarness(room);
  const views: { editor: DocxEditorInstance; container: HTMLElement }[] = [];
  const mount = (peer?: Peer, bytes?: Uint8Array) => {
    peer?.detach();
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: peer?.room.document ?? bytes!,
      ...(peer ? { modules: [collaborationModule({ session: peer.room.session })] } : {}),
    });
    const view = { editor, container };
    views.push(view);
    return view;
  };
  try {
    const pair = await harness.pair(zipDocument(documentBody));
    const left = mount(pair.alice);
    const right = mount(pair.bob);
    await until(() => !!left.editor.surface && !!right.editor.surface);
    const id = harness.paragraphIdAt(pair.alice, 2);
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
    const shared = async (expected: string) => {
      flush();
      const wholeWord = new RegExp(`(?:^|[^A-Z])${expected}(?:$|[^A-Z])`);
      await until(() =>
        [left, right].every((view) => wholeWord.test(view.editor.surface!.session.bodyText()))
      );
      expect(geometry(left.editor)).toEqual(geometry(right.editor));
      expect(geometry(left.editor).closing ?? 0).toBeGreaterThan(0);
    };

    await shared('ABCD');
    pair.pause();
    select(left.editor, 0);
    select(right.editor, 4);
    expect(left.editor.exec({ type: 'insertText', text: 'L' }).ok).toBe(true);
    expect(right.editor.exec({ type: 'insertText', text: 'R' }).ok).toBe(true);
    flush();
    pair.resume();
    await shared('LABCDR');
    expect(left.editor.exec({ type: 'undo' }).ok).toBe(true);
    await shared('ABCDR');
    expect(left.editor.exec({ type: 'redo' }).ok).toBe(true);
    await shared('LABCDR');

    select(right.editor, 3);
    applyAwarenessUpdate(
      pair.alice.awareness,
      encodeAwarenessUpdate(pair.bob.awareness, [pair.bob.awareness.clientID]),
      'test-provider'
    );
    const caret = left.container.querySelector<HTMLElement>('.docx-remote-caret');
    expect(caret).not.toBeNull();
    expect(Number.isFinite(parseFloat(caret!.style.top))).toBe(true);

    pair.pause();
    select(left.editor, 1, 3);
    select(right.editor, 2);
    expect(left.editor.exec({ type: 'deleteText' }).ok).toBe(true);
    expect(right.editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
    flush();
    pair.resume();
    await shared('LXCDR');
    const saved = new Uint8Array(await left.editor.save());
    const documentXml = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['word/document.xml']!);
    expect(documentXml(saved)).toBe(documentXml(new Uint8Array(await right.editor.save())));
    expect(documentXml(saved)).toContain('w:fldCharType="end"');
    const cold = mount(undefined, saved);
    await until(() => !!cold.editor.surface);
    expect(cold.editor.surface!.session.bodyText()).toContain('LXCDR');
    expect(geometry(cold.editor)).toEqual(geometry(left.editor));
  } finally {
    for (const view of views) {
      view.editor.destroy();
      view.container.remove();
    }
    harness.cleanup();
  }
}

test(
  'two editors keep a separate TOC end mark during concurrent changes and after a cold save',
  () => closingLineScenario(field + following, 'standalone-toc-closing-paragraph'),
  10000
);

test(
  'two editors keep the end mark line of a TOC inside a content control',
  () =>
    closingLineScenario(
      `<w:sdt><w:sdtPr/><w:sdtContent>${field}</w:sdtContent></w:sdt>${following}`,
      'content-control-toc-closing-paragraph'
    ),
  10000
);

for (const [shape, toc] of [
  ['bare field', field],
  ['content control', `<w:sdt><w:sdtPr/><w:sdtContent>${field}</w:sdtContent></w:sdt>`],
] as const)
  test(`two editors type on the closing line and join the next paragraph into it (${shape})`, async () => {
    const harness = createPeerHarness(`toc-closing-line-edits-${shape.replace(' ', '-')}`);
    const editors: DocxEditorInstance[] = [];
    const containers: HTMLElement[] = [];
    try {
      const pair = await harness.pair(zipDocument(toc + following));
      const [left, right] = [pair.alice, pair.bob].map((peer) => {
        peer.detach();
        const container = document.createElement('div');
        document.body.append(container);
        containers.push(container);
        const editor = createDocxEditor({
          container,
          document: peer.room.document,
          modules: [collaborationModule({ session: peer.room.session })],
        });
        editors.push(editor);
        return editor;
      }) as [DocxEditorInstance, DocxEditorInstance];
      await until(() => !!left.surface && !!right.surface);
      const closingId = harness.paragraphIdAt(pair.alice, 1);
      const nextId = harness.paragraphIdAt(pair.alice, 2);
      const caret = (editor: DocxEditorInstance, paragraphId: string, offset: number) =>
        editor.surface!.setSelection({
          anchor: { paragraphId, offset },
          head: { paragraphId, offset },
        });
      const converge = async (text: string) => {
        pair.alice.room.session.flushPendingJournals();
        pair.bob.room.session.flushPendingJournals();
        await until(() => [left, right].every((e) => e.surface!.session.bodyText().includes(text)));
        for (const editor of [left, right]) {
          expect(detectBodyTocs(editor.surface!.session.part())[0]?.endParagraphId).toBe(closingId);
        }
        expect(left.surface!.session.bodyText()).toBe(right.surface!.session.bodyText());
        expect(geometry(left)).toEqual(geometry(right));
      };

      // Concurrent typing after the end mark and in the next paragraph.
      pair.pause();
      caret(left, closingId, 0);
      caret(right, nextId, 0);
      expect(left.exec({ type: 'insertText', text: 'Z' }).ok).toBe(true);
      expect(right.exec({ type: 'insertText', text: 'Q' }).ok).toBe(true);
      pair.resume();
      await converge('QABCD');
      expect(left.surface!.session.bodyText()).toContain('Z');
      expect(left.exec({ type: 'undo' }).ok).toBe(true);
      await converge('QABCD');
      expect(right.surface!.session.bodyText()).not.toContain('Z');
      expect(geometry(right).closing ?? 0).toBeGreaterThan(0);

      // Shift+Up from the next paragraph selects onto the closing line; the other peer paints it.
      caret(right, nextId, 2);
      right.surface!.navigate('up', true);
      expect(right.surface!.state().selection.head).toEqual({ paragraphId: closingId, offset: 0 });
      expect(right.can({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
      applyAwarenessUpdate(
        pair.alice.awareness,
        encodeAwarenessUpdate(pair.bob.awareness, [pair.bob.awareness.clientID]),
        'test-provider'
      );
      await until(() => !!containers[0]!.querySelector('.docx-remote-selection-rect'));

      // Backspace joins the next paragraph into the closing line while the other peer types in it.
      pair.pause();
      caret(right, nextId, 0);
      right.surface!.deleteBackward();
      expect(right.surface!.state().lastRejection).toBeNull();
      caret(left, nextId, 5);
      expect(left.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
      pair.resume();
      await converge('QABCDX');
      expect(harness.paragraphIdAt(pair.bob, 1)).toBe(closingId);
      const reopened = createDocxEditor({
        container: document.createElement('div'),
        document: await left.save(),
      });
      editors.push(reopened);
      expect(reopened.surface!.session.bodyText()).toBe(left.surface!.session.bodyText());
      expect(detectBodyTocs(reopened.surface!.session.part())).toHaveLength(1);

      // A section break on the closing line reaches the other peer and keeps the field.
      caret(left, closingId, 0);
      expect(left.exec({ type: 'insertBreak', kind: 'section' })).toMatchObject({ ok: true });
      pair.alice.room.session.flushPendingJournals();
      await until(
        () =>
          right.surface!.session.paragraphIds().length ===
          left.surface!.session.paragraphIds().length
      );
      for (const editor of [left, right]) {
        expect(detectBodyTocs(editor.surface!.session.part())).toHaveLength(1);
      }
      const xml = async (editor: DocxEditorInstance) =>
        strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
      expect(await xml(right)).toBe(await xml(left));
    } finally {
      for (const editor of editors) editor.destroy();
      for (const container of containers) container.remove();
      harness.cleanup();
    }
  }, 10000);

const outlined =
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve"> TOC \\o "1-3" \\u </w:instrText>' +
  '<w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Stale entry</w:t></w:r></w:p>' +
  closing +
  '<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>Chapter one</w:t></w:r></w:p>';

for (const mode of ['pageNumbers', 'entire'] as const)
  test(`a section break on the empty closing line converges with a concurrent ${mode} refresh`, async () => {
    const harness = createPeerHarness(`toc-closing-line-section-break-${mode}`);
    const editors: DocxEditorInstance[] = [];
    try {
      const pair = await harness.pair(zipDocument(outlined + following));
      const [left, right] = [pair.alice, pair.bob].map((peer) => {
        peer.detach();
        const editor = createDocxEditor({
          container: document.createElement('div'),
          document: peer.room.document,
          modules: [collaborationModule({ session: peer.room.session })],
        });
        editors.push(editor);
        return editor;
      }) as [DocxEditorInstance, DocxEditorInstance];
      await until(() => !!left.surface && !!right.surface);
      const closingId = harness.paragraphIdAt(pair.alice, 1);
      left.surface!.setSelection({
        anchor: { paragraphId: closingId, offset: 0 },
        head: { paragraphId: closingId, offset: 0 },
      });
      pair.pause();
      expect(left.exec({ type: 'insertBreak', kind: 'section' })).toMatchObject({ ok: true });
      expect(right.exec({ type: 'refreshToc', mode })).toMatchObject({ ok: true });
      pair.alice.room.session.flushPendingJournals();
      pair.bob.room.session.flushPendingJournals();
      pair.resume();
      const xml = async (editor: DocxEditorInstance) =>
        strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
      await until(
        () =>
          left.surface!.session.paragraphIds().length ===
          right.surface!.session.paragraphIds().length
      );
      for (let attempt = 0; attempt < 50 && (await xml(left)) !== (await xml(right)); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(await xml(right)).toBe(await xml(left));
      expect(await xml(left)).toMatch(/<w:sectPr[ >]/);
      // The refresh ran: an entire refresh replaced the stale entry on both peers.
      if (mode === 'entire') expect(await xml(left)).not.toContain('Stale entry');
      for (const editor of [left, right]) {
        expect(detectBodyTocs(editor.surface!.session.part())).toHaveLength(1);
      }
      const reopened = createDocxEditor({
        container: document.createElement('div'),
        document: await left.save(),
      });
      editors.push(reopened);
      expect(detectBodyTocs(reopened.surface!.session.part())).toHaveLength(1);
    } finally {
      for (const editor of editors) editor.destroy();
      harness.cleanup();
    }
  }, 10000);

const joined =
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve"> TOC </w:instrText>' +
  '<w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Cached entry</w:t></w:r></w:p>' +
  '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t>Heading</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>After</w:t></w:r></w:p>';

test('a table on a closing line with a heading lands after it on both peers, beside a concurrent edit', async () => {
  const harness = createPeerHarness('toc-closing-line-table');
  const editors: DocxEditorInstance[] = [];
  try {
    const pair = await harness.pair(zipDocument(joined));
    const [left, right] = [pair.alice, pair.bob].map((peer) => {
      peer.detach();
      const editor = createDocxEditor({
        container: document.createElement('div'),
        document: peer.room.document,
        modules: [collaborationModule({ session: peer.room.session })],
      });
      editors.push(editor);
      return editor;
    }) as [DocxEditorInstance, DocxEditorInstance];
    await until(() => !!left.surface && !!right.surface);
    const closingId = harness.paragraphIdAt(pair.alice, 1);
    const caret = (editor: DocxEditorInstance, offset: number) =>
      editor.surface!.setSelection({
        anchor: { paragraphId: closingId, offset },
        head: { paragraphId: closingId, offset },
      });
    caret(left, 0);
    caret(right, 7);
    pair.pause();
    expect(left.exec({ type: 'insertTable', rows: 1, cols: 1 })).toMatchObject({ ok: true });
    expect(right.exec({ type: 'insertText', text: 's' })).toMatchObject({ ok: true });
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
    pair.resume();
    const xml = async (editor: DocxEditorInstance) =>
      strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
    for (let attempt = 0; attempt < 100 && (await xml(left)) !== (await xml(right)); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const saved = await xml(left);
    expect(await xml(right)).toBe(saved);
    expect(saved.indexOf('<w:tbl>')).toBeGreaterThan(saved.indexOf('Headings'));
    expect(saved.indexOf('<w:tbl>')).toBeLessThan(saved.indexOf('After'));
    // Undo removes the table on its peer, and the other peer follows.
    expect(left.exec({ type: 'undo' })).toMatchObject({ ok: true });
    pair.alice.room.session.flushPendingJournals();
    for (let attempt = 0; attempt < 100 && (await xml(right)).includes('<w:tbl>'); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(await xml(right)).not.toContain('<w:tbl>');
    expect(await xml(right)).toContain('Headings');
    for (const editor of [left, right]) {
      expect(detectBodyTocs(editor.surface!.session.part())).toHaveLength(1);
      expect(editor.exec({ type: 'refreshToc', mode: 'pageNumbers' })).toMatchObject({ ok: true });
    }
  } finally {
    for (const editor of editors) editor.destroy();
    harness.cleanup();
  }
}, 10000);
