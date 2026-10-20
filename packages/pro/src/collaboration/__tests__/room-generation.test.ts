/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A room only grows, so a server compacts it into a new generation when it loads the room.
// The new generation holds the same document, and a replica that still holds the previous
// generation is refused before any of its state merges.

import { afterEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import {
  checkCollaborationRoomGeneration,
  compactCollaborationState,
  readCollaborationRoomGeneration,
} from '../room-generation.ts';
import { readCollaborationDocument } from '../document-read.ts';
import { createHocuspocusCollaboration } from '../hocuspocus.ts';
import { HOCUSPOCUS_PROVIDER_FOR_TESTS } from '../hocuspocus-test-provider.ts';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';
import { collaborationDocx } from './support.ts';
import { readOoxmlPackage, type OoxmlNode } from '@docx-editor.dev/core/store';

const harness = createPeerHarness('room-generation-room');

afterEach(() => {
  harness.cleanup();
});

function paragraphTexts(peer: Peer): string[] {
  const texts: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'paragraph') texts.push(nodeText(node));
  });
  return texts;
}

/** The body paragraphs' text of a `.docx` file. */
function textsOfDocx(bytes: Uint8Array): string[] {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const texts: string[] = [];
  const textOf = (node: OoxmlNode): string =>
    node.kind === 'textValue' ? node.value : node.children.map(textOf).join('');
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'paragraph') texts.push(textOf(node));
    else if (node.kind !== 'textValue') for (const child of node.children) visit(child);
  };
  visit(main.root);
  return texts;
}

/** A raw Hocuspocus message: document name, type, and for a stateless message its payload. */
function message(type: number, payload?: string): Uint8Array {
  const bytes: number[] = [];
  const varUint = (value: number): void => {
    let rest = value;
    while (rest >= 0x80) {
      bytes.push((rest & 0x7f) | 0x80);
      rest = Math.floor(rest / 0x80);
    }
    bytes.push(rest);
  };
  const varString = (text: string): void => {
    const encoded = new TextEncoder().encode(text);
    varUint(encoded.length);
    bytes.push(...encoded);
  };
  varString('room');
  varUint(type);
  if (payload !== undefined) varString(payload);
  return new Uint8Array(bytes);
}

const generationPayload = (generation: string | null): string =>
  JSON.stringify({ type: 'docx-room-generation', generation });

describe('compaction', () => {
  test('a room that grew is compacted into a new generation with the same document', async () => {
    const { alice } = await harness.pair(
      zipDocument('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p><w:sectPr/>')
    );
    const paragraphId = harness.paragraphIdAt(alice, 0);
    // Formatting changes on text that is then deleted leave state the room never needs.
    for (let round = 0; round < 60; round += 1) {
      harness.apply(alice, [{ op: 'insertText', paragraphId, offset: 5, text: ' brave' }]);
      harness.apply(alice, [
        {
          op: 'setRunProperties',
          paragraphId,
          start: 6,
          end: 11,
          properties: [{ localName: 'b' }],
        },
      ]);
      harness.apply(alice, [{ op: 'deleteText', paragraphId, start: 5, end: 11 }]);
    }
    harness.apply(alice, [{ op: 'insertText', paragraphId, offset: 11, text: '!' }]);
    const state = Y.encodeStateAsUpdate(alice.ydoc);
    const compacted = await compactCollaborationState(state);
    expect(compacted).not.toBeNull();
    expect(compacted!.byteLength * 2).toBeLessThanOrEqual(state.byteLength);
    const next = new Y.Doc();
    Y.applyUpdate(next, compacted!);
    expect(readCollaborationRoomGeneration(next)).not.toBe('');
    expect(readCollaborationRoomGeneration(next)).not.toBe(
      readCollaborationRoomGeneration(alice.ydoc)
    );
    expect(textsOfDocx(readCollaborationDocument(next))).toEqual(paragraphTexts(alice));
    next.destroy();
  });

  test('a room whose content was mostly deleted is compacted, though it hardly grew', async () => {
    const paragraphs = Array.from(
      { length: 100 },
      (_, index) =>
        `<w:p><w:r><w:t>Paragraph ${index} with some text to keep it long</w:t></w:r></w:p>`
    ).join('');
    const { alice } = await harness.pair(zipDocument(`${paragraphs}<w:sectPr/>`));
    // The stored state stays near its seed size; the content is now one paragraph.
    for (let index = 99; index >= 1; index -= 1) {
      harness.apply(alice, [
        { op: 'deleteBlock', blockId: harness.paragraphIdAt(alice, index) } as never,
      ]);
    }
    const state = Y.encodeStateAsUpdate(alice.ydoc);
    const compacted = await compactCollaborationState(state);
    expect(compacted).not.toBeNull();
    expect(compacted!.byteLength * 2).toBeLessThanOrEqual(state.byteLength);
    const next = new Y.Doc();
    Y.applyUpdate(next, compacted!);
    expect(textsOfDocx(readCollaborationDocument(next))).toEqual(paragraphTexts(alice));
    next.destroy();
  });

  test('a room with nothing to gain is left as it is', async () => {
    const { alice } = await harness.pair(collaborationDocx());
    expect(await compactCollaborationState(Y.encodeStateAsUpdate(alice.ydoc))).toBeNull();
  });

  test('a room opened again is checked once, and checked again after it changes', async () => {
    const paragraphs = Array.from(
      { length: 60 },
      (_, index) => `<w:p><w:r><w:t>Paragraph ${index} with text to keep it long</w:t></w:r></w:p>`
    ).join('');
    const { alice } = await harness.pair(zipDocument(`${paragraphs}<w:sectPr/>`));
    const unchanged = Y.encodeStateAsUpdate(alice.ydoc);
    expect(await compactCollaborationState(unchanged)).toBeNull();
    // The answer for these bytes is remembered, even for a copy of them.
    expect(await compactCollaborationState(unchanged.slice())).toBeNull();
    // Deleting the content changes the bytes, so the room is checked again and compacted.
    for (let index = 59; index >= 1; index -= 1) {
      harness.apply(alice, [
        { op: 'deleteBlock', blockId: harness.paragraphIdAt(alice, index) } as never,
      ]);
    }
    expect(await compactCollaborationState(Y.encodeStateAsUpdate(alice.ydoc))).not.toBeNull();
  });
});

