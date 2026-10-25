/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A wrapped chartex chart in two collaborating editors, where Alice has the drawing module and
// Bob does not: Alice sees the drawn chart, Bob sees its saved fallback picture. Bob's picture
// edits on the fallback refuse and change nothing for either participant; Alice's drawn chart
// selects as an object with no handles; a delete by either participant removes the chart and its
// fallback for both, undo restores both branches, a delete races Alice's typing, and both
// converge after save and reopen.
//
// The renderer registry is process-wide, so one process cannot hold one participant with the
// module and one without. Each step installs the chart renderer for the participant it acts
// or lays out for (`as`), and a relayed update lands under the receiving participant's
// install, so every projection a participant reads was made with its own renderers.

import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { forEachSemanticDrawing } from '@docx-editor.dev/core/layout';
import {
  readOoxmlPackage,
  canonicalOoxmlFingerprint,
  installDrawingRenderers,
} from '@docx-editor.dev/core/store';
import { drawingRenderers } from '../../../../core/src/store/package/drawing-renderers.ts';
import {
  chartexDocx,
  waterfallChartSpace,
} from '../../../../core/src/store/__tests__/chartex-fixture.ts';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { installDrawing } from '../../drawing/index.ts';

installDrawing();
const CHART_RENDERER = drawingRenderers().chart;

/** Install the chart renderer for a participant with the drawing module, or remove it. */
function as(withModule: boolean): void {
  installDrawingRenderers({ chart: withModule ? CHART_RENDERER : undefined });
}

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

