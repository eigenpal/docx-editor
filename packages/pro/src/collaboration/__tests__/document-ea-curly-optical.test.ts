/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
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
import { caretAt, linesOf, type TextMeasurer } from '@docx-editor.dev/core/layout';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

// A declared synthetic metric model, not an installed or substituted font.
const measurer: TextMeasurer = {
  measure: (text, style) =>
    (text.length * 12 * style.horizontalScalePercent) / 100 +
    text.length * style.characterSpacingPt,
  lineMetrics: () => ({ height: 16, baseline: 12 }),
  hasResolvedFont: () => true,
  inkBounds: (text) =>
    /^[“‘]$/u.test(text)
      ? { left: 9, right: 11 }
      : /^[。”’]$/u.test(text)
        ? { left: 1, right: 3 }
        : { left: 1, right: 11 },
};
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function source(): Uint8Array {
  return zipDocument(
    '<w:p><w:pPr><w:jc w:val="both"/><w:overflowPunct w:val="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Fixture Latin" w:hAnsi="Fixture Latin" w:eastAsia="Fixture EA" w:hint="eastAsia"/><w:sz w:val="24"/></w:rPr><w:t>甲。乙“丙”丁</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="1960" w:h="6000"/><w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200"/></w:sectPr>',
    {
      overrides:
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>',
      documentRels:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="settings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>',
      extraXml: {
        'word/styles.xml': `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="SimSun"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
        'word/settings.xml': `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/></w:settings>`,
      },
    }
  );
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
  if (!result.ok) throw new Error(result.reason);
  return { surface: result.surface, container };
}
const text = (v: View) => v.surface.session.bodyText().split('\n')[0];
const xml = (v: View) => strFromU8(unzipSync(v.surface.save())['word/document.xml']!);
const geometry = (v: View) =>
  linesOf(v.surface.layout()).map((line) => ({
    box: line.box,
    baseline: line.baseline,
    spans: line.spans.map((span) => ({
      text: span.text,
      box: span.box,
      start: span.range.start,
      end: span.range.end,
      glyphOffsetPt: span.glyphOffsetPt,
    })),
  }));
function select(v: View, offset: number, end = offset) {
  const paragraphId = v.surface.session.paragraphIds()[0]!;
  v.surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset: end } });
}
function destroy(v: View) {
  v.surface.destroy();
  v.container.remove();
}

test('EA curly geometry converges through shared edits, history, selections, deletion, reconnect and reopen', async () => {
  const harness = createPeerHarness('ea-curly-optical-geometry', { offlineEditing: true });
  const views: View[] = [];
  try {
    const peers = await harness.pair(source());
    const left = open(peers.alice.room.document, peers.alice),
      right = open(peers.bob.room.document, peers.bob);
    views.push(left, right);
    const same = (expected: string) => {
      peers.alice.room.session.flushPendingJournals();
      peers.bob.room.session.flushPendingJournals();
      expect(text(left)).toBe(expected);
      expect(text(right)).toBe(expected);
      expect(xml(left)).toBe(xml(right));
      expect(geometry(left)).toEqual(geometry(right));
    };
    // The first line holds all seven glyphs only when a hinted curly quote gives up advance.
    const fitted = (v: View) => {
      const spans = linesOf(v.surface.layout())[0]!.spans;
      return (
        spans.map((span) => span.text).join('') === '甲。乙“丙”丁' &&
        spans.some((span) => /[“”]/u.test(span.text) && span.box.width < 12)
      );
    };
    same('甲。乙“丙”丁');
    expect(linesOf(left.surface.layout())).toHaveLength(1);
    expect(fitted(left)).toBe(true);
    select(left, 3, 4);
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
    select(right, 7);
    left.surface.type('甲');
    right.surface.type('乙');
    peers.resume();
    same('甲甲。乙“丙”丁乙');
    left.surface.undo();
    same('甲。乙“丙”丁乙');
    expect(fitted(left) && fitted(right)).toBe(true);
    left.surface.redo();
    same('甲甲。乙“丙”丁乙');
    peers.pause();
    select(left, 4, 5);
    select(right, 9);
    left.surface.deleteForward();
    right.surface.type('丙');
    peers.resume();
    same('甲甲。乙丙”丁乙丙');
    const reopened = open(left.surface.save());
    views.push(reopened);
    expect(text(reopened)).toBe(text(left));
    expect(geometry(reopened)).toEqual(geometry(left));
    expect(xml(reopened)).toBe(xml(left));
    destroy(right);
    views.splice(views.indexOf(right), 1);
    harness.leave(peers.bob);
    select(left, 9);
    left.surface.type('丁');
    const joined = await harness.join(peers.alice, 'joined');
    const third = open(joined.room.document, joined);
    views.push(third);
    expect(text(third)).toBe(text(left));
    expect(xml(third)).toBe(xml(left));
    expect(geometry(third)).toEqual(geometry(left));
  } finally {
    for (const view of views) destroy(view);
    harness.cleanup();
  }
}, 10000);
