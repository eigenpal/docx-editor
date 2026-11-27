/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A canvas (`wpc:wpc`) whose ellipse holds text, beside a paragraph with a bordered run
// (`w:bdr`, ECMA-376 Part 1, 17.3.2.4) and a right-to-left paragraph with one. Both peers lay the member text out in the text
// rectangle of the ellipse (`a:rect`, 20.1.9.22) and give the border its room. Typing in the
// bordered run converges, undoes, and survives a concurrent delete of the canvas and a save.
import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import {
  readOoxmlPackage,
  canonicalOoxmlFingerprint,
  serializeOoxmlPart,
} from '@docx-editor.dev/core/store';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WPC = 'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas';
const NS =
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
  `xmlns:wpc="${WPC}"`;
const EMU = 12_700;
/** The ellipse: 120pt by 72pt, at (10pt, 10pt) of the canvas, with a 2pt outline. */
const [CX, CY, AT, LINE] = [120, 72, 10, 2];

const ELLIPSE =
  '<wps:wsp><wps:cNvPr id="3" name="Ellipse"/><wps:cNvSpPr/><wps:spPr><a:xfrm>' +
  `<a:off x="${AT * EMU}" y="${AT * EMU}"/><a:ext cx="${CX * EMU}" cy="${CY * EMU}"/></a:xfrm>` +
  '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>' +
  '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>' +
  `<a:ln w="${LINE * EMU}"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></wps:spPr>` +
  '<wps:txbx><w:txbxContent><w:p><w:r><w:t>ab</w:t></w:r></w:p></w:txbxContent></wps:txbx>' +
  '<wps:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"><a:noAutofit/></wps:bodyPr>' +
  '</wps:wsp>';

const CANVAS =
  `<w:drawing ${NS}><wp:inline distT="0" distB="0" distL="0" distR="0">` +
  `<wp:extent cx="${(CX + 2 * AT) * EMU}" cy="${(CY + 2 * AT) * EMU}"/>` +
  '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="1" name="Canvas"/>' +
  `<wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="${WPC}">` +
  `<wpc:wpc><wpc:bg/><wpc:whole/>${ELLIPSE}</wpc:wpc>` +
  '</a:graphicData></a:graphic></wp:inline></w:drawing>';

const BORDER = '<w:rPr><w:bdr w:val="single" w:sz="8" w:space="2" w:color="000000"/></w:rPr>';

function fixture(): Uint8Array {
  const document =
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
    '<w:p><w:r><w:t xml:space="preserve">Alpha </w:t></w:r>' +
    `<w:r>${BORDER}<w:t>boxed</w:t></w:r><w:r><w:t xml:space="preserve"> tail</w:t></w:r></w:p>` +
    `<w:p><w:r>${CANVAS}</w:r><w:r><w:t>after</w:t></w:r></w:p>` +
    // A right-to-left paragraph: its bordered run takes its room from the right.
    '<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">שלום </w:t></w:r>' +
    `<w:r>${BORDER.replace('<w:rPr>', '<w:rPr><w:rtl/>')}<w:t>עולם</w:t></w:r>` +
    '<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve"> טוב</w:t></w:r></w:p>' +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
    '</w:body></w:document>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(document),
  });
}
const FIXTURE = fixture();

async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc(),
    awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'canvas-member-text',
    identity: { actorId: name, name },
    bootstrap: host ? { kind: 'join' } : { kind: 'create', document: FIXTURE },
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

function lines(client: Peer) {
  return client.editor
    .surface!.layout()
    .pages.flatMap((page) => page.fragments)
    .flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []));
}

/** The canvas on its line, or undefined after a delete. */
function canvas(client: Peer) {
  return lines(client).flatMap((line) => line.drawings ?? [])[0];
}

/** Where the member text and the body text sit: what both peers must agree on. */
function geometry(client: Peer) {
  const member = canvas(client)?.groupTextboxStories?.[0];
  return {
    member: member && {
      box: member.box,
      offset: member.story.contentOffset,
      width: member.story.contentWidth,
      height: member.story.contentHeight,
    },
    spans: lines(client).map((line) => line.spans.map((span) => [span.box.x, span.box.width])),
  };
}

