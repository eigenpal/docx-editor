/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A numbered paragraph that holds only a section break shows no list number and does not
// advance the count (`w:pPr/w:sectPr`, `CT_SectPr`, ECMA-376 Part 1, 17.6.18; `w:numPr`,
// `CT_NumPr`, 17.3.1.19). Peers that give it content, or take the content away, must agree on
// every number.
import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { strToU8, zipSync } from 'fflate';
import { Awareness } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { readOoxmlPackage, canonicalOoxmlFingerprint } from '@docx-editor.dev/core/store';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const PAGE =
  '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>';
const heading = (text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const mark = `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:sectPr><w:type w:val="nextPage"/>${PAGE}</w:sectPr></w:pPr></w:p>`;

function thesisDocx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        `<Override PartName="/word/document.xml" ContentType="${WML}.document.main+xml"/>` +
        `<Override PartName="/word/styles.xml" ContentType="${WML}.styles+xml"/>` +
        `<Override PartName="/word/numbering.xml" ContentType="${WML}.numbering+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rS" Type="${R}/styles" Target="styles.xml"/>` +
        `<Relationship Id="rN" Type="${R}/numbering" Target="numbering.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(
      `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>' +
        '<w:pPr><w:numPr><w:numId w:val="1"/></w:numPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>'
    ),
    'word/numbering.xml': strToU8(
      `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/>` +
        '<w:numFmt w:val="decimal"/><w:lvlText w:val="Chapter %1"/><w:suff w:val="space"/></w:lvl></w:abstractNum>' +
        '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${heading('One')}${mark}${heading('Two')}${mark}${heading('Three')}<w:sectPr>${PAGE}</w:sectPr></w:body></w:document>`
    ),
  });
}

async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc(),
    awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'section-mark-numbering',
    identity: { actorId: name, name },
    bootstrap: host ? { kind: 'join' } : { kind: 'create', document: thesisDocx() },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: room.document,
    modules: [collaborationModule({ session: room.session })],
  });
  return {
    ydoc,
    editor,
    destroy() {
      editor.destroy();
      container.remove();
      room.destroy();
      awareness.destroy();
      ydoc.destroy();
    },
  };
}
type Peer = Awaited<ReturnType<typeof peer>>;

function sync(a: Peer, b: Peer) {
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc, Y.encodeStateVector(b.ydoc)), 'relay');
  Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc, Y.encodeStateVector(a.ydoc)), 'relay');
}

function caret(client: Peer, index: number, offset: number) {
  const surface = client.editor.surface!;
  const paragraphId = surface.session.paragraphIds()[index]!;
  expect(
    surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } })
  ).not.toBe(false);
}

interface ParagraphLike {
  readonly kind: string;
  readonly marker?: { readonly text: string };
  readonly lines: readonly { readonly spans: readonly { readonly text: string }[] }[];
}
function markers(client: Peer): string[] {
  return client.editor
    .surface!.layout()
    .pages.flatMap((page) => page.fragments as readonly ParagraphLike[])
    .filter((fragment) => fragment.kind === 'paragraph')
    .map(
      (fragment) =>
        `[${fragment.marker?.text ?? ''}]${fragment.lines.flatMap((line) => line.spans.map((span) => span.text)).join('')}`
    );
}

async function fingerprint(client: Peer) {
  const loaded = readOoxmlPackage(new Uint8Array(await client.editor.save()));
  if (!loaded.ok) throw new Error(loaded.reason);
  return canonicalOoxmlFingerprint(loaded.package.parts.get(loaded.package.mainDocumentPart)!);
}

async function converged(a: Peer, b: Peer, expected: readonly string[]) {
  expect(await fingerprint(a)).toBe(await fingerprint(b));
  expect(markers(a)).toEqual([...expected]);
  expect(markers(b)).toEqual([...expected]);
}

const BARE = ['[Chapter 1]One', '[]', '[Chapter 2]Two', '[]', '[Chapter 3]Three'];

test('two editors agree on the numbers when a section-break paragraph gains or loses content', async () => {
  const a = await peer('Alice'),
    b = await peer('Bob', a);
  let rejoined: Peer | undefined;
  try {
    await converged(a, b, BARE);

    // Alice types into the first mark while Bob types into the last chapter.
    caret(a, 1, 0);
    expect(a.editor.exec({ type: 'insertText', text: 'X' })).toMatchObject({ ok: true });
    caret(b, 4, 0);
    expect(b.editor.exec({ type: 'insertText', text: 'Z' })).toMatchObject({ ok: true });
    sync(a, b);
    const typed = ['[Chapter 1]One', '[Chapter 2]X', '[Chapter 3]Two', '[]', '[Chapter 4]ZThree'];
    await converged(a, b, typed);

    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    const undone = ['[Chapter 1]One', '[]', '[Chapter 2]Two', '[]', '[Chapter 3]ZThree'];
    await converged(a, b, undone);
    expect(a.editor.exec({ type: 'redo' })).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    await converged(a, b, typed);

    // Bob deletes the typed text while Alice types into the second mark.
    const surface = b.editor.surface!;
    const paragraphId = surface.session.paragraphIds()[1]!;
    expect(
      surface.setSelection({
        anchor: { paragraphId, offset: 0 },
        head: { paragraphId, offset: 1 },
      })
    ).not.toBe(false);
    expect(surface.deleteSelection()).toBe(true);
    caret(a, 3, 0);
    expect(a.editor.exec({ type: 'insertText', text: 'Y' })).toMatchObject({ ok: true });
    sync(a, b);
    const swapped = ['[Chapter 1]One', '[]', '[Chapter 2]Two', '[Chapter 3]Y', '[Chapter 4]ZThree'];
    await converged(a, b, swapped);

    rejoined = await peer('Rejoined', a);
    expect(await fingerprint(rejoined)).toBe(await fingerprint(a));
    expect(markers(rejoined)).toEqual(swapped);
  } finally {
    rejoined?.destroy();
    b.destroy();
    a.destroy();
  }
});
