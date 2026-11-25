/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two participants edit around an `IF` field whose field codes span paragraphs. Layout removes
// those paragraphs in both editors, a remote edit that makes the field codes well formed lays
// them out again, and Delete before the field shares no join.
import { expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createFixedMeasurer, linesOf } from '@docx-editor.dev/core/layout';
import {
  mountPaginatedSurface,
  type PaginatedSurface,
} from '../../../../core/src/editor/paginated-surface.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

const field = zipDocument(
  '<w:p><w:r><w:t xml:space="preserve">before </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve">IF 1 = 1 "</w:instrText></w:r></w:p>' +
    '<w:p><w:r><w:t>Z</w:t></w:r></w:p><w:p/>' +
    '<w:p><w:r><w:instrText xml:space="preserve">" ""</w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Yes</w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>'
);
const measurer = createFixedMeasurer(6, 14);

test('participants agree on field-code paragraphs through edits, undo, and save', async () => {
  const harness = createPeerHarness('field-instruction-paragraphs');
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
  const shown = (surface: PaginatedSurface) =>
    linesOf(surface.layout()).map((line) =>
      line.spans
        .map((span) => span.text)
        .join('')
        .trim()
    );
  const caret = (surface: PaginatedSurface, index: number, offset: number) => {
    const paragraphId = surface.session.paragraphIds()[index]!;
    surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
  };
  try {
    const peers = await harness.pair(field);
    const alice = open(peers.alice.room.document, peers.alice);
    const bob = open(peers.bob.room.document, peers.bob);
    const converged = (lines: string[]) => {
      peers.alice.room.session.flushPendingJournals();
      peers.bob.room.session.flushPendingJournals();
      expect(alice.session.bodyText()).toBe(bob.session.bodyText());
      expect(shown(alice)).toEqual(lines);
      expect(shown(bob)).toEqual(lines);
    };
    // Stray text in the field codes keeps every paragraph.
    converged(['before', 'Z', '', 'Yes after']);

    // Alice removes the stray text while Bob types after the field: both drop the paragraphs.
    peers.pause();
    caret(alice, 1, 1);
    alice.deleteBackward();
    caret(bob, 3, 3);
    bob.type('!');
    peers.resume();
    converged(['before', 'Yes! after']);

    // Delete before the field steps over the field codes in Bob's editor and shares nothing.
    caret(bob, 0, 7);
    bob.deleteForward();
    expect(bob.state().lastRejection).toBeNull();
    converged(['before', 'Yes! after']);

    alice.undo();
    converged(['before', 'Z', '', 'Yes! after']);
    alice.redo();
    converged(['before', 'Yes! after']);

    expect(shown(open(alice.save()))).toEqual(['before', 'Yes! after']);
  } finally {
    for (const surface of active) surface.destroy();
    harness.cleanup();
  }
});
