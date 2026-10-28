/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import {
  mountPaginatedSurface,
  type PaginatedSurface,
} from '../../../../core/src/editor/paginated-surface.ts';
import { caretAt, createFixedMeasurer, linesOf } from '@docx-editor.dev/core/layout';
import { createPeerHarness, REL, W, zipDocument, type Peer } from './document-peer-support.ts';

const initial = 'aa bb cc dd ee ff gg hh ii';
const measurer = createFixedMeasurer();
// A styles part with a `w:rPrDefault` spreads the closing line per character; without one the
// line stretches its spaces.
const STYLES_RELS = `<Relationships xmlns="${REL}"><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
const STYLES_OVERRIDE =
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>';
const KINDS = {
  'stretched spaces': undefined,
  'spread characters': `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault/></w:docDefaults></w:styles>`,
} as const;
type Kind = keyof typeof KINDS;
const source = (kind: Kind) => {
  const styles = KINDS[kind];
  return zipDocument(
    `<w:p><w:pPr><w:jc w:val="distribute"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${initial}</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="2400" w:h="6000"/><w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200"/></w:sectPr>`,
    styles
      ? {
          overrides: STYLES_OVERRIDE,
          documentRels: STYLES_RELS,
          extraXml: { 'word/styles.xml': styles },
        }
      : undefined
  );
};
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
const text = (view: View) => view.surface.session.bodyText().split('\n')[0];
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
function stretches(view: View, kind: Kind) {
  const line = linesOf(view.surface.layout()).at(-1)!;
  expect(line.spans.map((s) => s.text).join('')).toContain(' ');
  const visible = line.spans.filter((s) => s.text.trim().length > 0);
  // Spread characters each take a span of their own; stretched spaces keep whole words.
  expect(visible.every((s) => s.text.length === 1)).toBe(kind === 'spread characters');
  const last = visible.at(-1)!;
  expect(last.box.x + measurer.measure(last.text.trimEnd(), last.style)).toBeCloseTo(100, 7);
  expect(xml(view)).toContain('w:val="distribute"');
  expect(xml(view)).not.toMatch(/<w:spacing(?:\s|\/|>)/u);
}

for (const kind of Object.keys(KINDS) as Kind[])
  test(`distributed last-line geometry converges through collaboration and history: ${kind}`, async () => {
    const harness = createPeerHarness('distributed-last-line', { offlineEditing: true });
    const views: View[] = [];
    try {
      const peers = await harness.pair(source(kind));
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
        stretches(left, kind);
        stretches(right, kind);
      };
      same(initial);
      select(left, initial.length - 2, initial.length);
      applyAwarenessUpdate(
        peers.bob.awareness,
        encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.ydoc.clientID]),
        'test'
      );
      const remote = peers.bob.room.session.remoteSelections()[0]!;
      expect(
        caretAt(right.surface.layout(), {
          paragraphId: remote.head.nodeId,
          offset: remote.head.offset,
        })
      ).toEqual(caretAt(left.surface.layout(), left.surface.state().selection.head));
      peers.pause();
      select(left, 0);
      select(right, initial.length);
      left.surface.type('x');
      right.surface.type(' yy');
      peers.resume();
      same('x' + initial + ' yy');
      left.surface.undo();
      same(initial + ' yy');
      left.surface.redo();
      same('x' + initial + ' yy');
      peers.pause();
      select(left, 0, 1);
      select(right, text(right)!.length);
      left.surface.deleteForward();
      right.surface.type(' z');
      peers.resume();
      same(initial + ' yy z');
      const reopened = open(left.surface.save());
      views.push(reopened);
      expect(geometry(reopened)).toEqual(geometry(left));
      stretches(reopened, kind);
      destroy(right);
      views.splice(views.indexOf(right), 1);
      harness.leave(peers.bob);
      select(left, 0);
      left.surface.type('q');
      const joined = await harness.join(peers.alice, 'joined');
      const third = open(joined.room.document, joined);
      views.push(third);
      expect(xml(third)).toBe(xml(left));
      expect(geometry(third)).toEqual(geometry(left));
      stretches(third, kind);
    } finally {
      for (const view of views) destroy(view);
      harness.cleanup();
    }
  }, 10000);
