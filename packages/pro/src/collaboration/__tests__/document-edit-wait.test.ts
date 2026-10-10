/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import type { TreeDocOp } from '@docx-editor.dev/core/store';
import { EditWait } from '../document-edit-wait.ts';

/** A document holding back an update until `release` applies the one it depends on. */
function heldBack() {
  const doc = new Y.Doc();
  const other = new Y.Doc();
  const updates: Uint8Array[] = [];
  other.on('update', (update: Uint8Array) => updates.push(update));
  other.getMap('held').set('first', 1);
  other.getMap('held').set('second', 2);
  Y.applyUpdate(doc, updates[1]!);
  return { doc, release: () => Y.applyUpdate(doc, updates[0]!) };
}

const typeIn = (paragraphId: string): TreeDocOp[] => [
  { op: 'insertText', paragraphId, offset: 0, text: 'x' },
];

describe('edits that wait for the room', () => {
  test('an edit of a paragraph a held-back update carries waits; others go through', () => {
    const { doc, release } = heldBack();
    const published: boolean[] = [];
    const wait = new EditWait({
      ydoc: doc,
      viewWaiting: () => false,
      nodeWaits: (id) => id === 'held-paragraph',
      publish: (waiting) => published.push(waiting),
    });
    expect(wait.refuses(typeIn('other-paragraph'))).toBe(false);
    expect(wait.refuses(typeIn('held-paragraph'))).toBe(true);
    release();
    wait.refresh();
    expect(wait.refuses(typeIn('held-paragraph'))).toBe(false);
    expect(published).toEqual([true, false]);
  });

  test('ids in lists and nested records wait too, and whole-story edits wait', () => {
    const { doc, release } = heldBack();
    const wait = new EditWait({
      ydoc: doc,
      viewWaiting: () => false,
      nodeWaits: (id) => id === 'held-run',
      publish: () => {},
    });
    const refused = (op: Record<string, unknown>): boolean =>
      wait.refuses([op as unknown as TreeDocOp]);
    expect(refused({ op: 'acceptRevision', siteNodeIds: ['other', 'held-run'] })).toBe(true);
    expect(refused({ op: 'setRevisionAttribution', sites: [{ nodeId: 'held-run' }] })).toBe(true);
    expect(refused({ op: 'setRunProperties', targetRunIds: ['held-run'] })).toBe(true);
    expect(refused({ op: 'acceptAllRevisions' })).toBe(true);
    expect(refused({ op: 'replaceStoryBlocks', storyRootId: 'body' })).toBe(true);
    expect(refused({ op: 'acceptRevision', siteNodeIds: ['other'] })).toBe(false);
    release();
    wait.refresh();
    expect(refused({ op: 'acceptAllRevisions' })).toBe(false);
  });

  test('without a held-back update, nothing asks which nodes an edit addresses', () => {
    let asked = 0;
    const wait = new EditWait({
      ydoc: new Y.Doc(),
      viewWaiting: () => false,
      nodeWaits: () => {
        asked += 1;
        return true;
      },
      publish: () => {},
    });
    expect(wait.refuses(typeIn('p'))).toBe(false);
    expect(asked).toBe(0);
  });

  test('a view behind shared state makes every edit wait', () => {
    const wait = new EditWait({
      ydoc: new Y.Doc(),
      viewWaiting: () => true,
      nodeWaits: () => false,
      publish: () => {},
    });
    expect(wait.refuses(typeIn('p'))).toBe(true);
  });
});
