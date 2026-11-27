/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createFixedMeasurer, linesOf } from '@docx-editor.dev/core/layout';
import {
  mountPaginatedSurface,
  type PaginatedSurface,
} from '../../../../core/src/editor/paginated-surface.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

const letter = zipDocument(
  '<w:p><w:r><w:t xml:space="preserve">Dated </w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve"> DATE \\@ "d MMMM yyyy" </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:t>1 January 2020</w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
    '<w:r><w:t xml:space="preserve"> end</w:t></w:r></w:p>'
);
/** Thursday 5 March 2026, 14:07 local time. */
const MOMENT = new Date(2026, 2, 5, 14, 7);
const measurer = createFixedMeasurer(6, 14);

test('a participant with fieldDate shows the date and shares only the saved result', async () => {
  const harness = createPeerHarness('field-date');
  const active: PaginatedSurface[] = [];
  const open = (bytes: Uint8Array, peer?: Peer, fieldDate?: Date) => {
    peer?.detach();
    const result = mountPaginatedSurface(document.createElement('div'), bytes, {
      scale: 1,
      measurer,
      ...(fieldDate ? { fieldDate } : {}),
      ...(peer ? { collaborationModel: { session: peer.room.session } } : {}),
    });
    if (!result.ok) throw new Error(result.reason);
    active.push(result.surface);
    return result.surface;
  };
  const shown = (surface: PaginatedSurface) =>
    linesOf(surface.layout())[0]!
      .spans.map((span) => span.text)
      .join('');
  const caret = (surface: PaginatedSurface, offset: number) => {
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset },
      head: { paragraphId, offset },
    });
  };
  try {
    const peers = await harness.pair(letter);
    const alice = open(peers.alice.room.document, peers.alice, MOMENT);
    const bob = open(peers.bob.room.document, peers.bob);
    const converged = (aliceText: string, bobText: string) => {
      peers.alice.room.session.flushPendingJournals();
      peers.bob.room.session.flushPendingJournals();
      expect(alice.session.bodyText()).toBe(bob.session.bodyText());
      expect(shown(alice)).toBe(aliceText);
      expect(shown(bob)).toBe(bobText);
    };
    converged('Dated 5 March 2026 end', 'Dated 1 January 2020 end');

    // `Dated ` is offsets 0 to 5, the field is offset 6, and ` end` starts at 7.
    peers.pause();
    caret(alice, 0);
    alice.type('A');
    caret(bob, 11);
    bob.type('B');
    peers.resume();
    converged('ADated 5 March 2026 endB', 'ADated 1 January 2020 endB');
    alice.undo();
    converged('Dated 5 March 2026 endB', 'Dated 1 January 2020 endB');

    const saved = alice.save();
    expect(shown(open(saved))).toBe('Dated 1 January 2020 endB');
    expect(shown(open(saved, undefined, MOMENT))).toBe('Dated 5 March 2026 endB');
  } finally {
    for (const surface of active) surface.destroy();
    harness.cleanup();
  }
});
