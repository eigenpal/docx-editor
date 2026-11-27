/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two participants edit around an `IF` field whose field codes span paragraphs. Layout removes
// those paragraphs in both editors and lays the text on either side of the field codes out as
// one line. A remote edit that makes the field codes well formed lays them out again, edits on
// both sides of that line converge, and a peer's caret on it paints on that one line.
import { expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createFixedMeasurer, linesOf } from '@docx-editor.dev/core/layout';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
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
  const containers = new Map<PaginatedSurface, HTMLElement>();
  const open = (bytes: Uint8Array, peer?: Peer) => {
    peer?.detach();
    const container = document.createElement('div');
    document.body.append(container);
    const result = mountPaginatedSurface(container, bytes, {
      scale: 1,
      measurer,
      ...(peer ? { collaborationModel: { session: peer.room.session } } : {}),
    });
    if (!result.ok) throw new Error(result.reason);
    active.push(result.surface);
    containers.set(result.surface, container);
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

    // Alice removes the stray text while Bob types after the field: both drop the paragraphs,
    // and the text on either side of the field codes shares one line.
    peers.pause();
    caret(alice, 1, 1);
    alice.deleteBackward();
    caret(bob, 3, 3);
    bob.type('!');
    peers.resume();
    converged(['before Yes! after']);

    // Concurrent edits on both sides of that line land in their own paragraphs.
    peers.pause();
    caret(alice, 0, 0);
    alice.type('A ');
    caret(bob, 3, 10);
    bob.type(' B');
    peers.resume();
    converged(['A before Yes! after B']);

    // Bob's caret, published through presence, paints on the merged line in Alice's editor.
    const remoteCaret = async (index: number, offset: number) => {
      caret(bob, index, offset);
      applyAwarenessUpdate(
        peers.alice.awareness,
        encodeAwarenessUpdate(peers.bob.awareness, [peers.bob.awareness.clientID]),
        'test-provider'
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      const painted = containers.get(alice)!.querySelector<HTMLElement>('.docx-remote-caret');
      expect(painted).not.toBeNull();
      return { top: parseFloat(painted!.style.top), left: parseFloat(painted!.style.left) };
    };
    // The end of the first side and the start of the result paint at one spot; the result's
    // text follows on the same line.
    const firstEnd = await remoteCaret(0, alice.session.bodyText().split('\n')[0]!.length);
    const resultStart = await remoteCaret(3, 0);
    const insideResult = await remoteCaret(3, 2);
    expect(resultStart.top).toBeCloseTo(firstEnd.top, 3);
    expect(resultStart.left).toBeCloseTo(firstEnd.left, 1);
    expect(insideResult.top).toBeCloseTo(firstEnd.top, 3);
    expect(insideResult.left).toBeGreaterThan(firstEnd.left);

    // Delete at the end of the first side takes the first character of the second, in Bob's
    // editor, and shares that edit.
    caret(bob, 0, 9);
    bob.deleteForward();
    expect(bob.state().lastRejection).toBeNull();
    converged(['A before es! after B']);
    bob.undo();
    converged(['A before Yes! after B']);

    alice.undo();
    converged(['before Yes! after B']);
    alice.undo();
    converged(['before', 'Z', '', 'Yes! after B']);
    alice.redo();
    converged(['before Yes! after B']);

    // Bob types at the start of the result while Alice types at its end. Bob's insert lands at
    // the end of the first side, outside the field codes, in both editors.
    peers.pause();
    caret(bob, 3, 0);
    bob.type('Q');
    caret(alice, 3, 12);
    alice.type('.');
    peers.resume();
    converged(['before QYes! after B.']);
    expect(alice.session.paragraphIds()).toHaveLength(4);
    // Enter there splits before the field's begin: the field codes keep their marks.
    caret(bob, 3, 0);
    bob.splitParagraph();
    converged(['before Q', 'Yes! after B.']);
    expect(alice.session.paragraphIds()).toHaveLength(5);
    bob.undo();
    converged(['before QYes! after B.']);

    // Alice deletes the first side up to the result, while Bob types in the result. Both
    // converge on one document, and save keeps it.
    peers.pause();
    const [opening, result] = [0, 3].map((index) => alice.session.paragraphIds()[index]!);
    alice.setSelection({
      anchor: { paragraphId: opening!, offset: 0 },
      head: { paragraphId: result!, offset: 0 },
    });
    alice.deleteSelection();
    caret(bob, 3, 3);
    bob.type('?');
    peers.resume();
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    expect(alice.session.bodyText()).toBe(bob.session.bodyText());
    // The field-code marks stay, so the field still shows its result on one line.
    const finalLines = ['Yes?! after B.'];
    expect(alice.session.paragraphIds()).toHaveLength(4);
    expect(shown(alice)).toEqual(finalLines);
    expect(shown(bob)).toEqual(finalLines);

    expect(shown(open(alice.save()))).toEqual(finalLines);
    expect(shown(open(bob.save()))).toEqual(finalLines);
  } finally {
    for (const surface of active) surface.destroy();
    for (const container of containers.values()) container.remove();
    harness.cleanup();
  }
});
