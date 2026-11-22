/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two editors insert content at the edges of a table of contents while the other refreshes or
// removes it. Each insert lands outside the field (after `w:fldChar w:fldCharType="end"`,
// before `w:fldChar w:fldCharType="begin"`), so both peers converge and keep it.
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { detectBodyTocs } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { reviewModule } from '../../review/review-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';

// 0: "Intro" then the field begins (offset 5); 1: closing line; 2: a heading; 3: "After".
const BODY =
  '<w:p><w:r><w:t>Intro</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\u </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Stale entry</w:t></w:r></w:p>' +
  '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
  '<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>Chapter one</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>After</w:t></w:r></w:p>';

const xml = async (editor: DocxEditorInstance) =>
  strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);

async function converge(left: DocxEditorInstance, right: DocxEditorInstance, flush: () => void) {
  flush();
  for (let attempt = 0; attempt < 200; attempt++) {
    if ((await xml(left)) === (await xml(right))) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const saved = await xml(left);
  expect(await xml(right)).toBe(saved);
  return saved;
}

/** Each field character in order, and whether a link holds it. */
function fieldShape(saved: string): string[] {
  return [...saved.matchAll(/<w:hyperlink\b|<\/w:hyperlink>|w:fldCharType="(\w+)"/g)].reduce<{
    inLink: boolean;
    out: string[];
  }>(
    (state, [match, type]) => {
      if (match === '<w:hyperlink') state.inLink = true;
      else if (match === '</w:hyperlink>') state.inLink = false;
      else state.out.push(state.inLink ? `${type} in a link` : type!);
      return state;
    },
    { inLink: false, out: [] }
  ).out;
}

test('two editors insert at both field edges during a refresh and a removal of the TOC', async () => {
  const harness = createPeerHarness('toc-field-edge-inserts');
  const editors: DocxEditorInstance[] = [];
  try {
    const pair = await harness.pair(zipDocument(BODY));
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
    for (let attempt = 0; attempt < 200 && !(left.surface && right.surface); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const flush = () => {
      pair.alice.room.session.flushPendingJournals();
      pair.bob.room.session.flushPendingJournals();
    };
    const beginId = harness.paragraphIdAt(pair.alice, 0);
    const closingId = harness.paragraphIdAt(pair.alice, 1);
    const caret = (editor: DocxEditorInstance, paragraphId: string, offset: number) =>
      editor.surface!.setSelection({
        anchor: { paragraphId, offset },
        head: { paragraphId, offset },
      });

    // Concurrent: a link on the closing line, and a footnote right before the field begins.
    pair.pause();
    caret(left, closingId, 0);
    caret(right, beginId, 5);
    expect(
      left.exec({ type: 'insertHyperlink', href: 'https://example.com/' } as never)
    ).toMatchObject({
      ok: true,
    });
    expect(right.exec({ type: 'insertNote', noteKind: 'footnote' })).toMatchObject({ ok: true });
    pair.resume();
    let saved = await converge(left, right, flush);
    expect(fieldShape(saved)).toEqual(['begin', 'separate', 'end']);
    expect(saved.indexOf('<w:footnoteReference')).toBeLessThan(
      saved.indexOf('fldCharType="begin"')
    );
    expect(saved.indexOf('<w:hyperlink')).toBeGreaterThan(saved.indexOf('fldCharType="end"'));

    // Concurrent: a bookmark at the closing line edge while the other peer refreshes the TOC.
    pair.pause();
    caret(left, closingId, 0);
    expect(left.exec({ type: 'insertBookmark', name: 'edge' })).toMatchObject({ ok: true });
    expect(right.exec({ type: 'refreshToc', mode: 'entire' })).toMatchObject({ ok: true });
    pair.resume();
    saved = await converge(left, right, flush);
    expect(saved).not.toContain('Stale entry');
    expect(saved).toContain('w:name="edge"');
    expect(saved).toContain('<w:footnoteReference');
    expect(saved).toContain('https://example.com/');
    expect(saved.indexOf('w:name="edge"')).toBeGreaterThan(saved.indexOf('fldCharType="end"'));
    for (const editor of [left, right]) {
      expect(detectBodyTocs(editor.surface!.session.part())).toHaveLength(1);
    }

    // Undo and redo of the bookmark reach the other peer.
    expect(left.exec({ type: 'undo' })).toMatchObject({ ok: true });
    saved = await converge(left, right, flush);
    expect(saved).not.toContain('w:name="edge"');
    expect(left.exec({ type: 'redo' })).toMatchObject({ ok: true });
    saved = await converge(left, right, flush);
    expect(saved).toContain('w:name="edge"');

    // The inserts survive save and reopen.
    const reopened = createDocxEditor({
      container: document.createElement('div'),
      document: await left.save(),
    });
    editors.push(reopened);
    expect(await xml(reopened)).toBe(saved);
    expect(detectBodyTocs(reopened.surface!.session.part())).toHaveLength(1);

    // Concurrent: a content control at the closing line edge while the other peer removes the TOC.
    pair.pause();
    caret(left, closingId, 0);
    expect(
      left.exec({ type: 'insertContentControl', subtype: 'plainText' } as never)
    ).toMatchObject({
      ok: true,
    });
    expect(right.exec({ type: 'removeToc' })).toMatchObject({ ok: true });
    pair.resume();
    saved = await converge(left, right, flush);
    expect(fieldShape(saved)).toEqual([]);
    expect(saved).toContain('Intro');
    expect(saved).toContain('After');
  } finally {
    for (const editor of editors) editor.destroy();
    harness.cleanup();
  }
}, 15000);

// 0: "Intro" and the begin character share a run (offset 5); 1: "Pg", the end, and "Tail" share one.
const SHARED =
  '<w:p><w:r><w:t>Intro</w:t><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\u </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/><w:t>Stale entry</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Pg</w:t><w:fldChar w:fldCharType="end"/><w:t>Tail</w:t></w:r></w:p>' +
  '<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>Chapter one</w:t></w:r></w:p>';

test('two editors insert at field edges where the field characters share runs with text', async () => {
  const harness = createPeerHarness('toc-field-edge-shared-runs');
  const editors: DocxEditorInstance[] = [];
  try {
    const pair = await harness.pair(zipDocument(SHARED));
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
    for (let attempt = 0; attempt < 200 && !(left.surface && right.surface); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const flush = () => {
      pair.alice.room.session.flushPendingJournals();
      pair.bob.room.session.flushPendingJournals();
    };
    const beginId = harness.paragraphIdAt(pair.alice, 0);
    const endId = harness.paragraphIdAt(pair.alice, 1);
    const caret = (editor: DocxEditorInstance, paragraphId: string, offset: number) =>
      editor.surface!.setSelection({
        anchor: { paragraphId, offset },
        head: { paragraphId, offset },
      });

    // A bookmark at the end edge while the other peer types in the text after it.
    pair.pause();
    caret(left, endId, 2);
    caret(right, endId, 4);
    expect(left.exec({ type: 'insertBookmark', name: 'edge' })).toMatchObject({ ok: true });
    expect(right.exec({ type: 'insertText', text: 'Q' })).toMatchObject({ ok: true });
    pair.resume();
    let saved = await converge(left, right, flush);
    expect(fieldShape(saved)).toEqual(['begin', 'separate', 'end']);
    expect(saved.indexOf('w:name="edge"')).toBeGreaterThan(saved.indexOf('fldCharType="end"'));

    // Both peers type at the same begin edge, and one also adds a footnote there.
    pair.pause();
    caret(left, beginId, 5);
    caret(right, beginId, 5);
    expect(left.exec({ type: 'insertText', text: 'L' })).toMatchObject({ ok: true });
    expect(right.exec({ type: 'insertNote', noteKind: 'footnote' })).toMatchObject({ ok: true });
    pair.resume();
    saved = await converge(left, right, flush);
    expect(fieldShape(saved)).toEqual(['begin', 'separate', 'end']);
    const begin = saved.indexOf('fldCharType="begin"');
    expect(saved.indexOf('>IntroL<')).toBeLessThan(begin);
    expect(saved.indexOf('<w:footnoteReference')).toBeLessThan(begin);

    // A refresh keeps both inserts on both peers.
    expect(right.exec({ type: 'refreshToc', mode: 'entire' })).toMatchObject({ ok: true });
    saved = await converge(left, right, flush);
    expect(saved).not.toContain('Stale entry');
    expect(saved).toContain('w:name="edge"');
    expect(saved).toContain('<w:footnoteReference');
    expect(fieldShape(saved)).toEqual(['begin', 'separate', 'end']);
  } finally {
    for (const editor of editors) editor.destroy();
    harness.cleanup();
  }
}, 15000);

// Each field character sits in a tracked insertion that also holds text on its far side.
// 0: `<w:ins>Intro` + begin`</w:ins>` (offset 5); 1: `<w:ins>Pg` + end + `Tail</w:ins>` (offset 2).
const INS = (id: number) => `<w:ins w:id="${id}" w:author="B" w:date="2026-01-01T00:00:00Z">`;
const WRAPPED =
  `<w:p>${INS(9)}<w:r><w:t>Intro</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
  '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\u </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r></w:ins><w:r><w:t>Stale entry</w:t></w:r></w:p>' +
  `<w:p>${INS(10)}<w:r><w:t>Pg</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>` +
  '<w:r><w:t>Tail</w:t></w:r></w:ins></w:p>' +
  '<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>Chapter one</w:t></w:r></w:p>';

test('two editors insert at field edges inside tracked insertions that hold text', async () => {
  const harness = createPeerHarness('toc-field-edge-wrapped');
  const editors: DocxEditorInstance[] = [];
  try {
    const pair = await harness.pair(zipDocument(WRAPPED));
    const [left, right] = [pair.alice, pair.bob].map((peer) => {
      peer.detach();
      const editor = createDocxEditor({
        container: document.createElement('div'),
        document: peer.room.document,
        modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
      });
      editors.push(editor);
      return editor;
    }) as [DocxEditorInstance, DocxEditorInstance];
    for (let attempt = 0; attempt < 200 && !(left.surface && right.surface); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const flush = () => {
      pair.alice.room.session.flushPendingJournals();
      pair.bob.room.session.flushPendingJournals();
    };
    const beginId = harness.paragraphIdAt(pair.alice, 0);
    const endId = harness.paragraphIdAt(pair.alice, 1);
    const select = (editor: DocxEditorInstance, paragraphId: string, from: number, to = from) =>
      editor.surface!.setSelection({
        anchor: { paragraphId, offset: from },
        head: { paragraphId, offset: to },
      });
    const revisionsKept = (saved: string, id: number) => {
      const copies = saved.match(new RegExp(`<w:ins [^>]*w:id="${id}"[^>]*>`, 'g')) ?? [];
      expect(copies.length).toBeGreaterThanOrEqual(1);
      for (const copy of copies) {
        expect(copy).toContain('w:author="B"');
        expect(copy).toContain('w:date="2026-01-01T00:00:00Z"');
      }
      return copies.length;
    };

    // A bookmark at the end edge while the other peer replaces the text after it.
    pair.pause();
    select(left, endId, 2);
    select(right, endId, 2, 6);
    expect(left.exec({ type: 'insertBookmark', name: 'edge' })).toMatchObject({ ok: true });
    expect(right.exec({ type: 'insertText', text: 'Q' })).toMatchObject({ ok: true });
    pair.resume();
    let saved = await converge(left, right, flush);
    expect(fieldShape(saved)).toEqual(['begin', 'separate', 'end']);
    expect(saved).not.toContain('Tail');
    expect(saved.indexOf('w:name="edge"')).toBeGreaterThan(saved.indexOf('fldCharType="end"'));
    revisionsKept(saved, 10);

    // One peer adds a footnote at the begin edge while the other types there.
    pair.pause();
    select(left, beginId, 5);
    select(right, beginId, 5);
    expect(left.exec({ type: 'insertNote', noteKind: 'footnote' })).toMatchObject({ ok: true });
    expect(right.exec({ type: 'insertText', text: 'L' })).toMatchObject({ ok: true });
    pair.resume();
    saved = await converge(left, right, flush);
    const begin = saved.indexOf('fldCharType="begin"');
    expect(saved.indexOf('<w:footnoteReference')).toBeLessThan(begin);
    expect(saved.indexOf('>L<')).toBeLessThan(begin);
    // The footnote and the typed text join the insertion they were placed in: one change.
    expect(revisionsKept(saved, 9)).toBe(1);

    // Undo and redo of the footnote reach the other peer.
    expect(left.exec({ type: 'undo' })).toMatchObject({ ok: true });
    saved = await converge(left, right, flush);
    expect(saved).not.toContain('<w:footnoteReference');
    expect(left.exec({ type: 'redo' })).toMatchObject({ ok: true });
    saved = await converge(left, right, flush);
    expect(saved.indexOf('<w:footnoteReference')).toBeLessThan(
      saved.indexOf('fldCharType="begin"')
    );

    // One peer adds an endnote at the end edge while the other accepts that insertion by id.
    pair.pause();
    select(right, endId, 2);
    expect(right.exec({ type: 'insertNote', noteKind: 'endnote' })).toMatchObject({ ok: true });
    expect(left.exec({ type: 'acceptRevision', id: 10 } as never)).toMatchObject({ ok: true });
    pair.resume();
    saved = await converge(left, right, flush);
    expect(saved).not.toMatch(/<w:ins [^>]*w:id="10"/);
    expect(saved.indexOf('<w:endnoteReference')).toBeGreaterThan(
      saved.indexOf('fldCharType="end"')
    );
    expect(fieldShape(saved)).toEqual(['begin', 'separate', 'end']);

    // A refresh keeps the inserts and the revisions on both peers, and they survive reopening.
    expect(right.exec({ type: 'refreshToc', mode: 'entire' })).toMatchObject({ ok: true });
    saved = await converge(left, right, flush);
    expect(saved).not.toContain('Stale entry');
    expect(saved).toContain('w:name="edge"');
    expect(saved).toContain('<w:footnoteReference');
    expect(fieldShape(saved)).toEqual(['begin', 'separate', 'end']);
    revisionsKept(saved, 9);
    const reopened = createDocxEditor({
      container: document.createElement('div'),
      document: await left.save(),
    });
    editors.push(reopened);
    expect(await xml(reopened)).toBe(saved);
    expect(detectBodyTocs(reopened.surface!.session.part())).toHaveLength(1);
  } finally {
    for (const editor of editors) editor.destroy();
    harness.cleanup();
  }
}, 15000);

// Each field character sits in a link that also holds text on its far side.
// 0: `<w:hyperlink>Intro` + begin`</w:hyperlink>` (offset 5); 1: `<w:hyperlink>Pg` + end + `Tail</w:hyperlink>`.
const LINK = '<w:hyperlink w:anchor="Top">';
const LINKED =
  `<w:p>${LINK}<w:r><w:t>Intro</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
  '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\u </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r></w:hyperlink><w:r><w:t>Stale entry</w:t></w:r></w:p>' +
  `<w:p>${LINK}<w:r><w:t>Pg</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>` +
  '<w:r><w:t>Tail</w:t></w:r></w:hyperlink></w:p>' +
  '<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>Chapter one</w:t></w:r></w:p>' +
  '<w:p><w:bookmarkStart w:id="1" w:name="Top"/><w:r><w:t>After</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>';

/** Each field character in order; here the links hold them by design. */
const fieldTypes = (saved: string) =>
  [...saved.matchAll(/w:fldCharType="(\w+)"/g)].map(([, type]) => type);

test('two editors insert at field edges inside links, offline, then reconnect', async () => {
  const harness = createPeerHarness('toc-field-edge-linked');
  const editors: DocxEditorInstance[] = [];
  try {
    const pair = await harness.pair(zipDocument(LINKED));
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
    for (let attempt = 0; attempt < 200 && !(left.surface && right.surface); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const flush = () => {
      pair.alice.room.session.flushPendingJournals();
      pair.bob.room.session.flushPendingJournals();
    };
    const beginId = harness.paragraphIdAt(pair.alice, 0);
    const endId = harness.paragraphIdAt(pair.alice, 1);
    const caret = (editor: DocxEditorInstance, paragraphId: string, offset: number) =>
      editor.surface!.setSelection({
        anchor: { paragraphId, offset },
        head: { paragraphId, offset },
      });

    // Both peers edit both edges while disconnected; the reconnect delivers every queued edit.
    pair.pause();
    caret(left, endId, 2);
    expect(left.exec({ type: 'insertBookmark', name: 'edge' })).toMatchObject({ ok: true });
    caret(left, beginId, 5);
    expect(left.exec({ type: 'insertNote', noteKind: 'footnote' })).toMatchObject({ ok: true });
    caret(right, endId, 2);
    expect(right.exec({ type: 'insertText', text: 'R' })).toMatchObject({ ok: true });
    caret(right, beginId, 5);
    expect(right.exec({ type: 'insertText', text: 'L' })).toMatchObject({ ok: true });
    pair.resume();
    let saved = await converge(left, right, flush);
    expect(fieldTypes(saved)).toEqual(['begin', 'separate', 'end']);
    const begin = saved.indexOf('fldCharType="begin"');
    const end = saved.indexOf('fldCharType="end"');
    expect(saved.indexOf('<w:footnoteReference')).toBeLessThan(begin);
    expect(saved.indexOf('>L<')).toBeLessThan(begin);
    expect(saved.indexOf('w:name="edge"')).toBeGreaterThan(end);
    expect(saved.indexOf('>R<')).toBeGreaterThan(end);
    // Each divided link keeps its target on both copies.
    expect(saved.match(/<w:hyperlink w:anchor="Top">/g)?.length).toBe(4);

    // Undo and redo of the footnote reach the other peer.
    expect(left.exec({ type: 'undo' })).toMatchObject({ ok: true });
    saved = await converge(left, right, flush);
    expect(saved).not.toContain('<w:footnoteReference');
    expect(left.exec({ type: 'redo' })).toMatchObject({ ok: true });
    saved = await converge(left, right, flush);
    expect(saved).toContain('<w:footnoteReference');

    // A refresh keeps the inserts on both peers, and they survive reopening.
    expect(right.exec({ type: 'refreshToc', mode: 'entire' })).toMatchObject({ ok: true });
    saved = await converge(left, right, flush);
    expect(saved).not.toContain('Stale entry');
    expect(saved).toContain('w:name="edge"');
    expect(saved).toContain('<w:footnoteReference');
    expect(saved).toContain('>R<');
    expect(fieldTypes(saved)).toEqual(['begin', 'separate', 'end']);
    const reopened = createDocxEditor({
      container: document.createElement('div'),
      document: await left.save(),
    });
    editors.push(reopened);
    expect(await xml(reopened)).toBe(saved);
    expect(detectBodyTocs(reopened.surface!.session.part())).toHaveLength(1);
  } finally {
    for (const editor of editors) editor.destroy();
    harness.cleanup();
  }
}, 15000);