async function peer(name: string, withModule: boolean, host?: { ydoc: Y.Doc }) {
  as(withModule);
  const ydoc = new Y.Doc(),
    awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'chartex-fallback-peers',
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
  editor.surface!.layout();
  return {
    withModule,
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

/** Relay each participant's updates to the other, each landing under its receiver's install. */
function sync(a: Peer, b: Peer): void {
  for (const [from, to] of [
    [a, b],
    [b, a],
  ] as const) {
    as(to.withModule);
    Y.applyUpdate(to.ydoc, Y.encodeStateAsUpdate(from.ydoc, Y.encodeStateVector(to.ydoc)), 'relay');
    to.editor.surface!.layout();
  }
}

/** How the participant's layout shows the chart, as its record's `chart.shownAs` says. */
function shown(client: Peer): readonly string[] {
  as(client.withModule);
  const kinds: string[] = [];
  forEachSemanticDrawing(client.editor.surface!.layout(), ({ drawing }) => {
    expect(drawing.chart?.title).toBe('Net cash');
    kinds.push(drawing.chart!.shownAs);
  });
  return kinds;
}

async function savedMain(client: Peer): Promise<string> {
  as(client.withModule);
  const loaded = readOoxmlPackage(new Uint8Array(await client.editor.save()));
  if (!loaded.ok) throw new Error(loaded.reason);
  return canonicalOoxmlFingerprint(loaded.package.parts.get(loaded.package.mainDocumentPart)!);
}

async function converged(a: Peer, b: Peer): Promise<string> {
  const left = await savedMain(a);
  expect(await savedMain(b)).toBe(left);
  return left;
}

/** Select the chart, first in the second paragraph, as a picture press would. */
function selectChart(client: Peer): void {
  as(client.withModule);
  const paragraphId = client.editor.surface!.session.paragraphIds()[1]!;
  client.editor.surface!.setSelection({
    anchor: { paragraphId, offset: 1 },
    head: { paragraphId, offset: 1 },
  });
  client.editor.surface!.setSelection({
    anchor: { paragraphId, offset: 0 },
    head: { paragraphId, offset: 0 },
  });
}

function caretAt(client: Peer, paragraph: number, offset: number): void {
  as(client.withModule);
  const id = client.editor.surface!.session.paragraphIds()[paragraph]!;
  client.editor.surface!.setSelection({
    anchor: { paragraphId: id, offset },
    head: { paragraphId: id, offset },
  });
}

test('a participant without the drawing module edits a chart through its fallback', async () => {
  const alice = await peer('Alice', true),
    bob = await peer('Bob', false, alice);
  let reopened: Peer | undefined;
  try {
    expect(shown(alice)).toEqual(['chart']);
    expect(shown(bob)).toEqual(['fallback']);
    const original = await converged(alice, bob);
    expect(original).toContain('AlternateContent');

    // Alice's drawn chart selects as an object with no handles; picture commands refuse.
    selectChart(alice);
    expect(alice.editor.getSelectedImage!()).toMatchObject({
      canResize: false,
      canMove: false,
      canChangeWrap: false,
      canCrop: false,
    });
    expect(alice.editor.exec({ type: 'setImageProperties', widthEmu: 914400 })).toMatchObject({
      ok: false,
      code: 'unsupported',
    });

    // Bob's picture edits on the fallback refuse and change nothing for either participant.
    selectChart(bob);
    expect(bob.editor.getSelectedImage!()).toMatchObject({ canResize: false, canCrop: false });
    for (const command of [
      { type: 'setImageProperties', widthEmu: 914400 },
      { type: 'setImageProperties', description: 'alt' },
      { type: 'setImageWrapType', target: 'square' },
      { type: 'transformImage', action: 'rotateCW' },
    ] as const) {
      expect(bob.editor.exec(command)).toMatchObject({ ok: false, code: 'unsupported' });
    }
    sync(alice, bob);
    expect(await converged(alice, bob)).toBe(original);
    expect(shown(alice)).toEqual(['chart']);

    // Bob's delete removes the chart and its fallback for both; undo restores both branches.
    selectChart(bob);
    expect(bob.editor.exec({ type: 'deleteImage' })).toMatchObject({ ok: true, changed: true });
    sync(alice, bob);
    expect(shown(alice)).toEqual([]);
    expect(shown(bob)).toEqual([]);
    expect(await converged(alice, bob)).not.toContain('AlternateContent');
    as(false);
    expect(bob.editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    sync(alice, bob);
    expect(shown(alice)).toEqual(['chart']);
    expect(shown(bob)).toEqual(['fallback']);
    expect(await converged(alice, bob)).toBe(original);

    // Alice deletes her selected drawn chart; Bob sees it go, and undo restores both branches.
    selectChart(alice);
    expect(alice.editor.exec({ type: 'deleteImage' })).toMatchObject({ ok: true, changed: true });
    sync(alice, bob);
    expect(shown(alice)).toEqual([]);
    expect(shown(bob)).toEqual([]);
    as(true);
    expect(alice.editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    sync(alice, bob);
    expect(shown(alice)).toEqual(['chart']);
    expect(shown(bob)).toEqual(['fallback']);
    expect(await converged(alice, bob)).toBe(original);

    // Alice deletes her drawn chart as one character of its paragraph; undo restores it.
    as(true);
    const chartParagraph = alice.editor.surface!.session.paragraphIds()[1]!;
    alice.editor.surface!.setSelection({
      anchor: { paragraphId: chartParagraph, offset: 0 },
      head: { paragraphId: chartParagraph, offset: 1 },
    });
    expect(alice.editor.surface!.deleteSelection()).toBe(true);
    sync(alice, bob);
    expect(shown(alice)).toEqual([]);
    expect(shown(bob)).toEqual([]);
    expect(await converged(alice, bob)).not.toContain('AlternateContent');
    as(true);
    expect(alice.editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    sync(alice, bob);
    expect(shown(alice)).toEqual(['chart']);
    expect(shown(bob)).toEqual(['fallback']);
    expect(await converged(alice, bob)).toBe(original);

    // Bob deletes the chart while Alice types in the paragraph before it.
    selectChart(bob);
    expect(bob.editor.exec({ type: 'deleteImage' })).toMatchObject({ ok: true, changed: true });
    caretAt(alice, 0, 5);
    expect(alice.editor.exec({ type: 'insertText', text: ' concurrent' })).toMatchObject({
      changed: true,
    });
    sync(alice, bob);
    expect(shown(alice)).toEqual([]);
    expect(shown(bob)).toEqual([]);
    const merged = await converged(alice, bob);
    expect(merged).toContain('Alpha concurrent paragraph');
    expect(merged).not.toContain('AlternateContent');

    // Save and reopen: the saved document reads back the same for a new participant.
    as(true);
    const saved = new Uint8Array(await alice.editor.save());
    const loaded = readOoxmlPackage(saved);
    if (!loaded.ok) throw new Error(loaded.reason);
    expect(
      canonicalOoxmlFingerprint(loaded.package.parts.get(loaded.package.mainDocumentPart)!)
    ).toBe(merged);
    reopened = await peer('Reopened', false, alice);
    expect(await savedMain(reopened)).toBe(merged);
  } finally {
    as(true);
    reopened?.destroy();
    alice.destroy();
    bob.destroy();
  }
});
