/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { linesOf } from '@docx-editor.dev/core/layout';
import {
  mountPaginatedSurface,
  type PaginatedSurface,
} from '../../../../core/src/editor/paginated-surface.ts';
import { createPeerHarness, zipDocument, type Peer, W, R, REL } from './document-peer-support.ts';

const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const partNames = ['styles', 'settings'];
const source = zipDocument(
  '<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:rPr>' +
    '<w:sz w:val="24"/><w:lang w:eastAsia="zh-CN"/></w:rPr><w:t>甲乙丙丁，余</w:t></w:r></w:p>' +
    '<w:sectPr><w:pgSz w:w="1520" w:h="6000"/>' +
    '<w:pgMar w:top="200" w:bottom="200" w:left="200" w:right="200"/></w:sectPr>',
  {
    overrides: partNames
      .map((part) => `<Override PartName="/word/${part}.xml" ContentType="${CT}.${part}+xml"/>`)
      .join(''),
    documentRels:
      `<Relationships xmlns="${REL}">` +
      partNames
        .map((part) => `<Relationship Id="${part}" Type="${R}/${part}" Target="${part}.xml"/>`)
        .join('') +
      '</Relationships>',
    extraXml: {
      'word/styles.xml': `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="SimSun"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
      'word/settings.xml':
        `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/>` +
        '<w:compat><w:useAltKinsokuLineBreakRules/><w:compatSetting w:name="compatibilityMode" ' +
        'w:uri="http://schemas.microsoft.com/office/word" w:val="14"/></w:compat></w:settings>',
    },
  }
);

function geometry(surface: PaginatedSurface) {
  return linesOf(surface.layout()).map((line) => ({
    text: line.spans.map((span) => span.text).join(''),
    box: line.box,
  }));
}

test('alternate Chinese line breaks converge after concurrent edits, undo and reopen', async () => {
  const harness = createPeerHarness('alternate-chinese-hanging');
  const surfaces: PaginatedSurface[] = [];
  const open = (bytes: Uint8Array, peer?: Peer) => {
    peer?.detach();
    const result = mountPaginatedSurface(document.createElement('div'), bytes, {
      scale: 1,
      measurer: {
        measure: (text) => text.length * 12,
        lineMetrics: () => ({ height: 16, baseline: 12 }),
      },
      ...(peer ? { collaborationModel: { session: peer.room.session } } : {}),
    });
    if (!result.ok) throw new Error(result.reason);
    surfaces.push(result.surface);
    return result.surface;
  };
  const select = (surface: PaginatedSurface, start: number, end = start) => {
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: start },
      head: { paragraphId, offset: end },
    });
  };
  try {
    const peers = await harness.pair(source);
    const left = open(peers.alice.room.document, peers.alice);
    const right = open(peers.bob.room.document, peers.bob);
    const converged = (expected: string[]) => {
      peers.alice.room.session.flushPendingJournals();
      peers.bob.room.session.flushPendingJournals();
      expect(geometry(left)).toEqual(geometry(right));
      expect(geometry(left).map((line) => line.text)).toEqual(expected);
    };
    // 56 pt of measure: the 60 pt line passes the margin by 4 pt, within the mark's blank half.
    converged(['甲乙丙丁，', '余']);
    peers.pause();
    select(left, 0, 1);
    left.deleteForward();
    select(right, 6);
    right.type('新');
    peers.resume();
    converged(['乙丙丁，', '余新']);
    left.undo();
    converged(['甲乙丙丁，', '余新']);
    left.redo();
    converged(['乙丙丁，', '余新']);
    expect(geometry(open(left.save()))).toEqual(geometry(right));
  } finally {
    for (const surface of surfaces) surface.destroy();
    harness.cleanup();
  }
});
