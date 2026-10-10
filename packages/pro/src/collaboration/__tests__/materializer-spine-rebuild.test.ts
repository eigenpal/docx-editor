/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A parent that rebuilds only because something under it changed reuses its last child list.
// That list must be complete: a child the last build skipped shows when it arrives, and a
// parent whose children adoption changed rebuilds in full. Each case compares an incremental
// replica with a cold one built from the same shared state.

import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { WML_NAMESPACE_URI } from '@docx-editor.dev/core/store';
import { collaborationDocx } from './support.ts';
import {
  destroyReplica,
  expectConverged,
  findText,
  joinReplica,
  loadPackage,
  packageOf,
  seedReplica,
  shownParentOf,
  walk,
} from './document-support.ts';
import { asLogicalId } from '../document/identity.ts';

function deliver(from: Y.Doc, to: Y.Doc): Uint8Array {
  const update = Y.encodeStateAsUpdate(from, Y.encodeStateVector(to));
  Y.applyUpdate(to, update, 'sync');
  return update;
}

function paragraphCount(replica: Parameters<typeof packageOf>[0]): number {
  let count = 0;
  for (const part of packageOf(replica).parts.values()) {
    walk(part.root, (node) => {
      if (node.kind === 'paragraph') count += 1;
    });
  }
  return count;
}

describe('spine rebuild of an unchanged parent', () => {
  test('a child listed before its record arrives shows when the record arrives', async () => {
    const author = await seedReplica(loadPackage(collaborationDocx()));
    const receiver = joinReplica(author);
    try {
      const paragraphId = shownParentOf(
        author,
        findText(packageOf(author), 'Alpha paragraph').id,
        'paragraph'
      );
      const bodyId = author.registry.parentOf(paragraphId);
      if (!bodyId) throw new Error('body missing');
      const added = asLogicalId('pending-paragraph');
      // The listing and the record travel in two updates, as two transactions do.
      author.doc.transact(() => author.registry.spliceChildren(bodyId, 1, 0, [added]));
      const listing = Y.encodeStateAsUpdate(author.doc, Y.encodeStateVector(receiver.doc));
      author.doc.transact(() =>
        author.registry.putElement({
          logicalId: added,
          kind: 'paragraph',
          namespaceUri: WML_NAMESPACE_URI,
          localName: 'p',
          prefix: 'w',
          attributes: [],
          bindings: [],
        })
      );
      Y.applyUpdate(receiver.doc, listing, 'sync');
      expect(receiver.materializer.rebuild().ok).toBe(true);
      const before = paragraphCount(receiver);
      deliver(author.doc, receiver.doc);
      expect(receiver.materializer.rebuild().ok).toBe(true);
      expect(paragraphCount(receiver)).toBe(before + 1);
      const cold = joinReplica(receiver, 3);
      try {
        expectConverged(receiver, cold);
      } finally {
        destroyReplica(cold);
      }
    } finally {
      destroyReplica(receiver);
      destroyReplica(author);
    }
  });
});
