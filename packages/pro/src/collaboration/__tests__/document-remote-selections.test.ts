/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A peer's caret moves with the text other people type around it, instead of standing at its
// old offset for a round trip.
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import type { CollaborationDocumentPort } from '@docx-editor.dev/core/collaboration/replication';
import { AWARENESS_FIELD, textDigest } from '../document-awareness.ts';
import { mapOffsetAcrossText } from '@docx-editor.dev/core/collaboration/replication';
import { RemoteSelectionResolver } from '../document-remote-selections.ts';

const PARAGRAPH = 'AAAAAAAA';

/** A viewer's awareness holding one peer whose caret sits at `offset`. */
function viewerWithPeerAt(offset: number) {
  const viewer = new Awareness(new Y.Doc());
  const peer = new Awareness(new Y.Doc());
  const publish = (at: number) => {
    peer.setLocalStateField(AWARENESS_FIELD, {
      actorId: 'carol',
      name: 'Carol',
      role: 'human',
      selection: {
        anchor: { paragraphId: PARAGRAPH, offset: at },
        head: { paragraphId: PARAGRAPH, offset: at },
      },
    });
    applyAwarenessUpdate(viewer, encodeAwarenessUpdate(peer, [peer.clientID]), 'relay');
  };
  publish(offset);
  return { viewer, publish };
}

function portWith(text: () => string): CollaborationDocumentPort {
  return {
    paragraphByStableId: (id: string) =>
      id === PARAGRAPH ? { paragraphId: PARAGRAPH, nodeId: 'p0', text: text() } : null,
  } as unknown as CollaborationDocumentPort;
}

describe('remote cursors follow the text', () => {
  test('text typed before a peer caret moves the caret before the peer republishes', () => {
    let text = 'Alpha paragraph';
    const { viewer } = viewerWithPeerAt(5);
    const resolver = new RemoteSelectionResolver();
    const port = portWith(() => text);
    expect(resolver.resolve(viewer, port)[0]?.head.offset).toBe(5);
    text = 'Big Alpha paragraph';
    expect(resolver.resolve(viewer, port)[0]?.head.offset).toBe(9);
  });

  test('a peer whose paragraph did not change keeps its answer without a new alignment', () => {
    // Every presence change and every paint resolves all peers; a large room must not align
    // each unchanged paragraph again.
    let text = 'Alpha paragraph';
    const { viewer } = viewerWithPeerAt(5);
    const resolver = new RemoteSelectionResolver();
    const port = portWith(() => text);
    const first = resolver.resolve(viewer, port)[0]?.head;
    expect(resolver.resolve(viewer, port)[0]?.head).toBe(first!);
    text = 'Big Alpha paragraph';
    expect(resolver.resolve(viewer, port)[0]?.head.offset).toBe(9);
  });

  test('a fresh position from the peer starts over from the text it now sees', () => {
    let text = 'Alpha paragraph';
    const { viewer, publish } = viewerWithPeerAt(5);
    const resolver = new RemoteSelectionResolver();
    const port = portWith(() => text);
    resolver.resolve(viewer, port);
    text = 'Big Alpha paragraph';
    publish(9);
    expect(resolver.resolve(viewer, port)[0]?.head.offset).toBe(9);
    text = 'Big Alpha paragraph!';
    expect(resolver.resolve(viewer, port)[0]?.head.offset).toBe(9);
  });

  test('a peer whose presence arrived before its text is held, not pushed further ahead', () => {
    // The peer typed "1234" and published offset 9 before its text reached us.
    expect(mapOffsetAcrossText(9, 'Alpha', 'Alpha')).toBe(5);
    expect(mapOffsetAcrossText(9, 'Alpha', 'Alpha12')).toBe(7);
    expect(mapOffsetAcrossText(9, 'Alpha', 'Alpha1234')).toBe(9);
  });

  test('a deletion around the caret collapses it to where the deletion began', () => {
    // "Alpha paragraph" loses "pha pa" (offsets 2 to 8).
    expect(mapOffsetAcrossText(5, 'Alpha paragraph', 'Alragraph')).toBe(2);
    expect(mapOffsetAcrossText(10, 'Alpha paragraph', 'Alragraph')).toBe(4);
    expect(mapOffsetAcrossText(2, 'Alpha paragraph', 'Alragraph')).toBe(2);
    expect(mapOffsetAcrossText(15, 'Alpha paragraph', 'Alragraph')).toBe(9);
  });

  test('two edits around an offset keep it next to the same character', () => {
    // "a" removed before the offset, "Z" added after it: neither end of the text is shared.
    expect(mapOffsetAcrossText(2, 'abcdef', 'bcdefZ')).toBe(1);
    expect(mapOffsetAcrossText(4, 'abcdef', 'bcdefZ')).toBe(3);
    // An offset inside replaced characters lands where the replacement starts.
    expect(mapOffsetAcrossText(3, 'abcdef', 'Xab12efY')).toBe(3);
  });

  test('presence that arrives before its text holds the offset until the text catches up', () => {
    // Carol types "XY" at 2 and publishes her caret at 4 with the text she sees. Her presence
    // reaches the viewer first, so the viewer still holds the older text.
    let text = 'Alpha';
    const viewer = new Awareness(new Y.Doc());
    const peer = new Awareness(new Y.Doc());
    const at = { paragraphId: PARAGRAPH, offset: 4, digest: textDigest('AlXYpha') };
    peer.setLocalStateField(AWARENESS_FIELD, {
      actorId: 'carol',
      name: 'Carol',
      role: 'human',
      selection: { anchor: at, head: at },
    });
    applyAwarenessUpdate(viewer, encodeAwarenessUpdate(peer, [peer.clientID]), 'relay');
    const resolver = new RemoteSelectionResolver();
    const port = portWith(() => text);
    expect(resolver.resolve(viewer, port)[0]?.head.offset).toBe(4);
    // Her text arrives: the caret stays after "XY", not two characters further.
    text = 'AlXYpha';
    expect(resolver.resolve(viewer, port)[0]?.head.offset).toBe(4);
    // Later text before the caret still moves it.
    text = '!AlXYpha';
    expect(resolver.resolve(viewer, port)[0]?.head.offset).toBe(5);
  });
});
