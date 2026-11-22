/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, REL, R, W, zipDocument, type Peer } from './document-peer-support.ts';

let registeredDom = false;
beforeAll(() => {
  if (typeof document !== 'undefined') return;
  GlobalRegistrator.register();
  registeredDom = true;
});
afterAll(() => {
  if (registeredDom) GlobalRegistrator.unregister();
});

const style = '<w:rPr><w:rStyle w:val="37"/></w:rPr>';
const body =
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> TOC \\h </w:instrText><w:fldChar w:fldCharType="separate"/></w:r></w:p>' +
  '<w:p><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="4800"/></w:tabs></w:pPr>' +
  '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText> HYPERLINK \\l "_TocAlpha" </w:instrText><w:fldChar w:fldCharType="separate"/></w:r>' +
  '<w:r>' +
  style +
  '<w:t>Entry</w:t></w:r><w:r><w:tab/><w:t>1</w:t><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
  // A second row links through a `w:hyperlink` element, so a peer can edit inside the link.
  '<w:p><w:hyperlink w:anchor="_TocAlpha"><w:r>' +
  style +
  '<w:t>Second</w:t></w:r><w:r>' +
  style +
  '<w:tab/><w:t>2</w:t></w:r></w:hyperlink></w:p>' +
  '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
  '<w:p><w:r><w:t>Before</w:t></w:r><w:hyperlink w:anchor="_TocAlpha">' +
  '<w:r>' +
  style +
  '<w:t>Outside</w:t></w:r></w:hyperlink></w:p>' +
  '<w:p><w:bookmarkStart w:id="1" w:name="_TocAlpha"/><w:r><w:t>Target</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>';
const styles =
  '<w:styles xmlns:w="' +
  W +
  '"><w:style w:type="character" w:styleId="37">' +
  '<w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style></w:styles>';
const source = zipDocument(body, {
  overrides:
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
  documentRels:
    '<Relationships xmlns="' +
    REL +
    '"><Relationship Id="style" Type="' +
    R +
    '/styles" Target="styles.xml"/></Relationships>',
  extraXml: { 'word/styles.xml': styles },
});

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Collaborative editors did not converge');
}

function spansOf(editor: DocxEditorInstance) {
  return editor
    .surface!.layout()
    .pages.flatMap((page) =>
      page.fragments.flatMap((fragment) =>
        fragment.kind === 'paragraph' ? fragment.lines.flatMap((line) => line.spans) : []
      )
    );
}

/** TOC link texts keep the link and paint without the Hyperlink style; the outside link keeps it. */
function verifyLinkRow(editor: DocxEditorInstance, texts: readonly string[]) {
  const spans = spansOf(editor);
  for (const text of texts) {
    const span = spans.find((candidate) => candidate.text === text);
    expect({ text, href: span?.link?.href, ...span?.style }).toMatchObject({
      text,
      href: '#_TocAlpha',
      color: null,
      underline: null,
    });
  }
  expect(spans.find((span) => span.text === 'Outside')!.style).toMatchObject({
    color: '0563C1',
    underline: { variant: 'single' },
  });
}

function verifyToc(editor: DocxEditorInstance) {
  const spans = spansOf(editor);
  const entry = spans.find((span) => span.text === 'Entry')!;
  expect(entry.style.underline).toBeNull();
  expect(entry.link?.href).toBe('#_TocAlpha');
  expect(spans.find((span) => span.tabLeader === 'dot')!.style.underline).toBeNull();
  expect(spans.find((span) => span.text === 'Outside')!.style).toMatchObject({
    color: '0563C1',
    underline: { variant: 'single' },
  });
}

