/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A peer publishes presence for up to 256 clients, each with its own text baseline. One change
// to a paragraph must not align that paragraph once for each of them, and an endpoint in a
// paragraph that is gone must not be looked up again on every paint.
import { describe, expect, mock, test } from 'bun:test';
import * as replication from '@docx-editor.dev/core/collaboration/replication';
import type { CollaborationDocumentPort } from '@docx-editor.dev/core/collaboration/replication';
import type { Awareness } from 'y-protocols/awareness';
import { AWARENESS_FIELD, textDigest } from '../document-awareness.ts';

const aligned: string[] = [];
const mapOffset = replication.mapOffsetAcrossText;
mock.module('@docx-editor.dev/core/collaboration/replication', () => ({
  ...replication,
  mapOffsetAcrossText: (offset: number, before: string, after: string) => {
    aligned.push(before);
    return mapOffset(offset, before, after);
  },
}));
const { RemoteSelectionResolver } = await import('../document-remote-selections.ts');

const PARAGRAPH = 'AAAAAAAA';

function room() {
  let text = '';
  let revision = 0;
  const states = new Map<number, Record<string, unknown>>();
  const port = {
    paragraphByStableId: (id: string) =>
      id === PARAGRAPH ? { paragraphId: PARAGRAPH, nodeId: 'p', text } : null,
    paragraphByNodeId: () => null,
    revision: () => revision,
  } as unknown as CollaborationDocumentPort;
  const awareness = { clientID: 0, getStates: () => states } as unknown as Awareness;
  return {
    port,
    awareness,
    setText(next: string) {
      text = next;
      revision += 1;
    },
    publish(client: number, paragraphId: string, offset: number, character?: object) {
      const address = {
        paragraphId,
        offset,
        digest: textDigest(text),
        ...(character ? { character } : {}),
      };
      states.set(client, {
        [AWARENESS_FIELD]: {
          actorId: `peer-${client}`,
          name: `Peer ${client}`,
          selection: { anchor: address, head: address },
        },
      });
    },
  };
}

describe('remote selection cost a peer controls', () => {
  test('one change aligns a bounded number of text pairs, however many baselines', () => {
    const { port, awareness, setText, publish } = room();
    const resolver = new RemoteSelectionResolver();
    // Each client publishes against a different version of the paragraph.
    for (let client = 1; client <= 64; client += 1) {
      setText(`${'v'.repeat(client)} ${'a'.repeat(400)} tail`);
      publish(client, PARAGRAPH, client + 5);
      resolver.resolve(awareness, port);
    }
    aligned.length = 0;
    setText(`${'b'.repeat(400)} tail`);
    const selections = resolver.resolve(awareness, port);
    expect(selections).toHaveLength(64);
    expect(aligned.length).toBeGreaterThan(0);
    expect(new Set(aligned).size).toBeLessThanOrEqual(16);
  });

  test('an endpoint in a missing paragraph is looked up once per document revision', () => {
    const { port, awareness, setText, publish } = room();
    setText('text');
    for (let client = 1; client <= 8; client += 1) {
      publish(client, 'BBBBBBBB', 1, { item: `${client}:1`, after: false });
    }
    let lookups = 0;
    const find = () => {
      lookups += 1;
      return null;
    };
    const resolver = new RemoteSelectionResolver();
    resolver.resolve(awareness, port, find);
    const first = lookups;
    expect(first).toBeGreaterThan(0);
    for (let paint = 0; paint < 20; paint += 1) resolver.resolve(awareness, port, find);
    expect(lookups).toBe(first);
    setText('text changed');
    resolver.resolve(awareness, port, find);
    expect(lookups).toBe(first * 2);
  });

  test('one resolve looks up a bounded number of published characters', () => {
    const { port, awareness, setText, publish } = room();
    setText('a'.repeat(1000));
    for (let client = 1; client <= 255; client += 1) {
      publish(client, PARAGRAPH, client, { item: `${client}:1`, after: true });
    }
    let lookups = 0;
    const find = () => {
      lookups += 1;
      return null;
    };
    const resolver = new RemoteSelectionResolver();
    resolver.resolve(awareness, port, find);
    for (let change = 0; change < 3; change += 1) {
      lookups = 0;
      // A local keystroke changes the paragraph, so no endpoint keeps its last answer.
      setText(`${'a'.repeat(1000)}${'b'.repeat(change + 1)}`);
      expect(resolver.resolve(awareness, port, find)).toHaveLength(255);
      expect(lookups).toBeLessThanOrEqual(32);
    }
  });
});
