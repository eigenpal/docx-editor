/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import {
  mountPaginatedSurface,
  type PaginatedSurface,
} from '../../../../core/src/editor/paginated-surface.ts';
import { caretAt, createFixedMeasurer, linesOf } from '@docx-editor.dev/core/layout';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

// A right-to-left paragraph beside a float in the middle of its 180pt measure: its first words
// fill the passage right of the float, [100, 180), and the text continues left of it.
const initial = 'אא בבב גג דדדד הה ווו זז חחחח טט ייי כככ לל מממ ננ סססס עע פפפ';
const measurer = createFixedMeasurer();
const emu = (pt: number) => Math.round(pt * 12_700);
const FLOAT =
  '<w:r><w:drawing><wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" ' +
  'allowOverlap="1" layoutInCell="1" relativeHeight="1"><wp:simplePos x="0" y="0"/>' +
  `<wp:positionH relativeFrom="column"><wp:posOffset>${emu(60)}</wp:posOffset></wp:positionH>` +
  '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
  `<wp:extent cx="${emu(40)}" cy="${emu(70)}"/><wp:wrapSquare wrapText="bothSides"/>` +
  '<wp:docPr id="1" name="Picture"/>' +
  '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
  '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
  '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
  '<pic:nvPicPr><pic:cNvPr id="1" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  `<pic:spPr><a:xfrm><a:ext cx="${emu(40)}" cy="${emu(70)}"/></a:xfrm>` +
  '<a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
  '</wp:anchor></w:drawing></w:r>';

function source(): Uint8Array {
  const entries = unzipSync(
    zipDocument(
      `<w:p><w:pPr><w:bidi/><w:jc w:val="center"/></w:pPr>${FLOAT}` +
        `<w:r><w:rPr><w:rtl/></w:rPr><w:t>${initial}</w:t></w:r></w:p>` +
        '<w:sectPr><w:pgSz w:w="4000" w:h="6000"/>' +
        '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200"/></w:sectPr>',
      {
        overrides: '<Default Extension="png" ContentType="image/png"/>',
        documentRels:
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>' +
          '</Relationships>',
      }
    )
  );
  entries['word/media/image1.png'] = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='
    ),
    (c) => c.charCodeAt(0)
  );
  return zipSync(entries);
}

interface View {
  surface: PaginatedSurface;
  container: HTMLElement;
}
function open(bytes: Uint8Array, peer?: Peer): View {
  peer?.detach();
  const container = document.createElement('div');
  document.body.append(container);
  const result = mountPaginatedSurface(container, bytes, {
    scale: 1,
    measurer,
    ...(peer ? { collaborationModel: { session: peer.room.session } } : {}),
  });
  if (!result.ok) throw Error(result.reason);
  return { surface: result.surface, container };
}
/** The paragraph's text after the float's anchor, which holds the first offset. */
const text = (view: View) =>
  view.surface.session
    .bodyText()
    .split('\n')[0]!
    .replace(/^\ufffc/u, '');
const xml = (view: View) => strFromU8(unzipSync(view.surface.save())['word/document.xml']!);
const geometry = (view: View) =>
  linesOf(view.surface.layout()).map((line) => ({
    box: line.box,
    spans: line.spans.map((s) => ({ text: s.text, range: s.range, box: s.box })),
  }));
function select(view: View, start: number, end = start) {
  const paragraphId = view.surface.session.paragraphIds()[0]!;
  view.surface.setSelection({
    anchor: { paragraphId, offset: start },
    head: { paragraphId, offset: end },
  });
}
function destroy(view: View) {
  view.surface.destroy();
  view.container.remove();
}
/** The first line starts in the passage right of the float and continues left of it. */
function fillsRightPassageFirst(view: View) {
  const [line] = linesOf(view.surface.layout());
  const jump = line!.spans.findIndex((span, index) => index > 0 && span.wrapAdvanceBefore);
  expect(jump).toBeGreaterThan(0);
  for (const span of line!.spans.slice(0, jump)) expect(span.box.x).toBeGreaterThanOrEqual(99.999);
  for (const span of line!.spans.slice(jump))
    expect(span.box.x + span.box.width).toBeLessThanOrEqual(60.001);
}

test('right-to-left passages beside a float converge through collaboration and history', async () => {
  const harness = createPeerHarness('rtl-float-passages', { offlineEditing: true });
  const views: View[] = [];
  try {
    const peers = await harness.pair(source());
    const left = open(peers.alice.room.document, peers.alice);
    const right = open(peers.bob.room.document, peers.bob);
    views.push(left, right);
    const same = (expected: string) => {
      peers.alice.room.session.flushPendingJournals();
      peers.bob.room.session.flushPendingJournals();
      expect(text(left)).toBe(expected);
      expect(text(right)).toBe(expected);
      expect(xml(left)).toBe(xml(right));
      expect(geometry(left)).toEqual(geometry(right));
      fillsRightPassageFirst(left);
      fillsRightPassageFirst(right);
    };
    same(initial);
    // A remote caret in either passage lands where the local one does.
    for (const offset of [2, 20]) {
      select(left, offset);
      applyAwarenessUpdate(
        peers.bob.awareness,
        encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.ydoc.clientID]),
        'test'
      );
      const remote = peers.bob.room.session.remoteSelections()[0]!;
      const local = caretAt(left.surface.layout(), left.surface.state().selection.head, measurer);
      expect(
        caretAt(
          right.surface.layout(),
          { paragraphId: remote.head.nodeId, offset: remote.head.offset },
          measurer
        )
      ).toEqual(local);
      expect(local!.x <= 60.001 || local!.x >= 99.999).toBe(true);
    }
    peers.pause();
    select(left, 1);
    select(right, initial.length + 1);
    left.surface.type('ש ');
    right.surface.type(' תת');
    peers.resume();
    same('ש ' + initial + ' תת');
    left.surface.undo();
    same(initial + ' תת');
    left.surface.redo();
    same('ש ' + initial + ' תת');
    peers.pause();
    select(left, 1, 3);
    select(right, text(right)!.length + 1);
    left.surface.deleteForward();
    right.surface.type(' רר');
    peers.resume();
    same(initial + ' תת רר');
    const reopened = open(left.surface.save());
    views.push(reopened);
    expect(geometry(reopened)).toEqual(geometry(left));
    fillsRightPassageFirst(reopened);
    destroy(right);
    views.splice(views.indexOf(right), 1);
    harness.leave(peers.bob);
    select(left, 1);
    left.surface.type('ק');
    const joined = await harness.join(peers.alice, 'joined');
    const third = open(joined.room.document, joined);
    views.push(third);
    expect(xml(third)).toBe(xml(left));
    expect(geometry(third)).toEqual(geometry(left));
    fillsRightPassageFirst(third);
  } finally {
    for (const view of views) destroy(view);
    harness.cleanup();
  }
}, 10000);
