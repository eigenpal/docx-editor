/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPackage,
  semanticDigest,
} from '@docx-editor.dev/core/store';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import {
  createTextCollaboration,
  type TextCollaborationHandle,
  type TextCollaborationSession,
} from '../session.ts';
import { collaborationDocx, storeAndPort } from './support.ts';

const ROOM = 'collaboration-conformance-room';

interface Replica {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  readonly room: TextCollaborationHandle;
  readonly session: TextCollaborationSession;
  readonly canonical: ReturnType<typeof storeAndPort>;
  readonly detach: () => void;
}

async function joinReplica(
  initialUpdate: Uint8Array,
  actorId: string,
  sessionId: string
): Promise<Replica> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, initialUpdate, 'initial-state');
  const awareness = new Awareness(doc);
  const room = await createTextCollaboration({
    ydoc: doc,
    awareness,
    documentId: ROOM,
    sessionId,
    identity: { actorId, name: actorId, role: 'agent' },
    bootstrap: { kind: 'join' },
  });
  const canonical = storeAndPort(room.document, ROOM);
  const detach = room.session.attach(canonical.port);
  return { doc, awareness, room, session: room.session, canonical, detach };
}

function destroy(replica: Replica): void {
  replica.detach();
  replica.room.destroy();
  replica.awareness.destroy();
  replica.doc.destroy();
}

function mainPart(saved: Uint8Array) {
  const opened = readOoxmlPackage(saved);
  if (!opened.ok) throw new Error('converged package did not reopen');
  const main = opened.package.parts.get(opened.package.mainDocumentPart);
  if (!main) throw new Error('converged package has no main part');
  return main;
}

function insert(
  replica: Replica,
  paragraphIndex: number,
  offset: number,
  text: string,
  operationId: string
): void {
  const paragraph = replica.canonical.port.paragraphs()[paragraphIndex]!;
  const next = `${paragraph.text.slice(0, offset)}${text}${paragraph.text.slice(offset)}`;
  const result = replica.canonical.port.applyParagraphText(paragraph.paragraphId, next, {
    origin: 'test-local',
    actorId: replica.session.identity.actorId,
    operationId,
  });
  if (!result.ok) throw new Error(result.reason);
}

describe('paragraph collaboration conformance', () => {
  test('reordered, duplicated, and disconnected deliveries converge without replay changes', async () => {
    const leftDoc = new Y.Doc();
    const leftAwareness = new Awareness(leftDoc);
    const leftRoom = await createTextCollaboration({
      ydoc: leftDoc,
      awareness: leftAwareness,
      documentId: ROOM,
      sessionId: 'left-session',
      identity: { actorId: 'left', name: 'left', role: 'agent' },
      bootstrap: { kind: 'create', document: collaborationDocx() },
    });
    const leftCanonical = storeAndPort(leftRoom.document, ROOM);
    const detachLeft = leftRoom.session.attach(leftCanonical.port);
    const initialUpdate = Y.encodeStateAsUpdate(leftDoc);
    const right = await joinReplica(initialUpdate, 'right', 'right-session');
    const offline = await joinReplica(initialUpdate, 'offline', 'offline-session');
    const left: Replica = {
      doc: leftDoc,
      awareness: leftAwareness,
      room: leftRoom,
      session: leftRoom.session,
      canonical: leftCanonical,
      detach: detachLeft,
    };

    try {
      const baseline = Y.encodeStateVector(leftDoc);
      insert(left, 0, 5, '[left]', 'left-session:1');
      insert(right, 0, 5, '[right]', 'right-session:1');
      offline.session.setTransportStatus('disconnected', 'transport-disconnected', 'test-offline');
      insert(offline, 1, 3, '[offline]', 'offline-session:1');

      const updates = [
        Y.encodeStateAsUpdate(left.doc, baseline),
        Y.encodeStateAsUpdate(right.doc, baseline),
        Y.encodeStateAsUpdate(offline.doc, baseline),
      ] as const;
      for (const update of [updates[2], updates[1]]) {
        Y.applyUpdate(left.doc, update, 'reordered-provider');
      }
      for (const update of [updates[2], updates[0], updates[0]]) {
        Y.applyUpdate(right.doc, update, 'duplicated-provider');
      }
      for (const update of [updates[1], updates[0]]) {
        Y.applyUpdate(offline.doc, update, 'reconnected-provider');
      }
      offline.session.setTransportStatus('ready');

      const texts = [left, right, offline].map((replica) =>
        replica.canonical.port.paragraphs().map((paragraph) => paragraph.text)
      );
      expect(texts[1]).toEqual(texts[0]);
      expect(texts[2]).toEqual(texts[0]);

      const parts = [left, right, offline].map((replica) =>
        mainPart(replica.canonical.port.save())
      );
      expect(new Set(parts.map(canonicalOoxmlFingerprint)).size).toBe(1);
      expect(semanticDigest([parts[1]!])).toEqual(semanticDigest([parts[0]!]));
      expect(semanticDigest([parts[2]!])).toEqual(semanticDigest([parts[0]!]));

      const revisions = [left, right, offline].map((replica) => replica.canonical.port.revision());
      for (const replica of [left, right, offline]) {
        for (const update of updates) Y.applyUpdate(replica.doc, update, 'duplicate-replay');
      }
      expect([left, right, offline].map((replica) => replica.canonical.port.revision())).toEqual(
        revisions
      );
    } finally {
      destroy(offline);
      destroy(right);
      destroy(left);
    }
  });
});
