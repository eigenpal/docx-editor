/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A node's kind is a string a peer writes. Kinds that name object prototype members must not
// reach a lookup table as keys: every replica rebuilds that node on every pass, so a throw
// there would stop the whole room from materializing.

import { describe, expect, test } from 'bun:test';
import { WML_NAMESPACE_URI } from '@docx-editor.dev/core/store';
import { collaborationDocx } from './support.ts';
import {
  destroyReplica,
  findText,
  joinReplica,
  loadPackage,
  packageOf,
  seedReplica,
  shownParentOf,
  syncOne,
} from './document-support.ts';
import { asLogicalId } from '../document/identity.ts';

describe('node kinds that name prototype members', () => {
  for (const kind of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    test(`a node of kind ${kind} with children materializes on every replica`, async () => {
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
        const hostile = asLogicalId(`hostile-${kind}`);
        const child = asLogicalId(`hostile-${kind}-child`);
        author.doc.transact(() => {
          for (const id of [hostile, child]) {
            author.registry.putElement({
              logicalId: id,
              kind: id === hostile ? kind : 'generic',
              namespaceUri: WML_NAMESPACE_URI,
              localName: 'customXml',
              prefix: 'w',
              attributes: [],
              bindings: [],
            });
          }
          author.registry.spliceChildren(hostile, 0, 0, [child]);
          author.registry.spliceChildren(bodyId, 0, 0, [hostile]);
        });
        expect(() => author.materializer.rebuild()).not.toThrow();
        expect(() => syncOne(author, receiver)).not.toThrow();
        expect(() => receiver.materializer.rebuildFull()).not.toThrow();
      } finally {
        destroyReplica(receiver);
        destroyReplica(author);
      }
    });
  }
});