describe('the server gate', () => {
  test('a client of the room generation passes, and its sync follows', () => {
    const document = new Y.Doc();
    const context = {};
    expect(() =>
      checkCollaborationRoomGeneration({
        context,
        document,
        update: message(5, generationPayload('')),
      })
    ).not.toThrow();
    expect(() =>
      checkCollaborationRoomGeneration({ context, document, update: message(0) })
    ).not.toThrow();
  });

  test('a client of another generation is refused before its sync', () => {
    const document = new Y.Doc();
    const context = {};
    const refusal = (() => {
      try {
        checkCollaborationRoomGeneration({
          context,
          document,
          update: message(5, generationPayload('an-earlier-generation')),
        });
      } catch (error) {
        return error as { code?: number; reason?: string };
      }
      return null;
    })();
    expect(refusal?.reason).toBe('room-generation-changed');
    expect(refusal?.code).toBe(4409);
  });

  test('a sync that names no generation is refused, and a new replica names none', () => {
    const document = new Y.Doc();
    expect(() =>
      checkCollaborationRoomGeneration({ context: {}, document, update: message(0) })
    ).toThrow();
    const context = {};
    checkCollaborationRoomGeneration({
      context,
      document,
      update: message(5, generationPayload(null)),
    });
    expect(() =>
      checkCollaborationRoomGeneration({ context, document, update: message(0) })
    ).not.toThrow();
    // Keep-alive messages carry no state.
    expect(() =>
      checkCollaborationRoomGeneration({ context: {}, document, update: message(9) })
    ).not.toThrow();
  });

  test('a message the gate cannot read is refused', () => {
    const document = new Y.Doc();
    const context = {};
    checkCollaborationRoomGeneration({
      context,
      document,
      update: message(5, generationPayload('')),
    });
    // A room name longer than the message, and a type that never ends.
    for (const update of [new Uint8Array([0x7f, 0x61]), new Uint8Array([1, 0x61, 0xff, 0xff])]) {
      expect(() => checkCollaborationRoomGeneration({ context, document, update })).toThrow(
        'room-generation-changed'
      );
    }
  });
});

describe('the client', () => {
  class FakeProvider {
    isSynced = false;
    readonly sent: string[] = [];
    destroyCount = 0;
    readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
    constructor(readonly document: Y.Doc) {}
    on(event: string, fn: (payload: unknown) => void): this {
      const set = this.listeners.get(event) ?? new Set();
      set.add(fn);
      this.listeners.set(event, set);
      return this;
    }
    off(event: string, fn: (payload: unknown) => void): this {
      this.listeners.get(event)?.delete(fn);
      return this;
    }
    emit(event: string, payload: unknown): void {
      for (const fn of [...(this.listeners.get(event) ?? [])]) fn(payload);
    }
    sendStateless(payload: string): void {
      this.sent.push(payload);
    }
    destroy(): void {
      this.destroyCount += 1;
    }
  }

  test('names its generation on every connection and stops on a changed generation', async () => {
    let provider: FakeProvider | undefined;
    const room = await createHocuspocusCollaboration({
      url: 'wss://collab.example.test',
      roomId: 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
      identity: { actorId: 'alex', name: 'Alex' },
      bootstrap: { kind: 'create', document: collaborationDocx() },
      [HOCUSPOCUS_PROVIDER_FOR_TESTS]: (init: { document: Y.Doc; awareness: Awareness }) => {
        provider = new FakeProvider(init.document);
        setTimeout(() => {
          provider!.emit('open', {});
          provider!.isSynced = true;
          provider!.emit('synced', { state: true });
        }, 0);
        return provider;
      },
    } as Parameters<typeof createHocuspocusCollaboration>[0]);
    // The first connection held no room yet.
    expect(JSON.parse(provider!.sent[0]!)).toEqual({
      type: 'docx-room-generation',
      generation: null,
    });
    // A reconnect names the generation the replica now holds.
    provider!.emit('open', {});
    expect(JSON.parse(provider!.sent[1]!)).toEqual({
      type: 'docx-room-generation',
      generation: '',
    });
    provider!.emit('close', { event: { code: 4409, reason: 'room-generation-changed' } });
    expect(room.session.status()).toBe('error');
    expect(room.session.statusSnapshot().reason).toMatchObject({ code: 'room-generation-changed' });
    expect(provider!.destroyCount).toBe(1);
    room.destroy();
    expect(provider!.destroyCount).toBe(1);
  });
});
