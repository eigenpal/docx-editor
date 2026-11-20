/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { linesOf } from '@docx-editor.dev/core/layout';
import {
  mountPaginatedSurface,
  type PaginatedSurface,
} from '../../../../core/src/editor/paginated-surface.ts';
import { createPeerHarness, zipDocument, type Peer, W, R, REL } from './document-peer-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const parts = ['styles', 'settings'];
const ideographs = '国'.repeat(4);
const source = zipDocument(
  '<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:rPr>' +
    '<w:sz w:val="24"/><w:lang w:eastAsia="ja-JP"/><w:highlight w:val="yellow"/></w:rPr>' +
    `<w:t>${ideographs}。余</w:t></w:r></w:p>` +
    '<w:sectPr><w:pgSz w:w="1440" w:h="6000"/>' +
    '<w:pgMar w:top="200" w:bottom="200" w:left="200" w:right="200"/></w:sectPr>',
  {
    overrides: parts
      .map((part) => `<Override PartName="/word/${part}.xml" ContentType="${CT}.${part}+xml"/>`)
      .join(''),
    documentRels:
      `<Relationships xmlns="${REL}">` +
      parts
        .map((part) => `<Relationship Id="${part}" Type="${R}/${part}" Target="${part}.xml"/>`)
        .join('') +
      '</Relationships>',
    extraXml: {
      'word/styles.xml': `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="MS Mincho"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
      'word/settings.xml':
        `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/>` +
        '<w:compat><w:compatSetting w:name="compatibilityMode" ' +
        'w:uri="http://schemas.microsoft.com/office/word" w:val="14"/></w:compat></w:settings>',
    },
  }
);

function paintedLines(surface: PaginatedSurface, container: HTMLElement) {
  return linesOf(surface.layout()).map((line, index) => ({
    text: line.spans.map((span) => span.text).join(''),
    blank: line.hangingMarkBlank,
    marks: [
      ...container
        .querySelectorAll('.docx-line')
        [index]!.querySelectorAll<HTMLElement>('[data-highlight]'),
    ].map((run) => [run.style.backgroundColor, run.style.clipPath]),
  }));
}

test('compressed hanging highlights agree after concurrent edits, history and reopen', async () => {
  const harness = createPeerHarness('compressed-hanging-highlight');
  const surfaces: PaginatedSurface[] = [];
  const open = (bytes: Uint8Array, peer?: Peer) => {
    peer?.detach();
    const container = document.createElement('div');
    const result = mountPaginatedSurface(container, bytes, {
      scale: 1,
      measurer: {
        measure: (text) => text.length * 12,
        lineMetrics: () => ({ height: 16, baseline: 12 }),
      },
      ...(peer ? { collaborationModel: { session: peer.room.session } } : {}),
    });
    if (!result.ok) throw new Error(result.reason);
    surfaces.push(result.surface);
    return { surface: result.surface, paint: () => paintedLines(result.surface, container) };
  };
  const select = (surface: PaginatedSurface, from: number, to = from) => {
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: from },
      head: { paragraphId, offset: to },
    });
  };
  try {
    const peers = await harness.pair(source);
    const alice = open(peers.alice.room.document, peers.alice);
    const bob = open(peers.bob.room.document, peers.bob);
    // The 12 pt mark hangs past the 52 pt measure and gives up its 6 pt blank half.
    const converged = (clipped: boolean) => {
      peers.alice.room.session.flushPendingJournals();
      peers.bob.room.session.flushPendingJournals();
      expect(alice.paint()).toEqual(bob.paint());
      const [line] = alice.paint();
      expect(line?.blank).toBe(clipped ? 6 : undefined);
      expect(line?.marks.at(-1)?.[1]).toBe(clipped ? 'inset(-1em calc(100% - 6px) -1em -1em)' : '');
    };
    converged(true);
    peers.pause();
    select(alice.surface, 0, 1);
    alice.surface.deleteForward();
    select(bob.surface, 6);
    bob.surface.type('新');
    peers.resume();
    converged(false);
    alice.surface.undo();
    converged(true);
    alice.surface.redo();
    converged(false);
    alice.surface.undo();
    converged(true);
    // Alice deletes the hanging mark while Bob types before it: no mark hangs on either side.
    peers.pause();
    select(alice.surface, 4, 5);
    alice.surface.deleteForward();
    select(bob.surface, 0);
    bob.surface.type('文');
    peers.resume();
    converged(false);
    // The restored mark now follows a full line of text, so it no longer ends that line.
    alice.surface.undo();
    converged(false);
    expect(open(alice.surface.save()).paint()).toEqual(bob.paint());
  } finally {
    for (const surface of surfaces) surface.destroy();
    harness.cleanup();
  }
});
