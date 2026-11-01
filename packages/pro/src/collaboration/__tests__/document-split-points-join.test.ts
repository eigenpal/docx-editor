/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Split points belong to the edit that creates a paragraph. A paragraph created with none, as
// a break in an empty paragraph makes, takes none from a later join that moves text into it:
// such a record would count it as a split sibling and could move it among its neighbors.
import { afterEach, expect, test } from 'bun:test';
import type * as Y from 'yjs';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { paragraphTextOf } from '@docx-editor.dev/core/store';
import { collaborationModule, reviewModule } from '../../index';
import { NODE_SPLIT_POINTS_FIELD } from '../document/split-points.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('split-points-join', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

test('a join into a paragraph created without split points writes none', async () => {
  const peers = await harness.pair(
    zipDocument('<w:p/><w:p><w:r><w:t>Next</w:t></w:r></w:p><w:sectPr/>')
  );
  const [alice, bob] = [peers.alice, peers.bob].map((peer, index) => {
    peer.detach();
    const editor = createDocxEditor({
      author: index === 0 ? 'Alice' : 'Bob',
      container: document.createElement('div'),
      document: peer.room.document,
      modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  }) as [Editor, Editor];
  const deliver = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  };
  const ids = (editor: Editor): string[] => {
    const body = editor.surface!.session.part().root.children[0]!;
    return 'children' in body ? body.children.map((child: { id: string }) => child.id) : [];
  };
  const [empty, next] = ids(alice);
  alice.surface!.setSelection({
    anchor: { paragraphId: empty!, offset: 0 },
    head: { paragraphId: empty!, offset: 0 },
  });
  alice.surface!.splitParagraph();
  deliver();
  const created = ids(alice)[1]!;
  expect(created).not.toBe(empty);
  alice.surface!.setSelection({
    anchor: { paragraphId: next!, offset: 0 },
    head: { paragraphId: next!, offset: 0 },
  });
  alice.surface!.deleteBackward();
  deliver();
  for (const editor of [alice, bob]) {
    editor.surface!.layout();
    expect(paragraphTextOf(editor.surface!.session.part(), created)).toBe('Next');
  }
  // The session's shared records, as every replica reads them.
  const registry = (
    peers.alice.room.session as unknown as {
      registry: { schema: { nodes: Y.Map<Y.Map<unknown>> } };
    }
  ).registry;
  expect(registry.schema.nodes.get(created)?.has(NODE_SPLIT_POINTS_FIELD)).toBe(false);
});
