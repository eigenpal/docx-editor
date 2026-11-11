/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Chart insert and chart edits in two collaborating editors: each command (`insertChart`,
// `setChartData`, `setChartType`, `setChartFormat`, `setChartColor`) reaches the other
// participant, concurrent edits converge, undo and redo travel, a deletion while the other
// participant edits the chart converges, a rejoined participant gets the chart, and the saved
// files agree.
import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPackage,
  type OoxmlPackage,
} from '@docx-editor.dev/core/store';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { installDrawing } from '../../drawing/index.ts';

installDrawing();

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function fixture(): Uint8Array {
  const document =
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
    '<w:p><w:r><w:t>Alpha paragraph</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Omega paragraph</w:t></w:r></w:p>' +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
    '</w:body></w:document>';
  const rels = (body: string) =>
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      rels(`<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>`)
    ),
    'word/_rels/document.xml.rels': strToU8(rels('')),
    'word/document.xml': strToU8(document),
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
    documentId: 'chart-editing',
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
    editor: editor as DocxEditorInstance,
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

async function saved(client: Peer): Promise<OoxmlPackage> {
  const loaded = readOoxmlPackage(new Uint8Array(await client.editor.save()));
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

const chartParts = (pkg: OoxmlPackage) =>
  [...pkg.parts.keys()].filter((name) => /^\/word\/charts\/chart\d+\.xml$/.test(name)).sort();

/** Both saved files have the same main part and the same chart parts. */
async function converged(a: Peer, b: Peer): Promise<OoxmlPackage> {
  const [left, right] = [await saved(a), await saved(b)];
  expect(canonicalOoxmlFingerprint(left.parts.get(left.mainDocumentPart)!)).toBe(
    canonicalOoxmlFingerprint(right.parts.get(right.mainDocumentPart)!)
  );
  expect(chartParts(left)).toEqual(chartParts(right));
  for (const name of chartParts(left))
    expect(canonicalOoxmlFingerprint(left.parts.get(name)!)).toBe(
      canonicalOoxmlFingerprint(right.parts.get(name)!)
    );
  return left;
}

/** The node id of the first chart drawing that `client` shows. */
function chartId(client: Peer): string {
  const part = client.editor.surface!.session.currentPackage().parts.get('/word/document.xml')!;
  const walk = (node: { kind: string; id?: string; children?: readonly unknown[] }): string[] =>
    node.kind === 'textValue'
      ? []
      : [
          ...(node.kind === 'drawing' && node.id ? [node.id] : []),
          ...((node.children ?? []) as (typeof node)[]).flatMap(walk),
        ];
  const id = walk(part.root as never)[0];
  if (!id) throw new Error('no chart drawing');
  return id;
}

function caretAt(client: Peer, paragraph: number, offset: number) {
  const id = client.editor.surface!.session.paragraphIds()[paragraph]!;
  client.editor.surface!.setSelection({
    anchor: { paragraphId: id, offset },
    head: { paragraphId: id, offset },
  });
}

function format(client: Peer) {
  const read = client.editor.query({ type: 'chartFormat', drawingNodeId: chartId(client) });
  if (!read.ok) throw new Error(read.reason);
  return read.format;
}

function data(client: Peer) {
  const read = client.editor.query({ type: 'chartData', drawingNodeId: chartId(client) });
  if (!read.ok) throw new Error(read.reason);
  return read.data;
}

test('each chart command reaches the other editor, converges, and survives undo and rejoin', async () => {
  const a = await peer('Alice'),
    b = await peer('Bob', a);
  let rejoined: Peer | undefined;
  try {
    caretAt(a, 0, 5);
    expect(a.editor.exec({ type: 'insertChart', chartType: 'columnClustered' }).ok).toBe(true);
    caretAt(b, 1, 0);
    expect(b.editor.exec({ type: 'insertText', text: 'B ' })).toMatchObject({ changed: true });
    sync(a, b);
    const inserted = await converged(a, b);
    expect(chartParts(inserted)).toHaveLength(1);
    expect(data(b).series).toHaveLength(3);

    // Concurrent edits of the same chart: Bob's data and Alice's title both land.
    const id = chartId(b);
    const before = data(b);
    expect(
      b.editor.exec({
        type: 'setChartData',
        drawingNodeId: id,
        data: {
          kind: before.kind,
          categories: before.categories,
          series: before.series.map((s, i) => (i === 0 ? { ...s, values: [9, 9, 9, 9] } : s)),
        },
      }).ok
    ).toBe(true);
    expect(
      a.editor.exec({
        type: 'setChartFormat',
        drawingNodeId: chartId(a),
        format: { title: 'Totals' },
      }).ok
    ).toBe(true);
    sync(a, b);
    await converged(a, b);
    for (const client of [a, b]) {
      expect(format(client).title).toBe('Totals');
      expect(data(client).series[0]!.values).toEqual([9, 9, 9, 9]);
    }

    expect(
      a.editor.exec({
        type: 'setChartColor',
        drawingNodeId: chartId(a),
        index: 1,
        color: '#7030A0',
      }).ok
    ).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(format(b).colors[1]!.color).toBe('#7030A0');

    expect(
      b.editor.exec({ type: 'setChartType', drawingNodeId: chartId(b), chartType: 'line' }).ok
    ).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(format(a).type).toBe('line');

    // Undo and redo travel.
    expect(b.editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    await converged(a, b);
    expect(format(a).type).toBe('columnClustered');
    expect(b.editor.exec({ type: 'redo' })).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    await converged(a, b);
    expect(format(a).type).toBe('line');

    rejoined = await peer('Rejoined', a);
    await converged(a, rejoined);
    expect(format(rejoined).title).toBe('Totals');
  } finally {
    rejoined?.destroy();
    a.destroy();
    b.destroy();
  }
});

test('deleting a chart while the other editor edits it converges', async () => {
  const a = await peer('Alice'),
    b = await peer('Bob', a);
  try {
    caretAt(a, 0, 15);
    expect(a.editor.exec({ type: 'insertChart', chartType: 'pie' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    // Alice deletes the chart while Bob renames a category.
    const paragraph = a.editor.surface!.session.paragraphIds()[0]!;
    a.editor.surface!.setSelection({
      anchor: { paragraphId: paragraph, offset: 15 },
      head: { paragraphId: paragraph, offset: 16 },
    });
    expect(a.editor.surface!.deleteSelection()).toBe(true);
    const read = data(b);
    expect(
      b.editor.exec({
        type: 'setChartData',
        drawingNodeId: chartId(b),
        data: {
          kind: read.kind,
          categories: read.categories.map((c, i) => (i === 0 ? { ...c, label: 'East' } : c)),
          series: read.series,
        },
      }).ok
    ).toBe(true);
    sync(a, b);
    await converged(a, b);
    for (const client of [a, b])
      expect(client.container.querySelectorAll('.docx-drawing-shape').length).toBe(0);
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    await converged(a, b);
    expect(data(a).categories[0]!.label).toBe('East');
  } finally {
    a.destroy();
    b.destroy();
  }
});

test('a chart resized and floated by one editor while the other edits its data converges', async () => {
  const a = await peer('Alice'),
    b = await peer('Bob', a);
  try {
    caretAt(a, 0, 5);
    expect(a.editor.exec({ type: 'insertChart', chartType: 'columnClustered' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    // Alice selects the chart, then resizes and floats it while Bob changes a value.
    const id = chartId(a);
    expect(a.editor.surface!.selectDrawing(id, a.editor.surface!.session.paragraphIds()[0]!)).toBe(
      true
    );
    expect(
      a.editor.exec({
        type: 'setImageProperties',
        drawingNodeId: id,
        widthEmu: 3_657_600,
        heightEmu: 2_286_000,
      }).ok
    ).toBe(true);
    expect(
      a.editor.exec({ type: 'setImageWrapType', drawingNodeId: id, target: 'square' }).ok
    ).toBe(true);
    const read = data(b);
    expect(
      b.editor.exec({
        type: 'setChartData',
        drawingNodeId: chartId(b),
        data: {
          kind: read.kind,
          categories: read.categories,
          series: read.series.map((s, i) => (i === 0 ? { ...s, values: [8, 8, 8, 8] } : s)),
        },
      }).ok
    ).toBe(true);
    sync(a, b);
    const both = await converged(a, b);
    const xml = JSON.stringify(both.parts.get(both.mainDocumentPart)!.root);
    expect(xml).toContain('3657600');
    expect(xml).toContain('wrapSquare');
    for (const client of [a, b]) expect(data(client).series[0]!.values).toEqual([8, 8, 8, 8]);

    // Undo of the wrap travels; the size stays.
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    const undone = await converged(a, b);
    const undoneXml = JSON.stringify(undone.parts.get(undone.mainDocumentPart)!.root);
    expect(undoneXml).not.toContain('wrapSquare');
    expect(undoneXml).toContain('3657600');
  } finally {
    a.destroy();
    b.destroy();
  }
});

/** How many chart drawings the main story of `client` holds. */
const chartCount = (client: Peer): number =>
  JSON.stringify(
    client.editor.surface!.session.currentPackage().parts.get('/word/document.xml')!.root
  ).split('"localName":"chart"').length - 1;

test('a copied chart pastes in both editors, converges, and undoes', async () => {
  const a = await peer('Alice'),
    b = await peer('Bob', a);
  try {
    caretAt(a, 0, 5);
    expect(a.editor.exec({ type: 'insertChart', chartType: 'columnClustered' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    // Bob copies the chart and pastes it into the second paragraph while Alice titles it.
    const source = chartId(b);
    const host = b.editor.surface!.session.paragraphIds()[0]!;
    expect(b.editor.surface!.selectDrawing(source, host)).toBe(true);
    const copy = b.editor.surface!.copyFlavours();
    expect(copy.chartDrawingNodeId).toBe(source);
    caretAt(b, 1, 0);
    expect(b.editor.exec({ type: 'paste', text: copy.text, html: copy.html! }).ok).toBe(true);
    expect(
      a.editor.exec({
        type: 'setChartFormat',
        drawingNodeId: chartId(a),
        format: { title: 'Original' },
      }).ok
    ).toBe(true);
    sync(a, b);
    const pasted = await converged(a, b);
    expect(chartParts(pasted)).toHaveLength(2);
    for (const client of [a, b]) expect(chartCount(client)).toBe(2);
    // The copy is its own chart: the title stays on the source.
    expect(format(a).title).toBe('Original');

    // Alice pastes Bob's copy too: both editors are in one page, so the copy is there.
    caretAt(a, 1, 3);
    expect(a.editor.surface!.pasteRich(copy.text, copy.html)).toBe(true);
    sync(a, b);
    expect(chartParts(await converged(a, b))).toHaveLength(3);

    // Undo travels: Bob's paste goes in both editors, and Alice's stays.
    expect(b.editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    await converged(a, b);
    for (const client of [a, b]) expect(chartCount(client)).toBe(2);
  } finally {
    a.destroy();
    b.destroy();
  }
});

test('locked chart edits stay refused across peers, history, and reconnect', async () => {
  const seed = await peer('Seed');
  caretAt(seed, 0, 5);
  expect(seed.editor.exec({ type: 'insertChart', chartType: 'columnClustered' }).ok).toBe(true);
  const entries = unzipSync(new Uint8Array(await seed.editor.save()));
  seed.destroy();
  entries['word/document.xml'] = strToU8(
    strFromU8(entries['word/document.xml']!).replace(
      /(<w:p[ >][\s\S]*?<\/w:p>)/,
      '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>$1</w:sdtContent></w:sdt>'
    )
  );
  const a = await peer('Alice', undefined, zipSync(entries));
  const b = await peer('Bob', a);
  let rejoined: Peer | undefined;
  try {
    const title = format(a).title;
    for (const client of [a, b]) {
      const before = client.editor.surface!.session.currentPackage();
      expect(
        client.editor.exec({
          type: 'setChartFormat',
          drawingNodeId: chartId(client),
          format: { title: 'Blocked' },
        }).ok
      ).toBe(false);
      expect(client.editor.surface!.session.currentPackage()).toBe(before);
    }
    caretAt(b, 1, 0);
    expect(b.editor.exec({ type: 'insertText', text: 'Allowed ' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(format(a).title).toBe(title);
    expect(b.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(b.editor.exec({ type: 'redo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    rejoined = await peer('Rejoined', a);
    await converged(a, rejoined);
    expect(format(rejoined).title).toBe(title);
    expect(
      rejoined.editor.exec({
        type: 'setChartType',
        drawingNodeId: chartId(rejoined),
        chartType: 'pie',
      }).ok
    ).toBe(false);
  } finally {
    rejoined?.destroy();
    a.destroy();
    b.destroy();
  }
});
