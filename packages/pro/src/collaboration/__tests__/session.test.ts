/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPackage,
  semanticDigest,
} from '@docx-editor.dev/core/store';
import { strFromU8, unzipSync } from 'fflate';
import { createTextCollaboration } from '../session.ts';
import { MAX_BASELINE_BYTES, schemaOf } from '../schema.ts';
import { applyLocal, collaborationDocx, storeAndPort } from './support.ts';

const ROOM = 'collaboration-test-room';

function sync(source: Y.Doc, target: Y.Doc): void {
  const update = Y.encodeStateAsUpdate(source, Y.encodeStateVector(target));
  Y.applyUpdate(target, update, 'test-provider');
}

async function replicas() {
  const leftDoc = new Y.Doc();
  const leftAwareness = new Awareness(leftDoc);
  const left = await createTextCollaboration({
    ydoc: leftDoc,
    awareness: leftAwareness,
    documentId: ROOM,
    identity: { actorId: 'alice', name: 'Alice' },
    bootstrap: { kind: 'create', document: collaborationDocx() },
  });

  const rightDoc = new Y.Doc();
  Y.applyUpdate(rightDoc, Y.encodeStateAsUpdate(leftDoc), 'test-provider');
  const rightAwareness = new Awareness(rightDoc);
  const right = await createTextCollaboration({
    ydoc: rightDoc,
    awareness: rightAwareness,
    documentId: ROOM,
    identity: { actorId: 'bob', name: 'Bob' },
    bootstrap: { kind: 'join' },
  });

  const leftCanonical = storeAndPort(left.document);
  const rightCanonical = storeAndPort(right.document);
  const detachLeft = left.session.attach(leftCanonical.port);
  const detachRight = right.session.attach(rightCanonical.port);
  return {
    left,
    leftDoc,
    leftAwareness,
    leftCanonical,
    right,
    rightDoc,
    rightAwareness,
    rightCanonical,
    destroy() {
      detachLeft();
      detachRight();
      left.destroy();
      right.destroy();
      leftAwareness.destroy();
      rightAwareness.destroy();
      leftDoc.destroy();
      rightDoc.destroy();
    },
  };
}