/** Put the caret after `text` in the body. */
function caretAfter(client: Peer, text: string): void {
  const match = client.editor.findMatches(text)[0]!;
  const at = { paragraphId: match.blockId, offset: match.start + match.length };
  expect(client.editor.exec({ type: 'setSelection', range: { anchor: at, head: at } }).ok).toBe(
    true
  );
}

function type(client: Peer, after: string, text: string): void {
  caretAfter(client, after);
  expect(client.editor.exec({ type: 'insertText', text })).toMatchObject({ ok: true });
}

async function saved(client: Peer): Promise<{ fingerprint: string; xml: string }> {
  const loaded = readOoxmlPackage(new Uint8Array(await client.editor.save()));
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  return { fingerprint: canonicalOoxmlFingerprint(part), xml: serializeOoxmlPart(part) };
}

async function converged(a: Peer, b: Peer): Promise<string> {
  const [left, right] = await Promise.all([saved(a), saved(b)]);
  expect(left.fingerprint).toBe(right.fingerprint);
  expect(geometry(a)).toEqual(geometry(b));
  return left.xml;
}

test('two editors agree on canvas member text and bordered runs through concurrent edits', async () => {
  const a = await peer('Alice'),
    b = await peer('Bob', a);
  let reopened: ReturnType<typeof createDocxEditor> | undefined;
  try {
    // Both peers lay the text out in the inscribed rectangle of the ellipse, less half of the
    // outline on each side: not in the whole 120pt by 72pt box.
    const inset = (side: number) => (side / 2) * (1 - Math.SQRT1_2) + LINE / 2;
    for (const client of [a, b]) {
      const { member } = geometry(client);
      expect(member!.box).toMatchObject({ x: AT, y: AT, width: CX, height: CY });
      expect(member!.offset.x).toBeCloseTo(inset(CX), 1);
      expect(member!.offset.y).toBeCloseTo(inset(CY), 1);
      expect(member!.width).toBeCloseTo(CX - 2 * inset(CX), 1);
    }
    // The border takes its room on both peers: the text after it starts past the bordered text.
    const [, boxed, tail] = lines(a)[0]!.spans;
    expect(tail!.box.x).toBeGreaterThan(boxed!.box.x + boxed!.box.width + 2);
    await converged(a, b);

    // Alice types inside the bordered run while Bob types after the canvas.
    type(a, 'boxed', ' in');
    type(b, 'after', ' Bob');
    sync(a, b);
    const xml = await converged(a, b);
    expect(xml).toContain('boxed in');
    expect(xml).toContain('after Bob');
    // Undo and redo travel.
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
    sync(a, b);
    expect(await converged(a, b)).not.toContain('boxed in');
    expect(a.editor.exec({ type: 'redo' })).toMatchObject({ ok: true });
    sync(a, b);
    expect(await converged(a, b)).toContain('boxed in');

    // Both type in the right-to-left paragraph, Alice inside its bordered run.
    type(a, 'עולם', 'ות');
    type(b, 'טוב', ' מאוד');
    sync(a, b);
    const rtl = await converged(a, b);
    expect(rtl).toContain('עולםות');
    expect(rtl).toContain('טוב מאוד');

    // Bob deletes the canvas while Alice types in the bordered run; then he undoes the delete.
    const canvasParagraph = canvas(b)!.paragraphId;
    b.editor.surface!.setSelection({
      anchor: { paragraphId: canvasParagraph, offset: 0 },
      head: { paragraphId: canvasParagraph, offset: 1 },
    });
    expect(b.editor.exec({ type: 'deleteText' })).toMatchObject({ ok: true });
    type(a, 'boxed in', ' more');
    sync(a, b);
    const without = await converged(a, b);
    expect(without).not.toContain('<wpc:wpc>');
    expect(without).toContain('boxed in more');
    expect(b.editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
    sync(a, b);
    const restored = await converged(a, b);
    expect(restored).toContain('<wpc:wpc>');
    expect(geometry(a).member).toBeDefined();

    // A saved copy opens with the same layout.
    const container = document.createElement('div');
    document.body.append(container);
    reopened = createDocxEditor({ container, document: new Uint8Array(await a.editor.save()) });
    for (let attempt = 0; attempt < 50 && !reopened.surface; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 10));
    const again = { editor: reopened } as unknown as Peer;
    expect(geometry(again)).toEqual(geometry(a));
  } finally {
    reopened?.destroy();
    a.destroy();
    b.destroy();
  }
});