test('two editors keep TOC link formatting and navigation after edits and reopen', async () => {
  const harness = createPeerHarness('toc-numbered-hyperlink');
  const opened: { container: HTMLElement; editor: DocxEditorInstance }[] = [];
  const open = (peer?: Peer, saved?: Uint8Array) => {
    peer?.detach();
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: peer?.room.document ?? saved!,
      ...(peer ? { modules: [collaborationModule({ session: peer.room.session })] } : {}),
    });
    opened.push({ container, editor });
    return editor;
  };
  try {
    const pair = await harness.pair(source);
    const left = open(pair.alice);
    const right = open(pair.bob);
    await until(() => !!left.surface && !!right.surface);
    [left, right].forEach(verifyToc);
    const paragraphId = harness.paragraphIdAt(pair.alice, 4);
    pair.pause();
    for (const [editor, offset, text] of [
      [left, 0, 'L'],
      [right, 3, 'R'],
    ] as const) {
      const point = { paragraphId, offset };
      expect(editor.exec({ type: 'setSelection', range: { anchor: point, head: point } }).ok).toBe(
        true
      );
      expect(editor.exec({ type: 'insertText', text }).ok).toBe(true);
    }
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
    pair.resume();
    await until(() =>
      [left, right].every((editor) =>
        editor.surface!.session.bodyText().includes('LBefRoreOutside')
      )
    );
    const saved = new Uint8Array(await left.save());
    const xml = strFromU8(unzipSync(saved)['word/document.xml']!);
    expect(xml).toBe(
      strFromU8(unzipSync(new Uint8Array(await right.save()))['word/document.xml']!)
    );
    expect(xml).toContain('w:val="37"');
    const reopened = open(undefined, saved);
    await until(() => !!reopened.surface);
    [left, right, reopened].forEach(verifyToc);
  } finally {
    for (const { editor, container } of opened) {
      editor.destroy();
      container.remove();
    }
    harness.cleanup();
  }
}, 10_000);

test('a remote delete and split inside a TOC link row keep the row unstyled for both editors', async () => {
  const harness = createPeerHarness('toc-link-row-remote-edit');
  const opened: { container: HTMLElement; editor: DocxEditorInstance }[] = [];
  const open = (peer?: Peer, saved?: Uint8Array) => {
    peer?.detach();
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: peer?.room.document ?? saved!,
      ...(peer ? { modules: [collaborationModule({ session: peer.room.session })] } : {}),
    });
    opened.push({ container, editor });
    return editor;
  };
  const xmlOf = async (editor: DocxEditorInstance) =>
    strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
  try {
    const pair = await harness.pair(source);
    // A headless peer, such as an agent, edits the row: the editor keeps TOC rows read-only.
    const agent = await harness.join(pair.alice, 'agent');
    const left = open(pair.alice);
    const right = open(pair.bob);
    const converged = async (text: string) => {
      await until(() =>
        [left, right].every((editor) => editor.surface!.session.bodyText().includes(text))
      );
      expect(await xmlOf(left)).toBe(await xmlOf(right));
    };
    await until(() => !!left.surface && !!right.surface);
    const row = harness.paragraphIdAt(agent, 2);
    const point = { paragraphId: row, offset: 2 };
    expect(left.exec({ type: 'setSelection', range: { anchor: point, head: point } }).ok).toBe(
      true
    );
    expect(left.exec({ type: 'splitParagraph' })).toMatchObject({ ok: false });
    [left, right].forEach((editor) => verifyLinkRow(editor, ['Second']));

    // The agent deletes a letter and splits the link while the right editor types elsewhere.
    const before = harness.paragraphIdAt(pair.alice, 4);
    pair.pause();
    harness.apply(agent, [
      { op: 'deleteText', paragraphId: row, start: 1, end: 2 },
      { op: 'splitParagraph', paragraphId: row, offset: 2 },
    ]);
    const typed = { paragraphId: before, offset: 0 };
    expect(right.exec({ type: 'setSelection', range: { anchor: typed, head: typed } }).ok).toBe(
      true
    );
    expect(right.exec({ type: 'insertText', text: 'R' }).ok).toBe(true);
    pair.bob.room.session.flushPendingJournals();
    pair.resume();
    await converged('Sc\nond');
    expect(right.surface!.session.bodyText()).toContain('RBeforeOutside');
    [left, right].forEach((editor) => verifyLinkRow(editor, ['Sc', 'ond']));

    // Undo and redo of the agent's step reach both editors.
    expect(agent.room.session.undo()).toBe(true);
    await converged('Second');
    [left, right].forEach((editor) => verifyLinkRow(editor, ['Second']));
    expect(agent.room.session.redo()).toBe(true);
    await converged('Sc\nond');
    [left, right].forEach((editor) => verifyLinkRow(editor, ['Sc', 'ond']));

    const saved = new Uint8Array(await left.save());
    const reopened = open(undefined, saved);
    await until(() => !!reopened.surface);
    verifyLinkRow(reopened, ['Sc', 'ond']);
    verifyToc(reopened);
  } finally {
    for (const { editor, container } of opened) {
      editor.destroy();
      container.remove();
    }
    harness.cleanup();
  }
}, 10_000);