describe('provider-neutral Yjs collaboration', () => {
  test('creator transfers one bounded normalized baseline to a joiner', async () => {
    const state = await replicas();
    try {
      expect(
        state.leftCanonical.port.paragraphs().map((paragraph) => paragraph.paragraphId)
      ).toEqual(['11111111', '22222222', '33333333']);
      expect(state.right.document).toEqual(state.left.document);
      expect(state.left.session.status()).toBe('ready');
      expect(state.right.session.status()).toBe('ready');
    } finally {
      state.destroy();
    }
  });

  test('a local canonical edit is not rematerialized through every shared paragraph', async () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const room = await createTextCollaboration({
      ydoc,
      awareness,
      documentId: ROOM,
      identity: { actorId: 'alice', name: 'Alice' },
      bootstrap: { kind: 'create', document: collaborationDocx() },
    });
    const canonical = storeAndPort(room.document);
    let remoteApplyCalls = 0;
    const detach = room.session.attach({
      ...canonical.port,
      applyParagraphText: (...args) => {
        remoteApplyCalls += 1;
        return canonical.port.applyParagraphText(...args);
      },
    });
    try {
      const paragraph = canonical.port.paragraphs()[0]!;
      applyLocal(
        canonical.store,
        {
          op: 'insertText',
          paragraphId: paragraph.nodeId,
          offset: 5,
          text: '!',
        },
        'alice',
        'alice-local'
      );
      expect(remoteApplyCalls).toBe(0);
      expect(schemaOf(ydoc).paragraphs.get(paragraph.paragraphId)!.toString()).toContain('!');
    } finally {
      detach();
      room.destroy();
      awareness.destroy();
      ydoc.destroy();
    }
  });

  test('one remote transaction touching several paragraphs publishes one canonical revision', async () => {
    const state = await replicas();
    let publications = 0;
    const unsubscribe = state.leftCanonical.store.subscribe(() => {
      publications += 1;
    });
    try {
      const before = state.leftCanonical.port.revision();
      const { paragraphs } = schemaOf(state.leftDoc);
      state.leftDoc.transact(() => {
        paragraphs.get('11111111')!.insert(0, '[first]');
        paragraphs.get('22222222')!.insert(0, '[second]');
      }, 'remote-batch');

      expect(state.leftCanonical.port.paragraphs().map((paragraph) => paragraph.text)).toEqual([
        '[first]Alpha paragraph',
        '[second]Bravo paragraph',
        'Charlie paragraph',
      ]);
      expect(state.leftCanonical.port.revision()).toBe(before + 1);
      expect(publications).toBe(1);
    } finally {
      unsubscribe();
      state.destroy();
    }
  });

  test('concurrent same-position insertions converge and actor undo keeps remote work', async () => {
    const state = await replicas();
    try {
      const leftParagraph = state.leftCanonical.port.paragraphs()[0]!;
      const rightParagraph = state.rightCanonical.port.paragraphs()[0]!;
      applyLocal(
        state.leftCanonical.store,
        {
          op: 'insertText',
          paragraphId: leftParagraph.nodeId,
          offset: 5,
          text: '[A]',
        },
        'alice',
        'alice-1'
      );
      applyLocal(
        state.rightCanonical.store,
        {
          op: 'insertText',
          paragraphId: rightParagraph.nodeId,
          offset: 5,
          text: '[B]',
        },
        'bob',
        'bob-1'
      );

      const leftUpdate = Y.encodeStateAsUpdate(state.leftDoc, Y.encodeStateVector(state.rightDoc));
      const rightUpdate = Y.encodeStateAsUpdate(state.rightDoc, Y.encodeStateVector(state.leftDoc));
      Y.applyUpdate(state.leftDoc, rightUpdate, 'test-provider');
      Y.applyUpdate(state.rightDoc, leftUpdate, 'test-provider');
      Y.applyUpdate(state.rightDoc, leftUpdate, 'duplicate-provider-delivery');

      const converged = state.leftCanonical.port.paragraphs()[0]!.text;
      expect(state.rightCanonical.port.paragraphs()[0]!.text).toBe(converged);
      expect(converged).toContain('[A]');
      expect(converged).toContain('[B]');

      expect(state.left.session.undo()).toBe(true);
      sync(state.leftDoc, state.rightDoc);
      const undone = state.leftCanonical.port.paragraphs()[0]!.text;
      expect(state.rightCanonical.port.paragraphs()[0]!.text).toBe(undone);
      expect(undone).not.toContain('[A]');
      expect(undone).toContain('[B]');

      const leftSaved = state.leftCanonical.port.save();
      const rightSaved = state.rightCanonical.port.save();
      const leftPackage = readOoxmlPackage(leftSaved);
      const rightPackage = readOoxmlPackage(rightSaved);
      if (!leftPackage.ok || !rightPackage.ok) throw new Error('saved package did not reopen');
      const leftMain = leftPackage.package.parts.get(leftPackage.package.mainDocumentPart)!;
      const rightMain = rightPackage.package.parts.get(rightPackage.package.mainDocumentPart)!;
      expect(canonicalOoxmlFingerprint(leftMain)).toBe(canonicalOoxmlFingerprint(rightMain));
      expect(semanticDigest([leftMain])).toEqual(semanticDigest([rightMain]));
      expect(strFromU8(unzipSync(leftSaved)['customXml/item1.xml']!)).toContain('keep-me');
      expect(strFromU8(unzipSync(rightSaved)['customXml/item1.xml']!)).toContain('keep-me');
    } finally {
      state.destroy();
    }
  });

  test('overlapping delete and insert converge after delayed delivery', async () => {
    const state = await replicas();
    try {
      const leftParagraph = state.leftCanonical.port.paragraphs()[0]!;
      const rightParagraph = state.rightCanonical.port.paragraphs()[0]!;
      applyLocal(
        state.leftCanonical.store,
        {
          op: 'deleteText',
          paragraphId: leftParagraph.nodeId,
          start: 2,
          end: 9,
        },
        'alice',
        'alice-delete'
      );
      applyLocal(
        state.rightCanonical.store,
        {
          op: 'insertText',
          paragraphId: rightParagraph.nodeId,
          offset: 5,
          text: '[delayed]',
        },
        'bob',
        'bob-insert'
      );
      const leftUpdate = Y.encodeStateAsUpdate(state.leftDoc);
      const rightUpdate = Y.encodeStateAsUpdate(state.rightDoc);
      Y.applyUpdate(state.rightDoc, leftUpdate, 'delayed-provider');
      Y.applyUpdate(state.leftDoc, rightUpdate, 'reverse-provider');
      expect(state.leftCanonical.port.paragraphs()[0]!.text).toBe(
        state.rightCanonical.port.paragraphs()[0]!.text
      );
    } finally {
      state.destroy();
    }
  });

  test('three independent replicas converge under different delivery orders', async () => {
    const state = await replicas();
    const thirdDoc = new Y.Doc();
    Y.applyUpdate(thirdDoc, Y.encodeStateAsUpdate(state.leftDoc), 'test-provider');
    const thirdAwareness = new Awareness(thirdDoc);
    const third = await createTextCollaboration({
      ydoc: thirdDoc,
      awareness: thirdAwareness,
      documentId: ROOM,
      identity: { actorId: 'carol', name: 'Carol' },
      bootstrap: { kind: 'join' },
    });
    const thirdCanonical = storeAndPort(third.document);
    const detachThird = third.session.attach(thirdCanonical.port);
    try {
      for (const [canonical, marker, actor] of [
        [state.leftCanonical, '[L]', 'alice'],
        [state.rightCanonical, '[R]', 'bob'],
        [thirdCanonical, '[T]', 'carol'],
      ] as const) {
        const paragraph = canonical.port.paragraphs()[1]!;
        applyLocal(
          canonical.store,
          { op: 'insertText', paragraphId: paragraph.nodeId, offset: 3, text: marker },
          actor,
          `${actor}-three-way`
        );
      }
      const updates = [
        Y.encodeStateAsUpdate(state.leftDoc),
        Y.encodeStateAsUpdate(state.rightDoc),
        Y.encodeStateAsUpdate(thirdDoc),
      ];
      for (const update of [updates[2]!, updates[0]!, updates[1]!]) {
        Y.applyUpdate(state.leftDoc, update, 'three-way-provider');
      }
      for (const update of [updates[0]!, updates[1]!, updates[2]!]) {
        Y.applyUpdate(state.rightDoc, update, 'three-way-provider');
      }
      for (const update of [updates[1]!, updates[2]!, updates[0]!]) {
        Y.applyUpdate(thirdDoc, update, 'three-way-provider');
      }
      const texts = [
        state.leftCanonical.port.paragraphs()[1]!.text,
        state.rightCanonical.port.paragraphs()[1]!.text,
        thirdCanonical.port.paragraphs()[1]!.text,
      ];
      expect(new Set(texts).size).toBe(1);
      expect(texts[0]).toContain('[L]');
      expect(texts[0]).toContain('[R]');
      expect(texts[0]).toContain('[T]');
    } finally {
      detachThird();
      third.destroy();
      thirdAwareness.destroy();
      thirdDoc.destroy();
      state.destroy();
    }
  });

  test('awareness selections move without a canonical revision', async () => {
    const state = await replicas();
    try {
      const before = state.rightCanonical.port.revision();
      state.left.session.setLocalSelection({
        anchor: { paragraphId: '11111111', offset: 2 },
        head: { paragraphId: '11111111', offset: 7 },
      });
      applyAwarenessUpdate(
        state.rightAwareness,
        encodeAwarenessUpdate(state.leftAwareness, [state.leftAwareness.clientID]),
        'test-provider'
      );
      expect(state.right.session.remoteSelections()).toMatchObject([
        {
          actorId: 'alice',
          anchor: { paragraphId: '11111111', offset: 2 },
          head: { paragraphId: '11111111', offset: 7 },
        },
      ]);
      expect(state.right.session.participants()).toMatchObject([
        { actorId: 'bob', name: 'Bob', isLocal: true },
        { actorId: 'alice', name: 'Alice', isLocal: false },
      ]);
      expect(state.rightCanonical.port.revision()).toBe(before);
    } finally {
      state.destroy();
    }
  });

  test('a two-paragraph awareness selection replicates', async () => {
    const state = await replicas();
    try {
      state.left.session.setLocalSelection({
        anchor: { paragraphId: '11111111', offset: 2 },
        head: { paragraphId: '22222222', offset: 4 },
      });
      applyAwarenessUpdate(
        state.rightAwareness,
        encodeAwarenessUpdate(state.leftAwareness, [state.leftAwareness.clientID]),
        'test-provider'
      );
      expect(state.right.session.remoteSelections()).toMatchObject([
        {
          actorId: 'alice',
          anchor: { paragraphId: '11111111', offset: 2 },
          head: { paragraphId: '22222222', offset: 4 },
        },
      ]);
    } finally {
      state.destroy();
    }
  });

  test('transport status transitions are observable and destroy is terminal', async () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const room = await createTextCollaboration({
      ydoc,
      awareness,
      documentId: ROOM,
      identity: { actorId: 'alice', name: 'Alice' },
      bootstrap: { kind: 'create', document: collaborationDocx() },
    });
    const observed: string[] = [];
    const unsubscribe = room.session.subscribeStatus((status) => observed.push(status));
    room.session.setTransportStatus('disconnected', 'transport-disconnected', 'test-disconnect');
    room.session.setTransportStatus('ready');
    room.destroy();
    expect(observed).toEqual(['disconnected', 'ready', 'destroyed']);
    expect(room.session.status()).toBe('destroyed');
    unsubscribe();
    awareness.destroy();
    ydoc.destroy();
  });

  test('a refused attachment does not wedge the session', async () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const room = await createTextCollaboration({
      ydoc,
      awareness,
      documentId: ROOM,
      identity: { actorId: 'alice', name: 'Alice' },
      bootstrap: { kind: 'create', document: collaborationDocx() },
    });
    const canonical = storeAndPort(room.document);
    const invalidPort = {
      ...canonical.port,
      paragraphs: () => canonical.port.paragraphs().slice(1),
    };
    expect(() => room.session.attach(invalidPort)).toThrow('paragraph-set-mismatch');
    const detach = room.session.attach(canonical.port);
    detach();
    room.destroy();
    awareness.destroy();
    ydoc.destroy();
  });

  test('unsupported structure is refused before canonical or shared mutation', async () => {
    const state = await replicas();
    try {
      const paragraph = state.leftCanonical.port.paragraphs()[0]!;
      const before = Y.encodeStateAsUpdate(state.leftDoc);
      expect(
        state.left.session.gateOperations(
          [{ op: 'splitParagraph', paragraphId: paragraph.nodeId, offset: 3 }],
          { kind: 'body' }
        )
      ).toBe('experimental-collaboration-text-only');
      expect(Y.encodeStateAsUpdate(state.leftDoc)).toEqual(before);
    } finally {
      state.destroy();
    }
  });

  test('an unsupported shared paragraph key quarantines the replica atomically', async () => {
    const state = await replicas();
    try {
      const before = state.leftCanonical.port.paragraphs();
      const { paragraphs } = schemaOf(state.leftDoc);
      state.leftDoc.transact(() => {
        paragraphs.set('44444444', new Y.Text('hostile'));
      }, 'hostile-peer');
      expect(state.left.session.status()).toBe('error');
      expect(state.leftCanonical.port.paragraphs()).toEqual(before);
    } finally {
      state.destroy();
    }
  });

  test('immutable baseline metadata changes quarantine the session', async () => {
    const state = await replicas();
    try {
      const before = state.leftCanonical.port.paragraphs();
      schemaOf(state.leftDoc).root.set('baselineSha256', '0'.repeat(64));
      expect(state.left.session.status()).toBe('error');
      state.left.session.setTransportStatus('ready');
      expect(state.left.session.status()).toBe('error');
      expect(state.leftCanonical.port.paragraphs()).toEqual(before);
    } finally {
      state.destroy();
    }
  });

  test('oversized baselines and competing initialization are refused', async () => {
    const oversizedDoc = new Y.Doc();
    const oversizedAwareness = new Awareness(oversizedDoc);
    await expect(
      createTextCollaboration({
        ydoc: oversizedDoc,
        awareness: oversizedAwareness,
        documentId: ROOM,
        identity: { actorId: 'alice', name: 'Alice' },
        bootstrap: { kind: 'create', document: new Uint8Array(MAX_BASELINE_BYTES + 1) },
      })
    ).rejects.toThrow('baseline-too-large');
    oversizedAwareness.destroy();
    oversizedDoc.destroy();

    const abortedDoc = new Y.Doc();
    const abortedAwareness = new Awareness(abortedDoc);
    const controller = new AbortController();
    controller.abort();
    await expect(
      createTextCollaboration({
        ydoc: abortedDoc,
        awareness: abortedAwareness,
        documentId: ROOM,
        identity: { actorId: 'joiner', name: 'Joiner' },
        bootstrap: { kind: 'join', signal: controller.signal },
      })
    ).rejects.toThrow('initialization-aborted');
    abortedAwareness.destroy();
    abortedDoc.destroy();

    const ydoc = new Y.Doc();
    const firstAwareness = new Awareness(ydoc);
    const first = await createTextCollaboration({
      ydoc,
      awareness: firstAwareness,
      documentId: ROOM,
      identity: { actorId: 'alice', name: 'Alice' },
      bootstrap: { kind: 'create', document: collaborationDocx() },
    });
    const secondAwareness = new Awareness(ydoc);
    await expect(
      createTextCollaboration({
        ydoc,
        awareness: secondAwareness,
        documentId: ROOM,
        identity: { actorId: 'bob', name: 'Bob' },
        bootstrap: { kind: 'create', document: collaborationDocx() },
      })
    ).rejects.toThrow('already-initialized');
    first.destroy();
    firstAwareness.destroy();
    secondAwareness.destroy();
    ydoc.destroy();
  });

  test('concurrent creators with different baselines quarantine after merge', async () => {
    const leftDoc = new Y.Doc();
    const rightDoc = new Y.Doc();
    const leftAwareness = new Awareness(leftDoc);
    const rightAwareness = new Awareness(rightDoc);
    const left = await createTextCollaboration({
      ydoc: leftDoc,
      awareness: leftAwareness,
      documentId: ROOM,
      identity: { actorId: 'left-creator', name: 'Left creator' },
      bootstrap: { kind: 'create', document: collaborationDocx() },
    });
    const right = await createTextCollaboration({
      ydoc: rightDoc,
      awareness: rightAwareness,
      documentId: ROOM,
      identity: { actorId: 'right-creator', name: 'Right creator' },
      bootstrap: { kind: 'create', document: collaborationDocx('Different baseline') },
    });
    Y.applyUpdate(leftDoc, Y.encodeStateAsUpdate(rightDoc), 'competing-creator');
    Y.applyUpdate(rightDoc, Y.encodeStateAsUpdate(leftDoc), 'competing-creator');
    expect([left.session.status(), right.session.status()]).toContain('error');
    left.destroy();
    right.destroy();
    leftAwareness.destroy();
    rightAwareness.destroy();
    leftDoc.destroy();
    rightDoc.destroy();
  });

  test('oversized shared text enters error without changing canonical state', async () => {
    const state = await replicas();
    try {
      const before = state.leftCanonical.port.paragraphs();
      const text = schemaOf(state.leftDoc).paragraphs.get('11111111')!;
      state.leftDoc.transact(() => {
        text.insert(0, 'x'.repeat(1_000_001));
      }, 'hostile-peer');
      expect(state.left.session.status()).toBe('error');
      expect(state.leftCanonical.port.paragraphs()).toEqual(before);
    } finally {
      state.destroy();
    }
  });

  test('local oversized text is refused before canonical or shared mutation', async () => {
    const state = await replicas();
    try {
      const paragraph = state.leftCanonical.port.paragraphs()[0]!;
      const before = paragraph.text;
      expect(
        state.left.session.gateOperations(
          [
            {
              op: 'insertText',
              paragraphId: paragraph.nodeId,
              offset: 0,
              text: 'x'.repeat(1_000_001),
            },
          ],
          { kind: 'body' }
        )
      ).toBe('collaboration-text-limit');
      expect(state.leftCanonical.port.paragraphs()[0]!.text).toBe(before);
      expect(schemaOf(state.leftDoc).paragraphs.get(paragraph.paragraphId)!.toString()).toBe(
        before
      );
    } finally {
      state.destroy();
    }
  });
});
