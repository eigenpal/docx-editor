/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Read-only charts in two collaborating editors: both render from the shared chart part,
// survive concurrent prose edits, undo, redo, deleting the chart while the other participant
// types, and a reconnect; the chart part saves unchanged.
import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { readOoxmlPackage, canonicalOoxmlFingerprint } from '@docx-editor.dev/core/store';
import { projectDrawingsInPackage } from '../../../../core/src/store/package/drawing-projection.ts';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { installDrawing } from '../../drawing/index.ts';

// Charts paint through the drawing module.
installDrawing();

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';

const cache = (values: readonly (string | number)[], numeric: boolean) =>
  (numeric
    ? '<c:numRef><c:f>S!B1</c:f><c:numCache><c:formatCode>General</c:formatCode>'
    : '<c:strRef><c:f>S!A1</c:f><c:strCache>') +
  `<c:ptCount val="${values.length}"/>` +
  values.map((value, index) => `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`).join('') +
  (numeric ? '</c:numCache></c:numRef>' : '</c:strCache></c:strRef>');

const CHART_PART =
  `<c:chartSpace xmlns:c="${C}" xmlns:a="${A}" xmlns:r="${R}"><c:chart>` +
  '<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>Quarterly totals</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>' +
  '<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>' +
  `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx>${cache(['Alpha'], false)}</c:tx>` +
  '<c:spPr><a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill></c:spPr>' +
  '<c:dPt><c:idx val="1"/><c:spPr><a:ln><a:solidFill><a:srgbClr val="123456"/></a:solidFill></a:ln></c:spPr></c:dPt>' +
  `<c:cat>${cache(['North', 'South'], false)}</c:cat><c:val>${cache([3, 5], true)}</c:val></c:ser>` +
  '<c:axId val="1"/><c:axId val="2"/></c:barChart>' +
  '<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>' +
  '<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="1"/></c:valAx>' +
  '</c:plotArea><c:plotVisOnly val="1"/></c:chart></c:chartSpace>';

const CHART =
  `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="4572000" cy="2743200"/>` +
  '<wp:docPr id="1" name="Chart 1"/>' +
  `<a:graphic xmlns:a="${A}"><a:graphicData uri="${C}"><c:chart xmlns:c="${C}" xmlns:r="${R}" r:id="rId10"/>` +
  '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';

function relationships(entries: readonly (readonly [string, string, string])[]): string {
  return (
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    entries
      .map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`)
      .join('') +
    '</Relationships>'
  );
}

function fixture(chartPart = CHART_PART): Uint8Array {
  const document =
    `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}"><w:body>` +
    '<w:p><w:r><w:t>Alpha paragraph</w:t></w:r></w:p>' +
    `<w:p>${CHART}</w:p>` +
    '<w:p><w:r><w:t>Omega paragraph</w:t></w:r></w:p>' +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
    '</w:body></w:document>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(relationships([['rId1', `${R}/officeDocument`, 'word/document.xml']])),
    'word/_rels/document.xml.rels': strToU8(
      relationships([['rId10', `${R}/chart`, 'charts/chart1.xml']])
    ),
    'word/document.xml': strToU8(document),
    'word/charts/chart1.xml': strToU8(chartPart),
  });
}
const FIXTURE = fixture();

async function peer(name: string, host?: { ydoc: Y.Doc }, bytes = FIXTURE) {
  const ydoc = new Y.Doc(),
    awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'chart-drawings',
    identity: { actorId: name, name },
    bootstrap: host ? { kind: 'join' } : { kind: 'create', document: bytes },
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
    // The chart part travels with the package unchanged, whatever happens to the drawing.
    expect(pkg.parts.get('/word/charts/chart1.xml')).toBeTruthy();
    const components = projectDrawingsInPackage(pkg)[0]?.vectorShape?.components ?? [];
    expect(components.filter((component) => component.fillHex === 'ABCDEF')).toHaveLength(
      drawings * 2
    );
  }
  for (const client of [a, b]) {
    expect(client.container.querySelectorAll('.docx-drawing-shape').length).toBe(drawings);
    expect(client.container.querySelectorAll('.docx-drawing-placeholder').length).toBe(0);
    expect(client.container.querySelectorAll('path[fill="#ABCDEF"]').length).toBe(drawings * 2);
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

test('two editors render a read-only chart through edits, deletion and reconnect', async () => {
  const a = await peer('Alice'),
    b = await peer('Bob', a);
  let rejoined: Peer | undefined;
  try {
    for (const client of [a, b]) {
      expect(client.container.querySelectorAll('.docx-drawing-shape').length).toBe(1);
      expect(textOf(client)).toContain('Quarterly totals');
      expect(textOf(client)).toContain('North');
    }
    caretAt(a, 0, 0);
    expect(a.editor.exec({ type: 'insertText', text: 'A' })).toMatchObject({ changed: true });
    caretAt(b, 2, 0);
    expect(b.editor.exec({ type: 'insertText', text: 'B' })).toMatchObject({ changed: true });
    sync(a, b);
    await verify(a, b, 1);
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    await verify(a, b, 1);
    expect(a.editor.exec({ type: 'redo' })).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    await verify(a, b, 1);
    // Alice deletes the chart while Bob types elsewhere.
    const chartParagraph = a.editor.surface!.session.paragraphIds()[1]!;
    a.editor.surface!.setSelection({
      anchor: { paragraphId: chartParagraph, offset: 0 },
      head: { paragraphId: chartParagraph, offset: 1 },
    });
    expect(a.editor.surface!.deleteSelection()).toBe(true);
    caretAt(b, 0, 1);
    expect(b.editor.exec({ type: 'insertText', text: ' concurrent' })).toMatchObject({
      changed: true,
    });
    sync(a, b);
    await verify(a, b, 0);
    expect(textOf(a)).not.toContain('Quarterly totals');
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    await verify(a, b, 1);
    expect(textOf(b)).toContain('Quarterly totals');
    rejoined = await peer('Rejoined', a);
    await verify(a, rejoined, 1);
    expect(textOf(rejoined)).toContain('South');
  } finally {
    rejoined?.destroy();
    a.destroy();
    b.destroy();
  }
});

test('the fixture holds the chart reference', () => {
  const files = unzipSync(FIXTURE);
  expect(strFromU8(files['word/document.xml']!)).toContain('c:chart');
});

test('two editors preserve oversized chart caches behind placeholders', async () => {
  const chartPart = CHART_PART.replaceAll('<c:ptCount val="2"/>', '<c:ptCount val="4097"/>');
  const a = await peer('Alice', undefined, fixture(chartPart));
  const b = await peer('Bob', a);
  try {
    caretAt(a, 0, 0);
    expect(a.editor.exec({ type: 'insertText', text: 'A' })).toMatchObject({ changed: true });
    caretAt(b, 2, 0);
    expect(b.editor.exec({ type: 'insertText', text: 'B' })).toMatchObject({ changed: true });
    sync(a, b);
    for (const client of [a, b]) {
      expect(client.container.querySelectorAll('.docx-drawing-placeholder').length).toBe(1);
      expect(client.container.querySelectorAll('.docx-drawing-shape').length).toBe(0);
      const reopened = await saved(client);
      expect(projectDrawingsInPackage(reopened)[0]!.vectorShape).toBeNull();
      const files = unzipSync(new Uint8Array(await client.editor.save()));
      expect(strFromU8(files['word/charts/chart1.xml']!)).toContain('<c:ptCount val="4097"/>');
    }
  } finally {
    a.destroy();
    b.destroy();
  }
});
