/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A read-only waterfall chart, wrapped in `mc:AlternateContent` as Office writes it, in two
// collaborating editors: both render it from the shared chartex part and its chart style
// parts, through concurrent prose edits, undo, redo, deleting the chart while the other
// participant types, and a reconnect; the chartex and style parts save unchanged.
import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { readOoxmlPackage, canonicalOoxmlFingerprint } from '@docx-editor.dev/core/store';
import {
  chartexDocx,
  waterfallChartSpace,
} from '../../../../core/src/store/__tests__/chartex-fixture.ts';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { installDrawing } from '../../drawing/index.ts';

installDrawing();

const PARTS = ['/word/charts/chartEx1.xml', '/word/charts/style1.xml', '/word/charts/colors1.xml'];

/** The chartex fixture with a paragraph of text before and after the chart. */
function fixture(): Uint8Array {
  const files = unzipSync(
    chartexDocx(waterfallChartSpace({ title: 'Net cash' }), { alternateContent: true })
  );
  const document = strFromU8(files['word/document.xml']!).replace(
    /<w:body>(.*)<w:sectPr\/>/,
    '<w:body><w:p><w:r><w:t>Alpha paragraph</w:t></w:r></w:p>$1' +
      '<w:p><w:r><w:t>Omega paragraph</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>'
  );
  files['word/document.xml'] = strToU8(document);
  return zipSync(files);
}
const FIXTURE = fixture();

async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc(),
    awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'chartex-drawings',
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
  const original = readOoxmlPackage(FIXTURE);
  if (!original.ok) throw new Error(original.reason);
  for (const pkg of [left, right]) {
    for (const name of PARTS) {
      expect(canonicalOoxmlFingerprint(pkg.parts.get(name)!)).toBe(
        canonicalOoxmlFingerprint(original.package.parts.get(name)!)
      );
    }
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

test('two editors render a read-only waterfall through edits, deletion and reconnect', async () => {
  const a = await peer('Alice'),
    b = await peer('Bob', a);
  let rejoined: Peer | undefined;
  try {
    for (const client of [a, b]) {
      expect(client.container.querySelectorAll('.docx-drawing-shape').length).toBe(1);
      expect(textOf(client)).toContain('Net cash');
      expect(textOf(client)).toContain('Increase');
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
    expect(textOf(a)).not.toContain('Net cash');
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    await verify(a, b, 1);
    expect(textOf(b)).toContain('Net cash');
    rejoined = await peer('Rejoined', a);
    await verify(a, rejoined, 1);
    expect(textOf(rejoined)).toContain('Total');
  } finally {
    rejoined?.destroy();
    a.destroy();
    b.destroy();
  }
});
