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
