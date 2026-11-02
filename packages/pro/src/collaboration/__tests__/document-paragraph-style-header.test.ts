/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A header style reference to a paragraph style shows the referenced paragraph's text. When
// peers edit or delete that paragraph at the same time, both replicas show the same header,
// and so do undo, redo, and a cold reopen.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { reviewModule } from '../../review/review-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('paragraph-style-header-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
  harness.cleanup();
});

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
  '<w:basedOn w:val="Normal"/></w:style></w:styles>';
const HEADER =
  `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t xml:space="preserve">Chapter: </w:t></w:r>` +
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> STYLEREF  "heading 1" </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>saved</w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:hdr>';

/** Each page's header text, joined with ` / `. */
function header(editor: Editor): string {
  return editor
    .surface!.layout()
    .pages.map((page) =>
      (page.header?.fragments ?? [])
        .flatMap((fragment) =>
          fragment.kind === 'paragraph'
            ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text))
            : []
        )
        .join('')
    )
    .join(' / ');
}

function coldHeader(editor: Editor): string {
  const cold = createDocxEditor({
    container: document.createElement('div'),
    document: editor.surface!.session.save(),
  });
  try {
    return header(cold);
  } finally {
    cold.destroy();
  }
}

const TWO_PAGES =
  '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Origins</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Body text</w:t></w:r></w:p>' +
  '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:pageBreakBefore/></w:pPr><w:r><w:t>Growth</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>More text</w:t></w:r></w:p>';

async function pair(tracked = false, content?: string) {
  const peers = await harness.pair(
    zipDocument(
      (content ??
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Origins</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>Body text</w:t></w:r></w:p>') +
        '<w:sectPr><w:headerReference w:type="default" r:id="rHeader"/>' +
        '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" ' +
        'w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>',
      {
        overrides:
          `<Override PartName="/word/header1.xml" ContentType="${WML}.header+xml"/>` +
          `<Override PartName="/word/styles.xml" ContentType="${WML}.styles+xml"/>`,
        documentRels:
          `<Relationships xmlns="${REL}">` +
          `<Relationship Id="rHeader" Type="${R}/header" Target="header1.xml"/>` +
          `<Relationship Id="rStyles" Type="${R}/styles" Target="styles.xml"/></Relationships>`,
        extraXml: { 'word/header1.xml': HEADER, 'word/styles.xml': STYLES },
      }
    )
  );
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      author: tracked ? 'Reviewer' : undefined,
      modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    if (tracked) expect(editor.exec({ type: 'setEditingMode', mode: 'suggesting' }).ok).toBe(true);
    return editor;
  }) as [Editor, Editor];
  const converged = (): string => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
    expect(header(bob)).toBe(header(alice));
    for (const editor of [alice, bob]) expect(header(editor)).toBe(coldHeader(editor));
    return header(alice);
  };
  return { alice, bob, converged, pause: peers.pause, resume: peers.resume };
}

function caret(editor: Editor, paragraph: number, offset: number): string {
  const id = editor.surface!.session.paragraphIds()[paragraph]!;
  editor.surface!.setSelection({
    anchor: { paragraphId: id, offset },
    head: { paragraphId: id, offset },
  });
  return id;
}

test('typing in the referenced heading while a peer types in the body converges', async () => {
  const { alice, bob, converged, pause, resume } = await pair();
  expect(converged()).toBe('Chapter: Origins');

  pause();
  caret(alice, 0, 'Origins'.length);
  alice.surface!.type(' revised');
  caret(bob, 1, 0);
  bob.surface!.type('New ');
  resume();
  const typed = converged();
  expect(typed).toBe('Chapter: Origins revised');

  alice.surface!.undo();
  expect(converged()).toBe('Chapter: Origins');
  alice.surface!.redo();
  expect(converged()).toBe(typed);
});

test('deleting the heading text while a peer types in it converges', async () => {
  const { alice, bob, converged, pause, resume } = await pair();
  pause();
  const id = caret(bob, 0, 0);
  bob.surface!.setSelection({
    anchor: { paragraphId: id, offset: 0 },
    head: { paragraphId: id, offset: 'Origins'.length },
  });
  bob.surface!.deleteSelection();
  caret(alice, 0, 'Origins'.length);
  alice.surface!.type('!');
  resume();
  const deleted = converged();
  expect(deleted).toBe('Chapter: !');

  bob.surface!.undo();
  expect(converged()).toBe('Chapter: Origins!');
  bob.surface!.redo();
  expect(converged()).toBe(deleted);
});

test('tracked typing in the heading shows in the header on both peers', async () => {
  const { alice, bob, converged, pause, resume } = await pair(true);
  pause();
  caret(alice, 0, 'Origins'.length);
  alice.surface!.type(' draft');
  caret(bob, 1, 0);
  bob.surface!.type('New ');
  resume();
  expect(converged()).toBe('Chapter: Origins draft');
  alice.surface!.undo();
  expect(converged()).toBe('Chapter: Origins');
});

test('peers changing paragraph styles at the same time agree on each page header', async () => {
  const { alice, bob, converged, pause, resume } = await pair(false, TWO_PAGES);
  expect(converged()).toBe('Chapter: Origins / Chapter: Growth');

  pause();
  caret(alice, 1, 0);
  expect(alice.exec({ type: 'setParagraphStyle', styleId: 'Heading1' }).ok).toBe(true);
  caret(bob, 0, 0);
  expect(bob.exec({ type: 'setParagraphStyle', styleId: 'Normal' }).ok).toBe(true);
  caret(bob, 1, 'Body text'.length);
  bob.surface!.type(' now');
  resume();
  const styled = converged();
  expect(styled).toBe('Chapter: Body text now / Chapter: Growth');

  alice.surface!.undo();
  expect(converged()).toBe('Chapter: Growth / Chapter: Growth');
  alice.surface!.redo();
  expect(converged()).toBe(styled);
});

test('deleting a whole heading paragraph while a peer types in it converges', async () => {
  const { alice, bob, converged, pause, resume } = await pair(false, TWO_PAGES);
  pause();
  const heading = caret(bob, 0, 0);
  const next = bob.surface!.session.paragraphIds()[1]!;
  bob.surface!.setSelection({
    anchor: { paragraphId: heading, offset: 0 },
    head: { paragraphId: next, offset: 0 },
  });
  bob.surface!.deleteSelection();
  caret(alice, 0, 'Origins'.length);
  alice.surface!.type(' plus');
  resume();
  const deleted = converged();

  bob.surface!.undo();
  expect(converged()).toBe('Chapter: Origins plus / Chapter: Growth');
  bob.surface!.redo();
  expect(converged()).toBe(deleted);
});
