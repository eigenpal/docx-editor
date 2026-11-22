/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { withAuthoredCjkGapMetric } from '../../../../core/src/layout/cjk-auto-spacing-metric-port.ts';
import { linesOf } from '@docx-editor.dev/core/layout';
import {
  mountPaginatedSurface,
  type PaginatedSurface,
} from '../../../../core/src/editor/paginated-surface.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

const fieldDocument = (instruction: string) =>
  zipDocument(
    `<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> ${instruction} </w:instrText>` +
      '<w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:rPr><w:sz w:val="28"/><w:rFonts w:ascii="Times New Roman" w:eastAsia="SimSun"/></w:rPr>' +
      '<w:t>1甲乙</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t> A</w:t></w:r></w:p>' +
      '<w:p><w:bookmarkStart w:id="1" w:name="target"/><w:r><w:t>Target</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>'
  );
const measurer = withAuthoredCjkGapMetric(
  {
    measure: (text) => [...text].reduce((n, c) => n + (/\p{Script=Han}/u.test(c) ? 14 : 7), 0),
    lineMetrics: () => ({ height: 16, baseline: 12 }),
  },
  (style) => style.fontSizePt / 4
);

for (const instruction of ['HYPERLINK \\l "target"', 'MERGEFIELD Name']) {
  test(`field result spacing converges through deletion, concurrent editing, undo and reopening (${instruction})`, async () => {
    const doc = fieldDocument(instruction);
    const harness = createPeerHarness('field-result-spacing');
    const active: PaginatedSurface[] = [];
    const open = (bytes: Uint8Array, peer?: Peer) => {
      peer?.detach();
      const result = mountPaginatedSurface(document.createElement('div'), bytes, {
        scale: 1,
        measurer,
        ...(peer ? { collaborationModel: { session: peer.room.session } } : {}),
      });
      if (!result.ok) throw new Error(result.reason);
      active.push(result.surface);
      return result.surface;
    };
    const geometry = (surface: PaginatedSurface) =>
      linesOf(surface.layout())[0]!.spans.map((s) => ({
        text: s.text,
        start: s.range.start,
        end: s.range.end,
        x: s.box.x,
        width: s.box.width,
      }));
    const select = (surface: PaginatedSurface, from: number, to = from) => {
      const paragraphId = surface.session.paragraphIds()[0]!;
      surface.setSelection({
        anchor: { paragraphId, offset: from },
        head: { paragraphId, offset: to },
      });
    };
    try {
      const peers = await harness.pair(doc);
      const alice = open(peers.alice.room.document, peers.alice);
      const bob = open(peers.bob.room.document, peers.bob);
      const converged = (hasField: boolean) => {
        peers.alice.room.session.flushPendingJournals();
        peers.bob.room.session.flushPendingJournals();
        const left = geometry(alice);
        expect(left).toEqual(geometry(bob));
        expect(left.some((span) => span.text.includes('甲'))).toBe(hasField);
        if (hasField) {
          const [number, title] = left;
          expect(title!.x - number!.x - number!.width).toBeCloseTo(3.5, 6);
          expect([number!.start, number!.end, title!.start, title!.end]).toEqual([0, 1, 0, 1]);
        }
      };
      converged(true);
      peers.pause();
      select(alice, 0, 1);
      alice.deleteForward();
      select(bob, 3);
      bob.type('B');
      peers.resume();
      converged(false);
      alice.undo();
      converged(true);
      alice.redo();
      converged(false);
      alice.undo();
      converged(true);
      expect(geometry(open(alice.save()))).toEqual(geometry(bob));
    } finally {
      for (const surface of active) surface.destroy();
      harness.cleanup();
    }
  });
}
