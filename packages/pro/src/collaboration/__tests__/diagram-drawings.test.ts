/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Read-only SmartArt drawings and drawing canvases in two collaborating editors: both render
// from the shared package, survive concurrent prose edits, undo, redo, deleting the drawing
// while the other participant types, and a reconnect; the diagram parts save unchanged.
import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { readOoxmlPackage, canonicalOoxmlFingerprint } from '@docx-editor.dev/core/store';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const DGM = 'http://schemas.openxmlformats.org/drawingml/2006/diagram';
const DSP = 'http://schemas.microsoft.com/office/drawing/2008/diagram';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPC = 'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas';

const box = (x: number, text: string) =>
  `<dsp:sp modelId="{${x}}"><dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr>` +
  `<dsp:spPr><a:xfrm><a:off x="${x}" y="0"/><a:ext cx="1200000" cy="600000"/></a:xfrm>` +
  '<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></dsp:spPr>' +
  '<dsp:style><a:lnRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:lnRef><a:fillRef idx="1"><a:scrgbClr r="0" g="0" b="0"/></a:fillRef>' +
  '<a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef><a:fontRef idx="minor"><a:srgbClr val="FFFFFF"/></a:fontRef></dsp:style>' +
  '<dsp:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/>' +
  `<a:r><a:rPr lang="en-US" sz="1800"/><a:t>${text}</a:t></a:r></a:p></dsp:txBody>` +
  `<dsp:txXfrm><a:off x="${x}" y="0"/><a:ext cx="1200000" cy="600000"/></dsp:txXfrm></dsp:sp>`;

const DIAGRAM =
  `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="2600000" cy="600000"/>` +
  '<wp:docPr id="1" name="Diagram 1"/>' +
  `<a:graphic xmlns:a="${A}"><a:graphicData uri="${DGM}">` +
  `<dgm:relIds xmlns:dgm="${DGM}" xmlns:r="${R}" r:dm="rId10" r:lo="rId11" r:qs="rId12" r:cs="rId13"/>` +
  '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';

const CANVAS =
  `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="2600000" cy="600000"/>` +
  '<wp:docPr id="2" name="Canvas 2"/>' +
  `<a:graphic xmlns:a="${A}"><a:graphicData uri="${WPC}"><wpc:wpc xmlns:wpc="${WPC}" xmlns:wps="${WPS}">` +
  '<wpc:bg/><wpc:whole/><wps:wsp><wps:cNvPr id="3" name="Box 3"/><wps:cNvSpPr/><wps:spPr>' +
  '<a:xfrm><a:off x="0" y="0"/><a:ext cx="1200000" cy="600000"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>' +
  '<a:solidFill><a:srgbClr val="DCE6F2"/></a:solidFill></wps:spPr>' +
  `<wps:txbx><w:txbxContent><w:p><w:r><w:t>Canvas text</w:t></w:r></w:p></w:txbxContent></wps:txbx>` +
  '<wps:bodyPr anchor="ctr"/></wps:wsp></wpc:wpc></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';

function relationships(entries: readonly (readonly [string, string, string])[]): string {
  return (
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    entries
      .map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`)
      .join('') +
    '</Relationships>'
  );
}

const DATA_MODEL =
  `<dgm:dataModel xmlns:dgm="${DGM}" xmlns:a="${A}"><dgm:ptLst><dgm:pt modelId="{1}" type="doc"><dgm:prSet/><dgm:spPr/></dgm:pt></dgm:ptLst><dgm:cxnLst/>` +
  `<dgm:bg/><dgm:whole/><dgm:extLst><a:ext uri="${DSP}"><dsp:dataModelExt xmlns:dsp="${DSP}" relId="rId20" minVer="${DGM}"/></a:ext></dgm:extLst></dgm:dataModel>`;
const DRAWING =
  `<dsp:drawing xmlns:dgm="${DGM}" xmlns:dsp="${DSP}" xmlns:a="${A}"><dsp:spTree>` +
  '<dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/>' +
  `${box(0, 'First step')}${box(1400000, 'Second step')}</dsp:spTree></dsp:drawing>`;

function fixture(): Uint8Array {
  const document =
    `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}"><w:body>` +
    '<w:p><w:r><w:t>Alpha paragraph</w:t></w:r></w:p>' +
    `<w:p>${DIAGRAM}</w:p>` +
    '<w:p><w:r><w:t>Omega paragraph</w:t></w:r></w:p>' +
    `<w:p>${CANVAS}</w:p>` +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
    '</w:body></w:document>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/diagrams/drawing1.xml" ContentType="application/vnd.ms-office.drawingml.diagramDrawing+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(relationships([['rId1', `${R}/officeDocument`, 'word/document.xml']])),
    'word/_rels/document.xml.rels': strToU8(
      relationships([
        ['rId10', `${R}/diagramData`, 'diagrams/data1.xml'],
        ['rId11', `${R}/diagramLayout`, 'diagrams/layout1.xml'],
        ['rId12', `${R}/diagramQuickStyle`, 'diagrams/quickStyle1.xml'],
        ['rId13', `${R}/diagramColors`, 'diagrams/colors1.xml'],
        [
          'rId20',
          'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing',
          'diagrams/drawing1.xml',
        ],
      ])
    ),
    'word/document.xml': strToU8(document),
    'word/diagrams/data1.xml': strToU8(DATA_MODEL),
    'word/diagrams/drawing1.xml': strToU8(DRAWING),
    'word/diagrams/layout1.xml': strToU8(
      `<dgm:layoutDef xmlns:dgm="${DGM}" uniqueId="urn:test/layout"/>`
    ),
    'word/diagrams/quickStyle1.xml': strToU8(
      `<dgm:styleDef xmlns:dgm="${DGM}" uniqueId="urn:test/style"/>`
    ),
    'word/diagrams/colors1.xml': strToU8(
      `<dgm:colorsDef xmlns:dgm="${DGM}" uniqueId="urn:test/colors"/>`
    ),
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
    documentId: 'diagram-drawings',
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
    room,
    editor,
    container,
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

async function saved(peer: Peer) {
  const loaded = readOoxmlPackage(new Uint8Array(await peer.editor.save()));
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

async function verify(a: Peer, b: Peer, drawings: number) {
  const [left, right] = [await saved(a), await saved(b)];
  const main = (pkg: typeof left) => pkg.parts.get(pkg.mainDocumentPart)!;
  expect(canonicalOoxmlFingerprint(main(left))).toBe(canonicalOoxmlFingerprint(main(right)));
  for (const pkg of [left, right]) {
    // The diagram parts travel with the package unchanged, whatever happens to the drawing.
    expect(pkg.parts.get('/word/diagrams/drawing1.xml')).toBeTruthy();
    expect(pkg.parts.get('/word/diagrams/data1.xml')).toBeTruthy();
  }
  for (const client of [a, b]) {
    expect(client.container.querySelectorAll('.docx-drawing-shape').length).toBe(drawings);
    expect(client.container.querySelectorAll('.docx-drawing-placeholder').length).toBe(0);
  }
}

function textOf(peer: Peer): string {
  return [...peer.container.querySelectorAll('.docx-drawing-group-text')]
    .map((layer) => layer.textContent ?? '')
    .join('|');
}

function caretAt(client: Peer, paragraph: number, offset: number) {
  const id = client.editor.surface!.session.paragraphIds()[paragraph]!;
  expect(
    client.editor.surface!.setSelection({
      anchor: { paragraphId: id, offset },
      head: { paragraphId: id, offset },
    })
  ).not.toBe(false);
}

test('two editors render read-only diagrams and canvases through edits, deletion and reconnect', async () => {
  const a = await peer('Alice'),
    b = await peer('Bob', a);
  let rejoined: Peer | undefined;
  try {
    for (const client of [a, b]) {
      expect(client.container.querySelectorAll('.docx-drawing-shape').length).toBe(2);
      expect(textOf(client)).toContain('First step');
      expect(textOf(client)).toContain('Second step');
      expect(textOf(client)).toContain('Canvas text');
    }
    // Concurrent prose edits around the drawings.
    caretAt(a, 0, 0);
    expect(a.editor.exec({ type: 'insertText', text: 'A' })).toMatchObject({ changed: true });
    caretAt(b, 2, 0);
    expect(b.editor.exec({ type: 'insertText', text: 'B' })).toMatchObject({ changed: true });
    sync(a, b);
    await verify(a, b, 2);
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    await verify(a, b, 2);
    expect(a.editor.exec({ type: 'redo' })).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    await verify(a, b, 2);
    // Alice deletes the diagram's paragraph content while Bob types elsewhere.
    const diagramParagraph = a.editor.surface!.session.paragraphIds()[1]!;
    a.editor.surface!.setSelection({
      anchor: { paragraphId: diagramParagraph, offset: 0 },
      head: { paragraphId: diagramParagraph, offset: 1 },
    });
    expect(a.editor.surface!.deleteSelection()).toBe(true);
    caretAt(b, 0, 1);
    expect(b.editor.exec({ type: 'insertText', text: ' concurrent' })).toMatchObject({
      changed: true,
    });
    sync(a, b);
    await verify(a, b, 1);
    expect(textOf(a)).not.toContain('First step');
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    await verify(a, b, 2);
    expect(textOf(b)).toContain('First step');
    rejoined = await peer('Rejoined', a);
    await verify(a, rejoined, 2);
    expect(textOf(rejoined)).toContain('Second step');
  } finally {
    rejoined?.destroy();
    a.destroy();
    b.destroy();
  }
});

test('the fixture opens with both drawings painted', () => {
  const files = unzipSync(FIXTURE);
  expect(strFromU8(files['word/document.xml']!)).toContain('dgm:relIds');
});
