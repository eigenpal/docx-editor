/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A local insert into a child list that a conflict shows out of shared order.
//
// Shared `w:pPr` children [pStyle, rPr, tabs] show as [pStyle, tabs, rPr], because the
// paragraph mark's `w:rPr` may not precede `w:tabs`. An author who inserts between `w:tabs`
// and the mark's `w:rPr` addresses visible index 2. Mapping that to "before the child shown
// there" put the new element before the `w:rPr` in shared order, which every replica then
// shows before `w:tabs`: the author's tree and the room disagreed.

import { describe, expect, test } from 'bun:test';
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { projectJournalToShared } from '../document/projected-journal.ts';
import { applyPrimitiveJournal } from '../document/journal.ts';
import {
  destroyReplica,
  loadPackage,
  packageOf,
  seedReplica,
  walk,
  WML,
} from './document-support.ts';
import { zipDocument } from './document-peer-support.ts';

function paragraphProperties(pkg: ReturnType<typeof packageOf>): OoxmlNode {
  let found: OoxmlNode | null = null;
  walk(pkg.parts.get(pkg.mainDocumentPart)!.root, (node) => {
    if (!found && node.kind === 'paragraphProperties') found = node;
  });
  if (!found) throw new Error('no w:pPr');
  return found;
}

function names(node: OoxmlNode): string[] {
  return node.kind === 'textValue'
    ? []
    : node.children.map((child) => (child.kind === 'textValue' ? '#' : child.localName));
}

describe('visible inserts into a reordered child list', () => {
  test("an insert before the paragraph mark's w:rPr lands there for every replica", async () => {
    const replica = await seedReplica(
      loadPackage(
        zipDocument(
          '<w:p><w:pPr><w:pStyle w:val="Normal"/><w:rPr><w:b/></w:rPr></w:pPr>' +
            '<w:r><w:t>Mark</w:t></w:r></w:p><w:sectPr/>'
        )
      )
    );
    try {
      const pPr = paragraphProperties(packageOf(replica)).id;
      // A peer that had not seen the mark's `w:rPr` appended `w:tabs` after it.
      const tabs = replica.mint.take();
      const appended = applyPrimitiveJournal(replica.registry, {
        effects: [
          {
            kind: 'putNode',
            descriptor: {
              logicalId: tabs,
              kind: 'generic',
              qname: { namespaceUri: WML, localName: 'tabs', prefix: 'w' },
            },
          },
          {
            kind: 'spliceChildren',
            parentLogicalId: pPr,
            start: 2,
            deleteCount: 0,
            childLogicalIds: [tabs],
          },
        ],
      });
      expect(appended.ok).toBe(true);
      replica.materializer.rebuild();
      expect(names(paragraphProperties(packageOf(replica)))).toEqual(['pStyle', 'tabs', 'rPr']);

      // The author inserts `w:jc` at visible index 2: after `w:tabs`, before the mark.
      const jc = replica.mint.take();
      const projected = projectJournalToShared(replica.registry, {
        effects: [
          {
            kind: 'putNode',
            descriptor: {
              logicalId: jc,
              kind: 'generic',
              qname: { namespaceUri: WML, localName: 'jc', prefix: 'w' },
            },
          },
          {
            kind: 'spliceChildren',
            parentLogicalId: pPr,
            start: 2,
            deleteCount: 0,
            childLogicalIds: [jc],
          },
        ],
      });
      if (!projected.ok) throw new Error(projected.code);
      expect(applyPrimitiveJournal(replica.registry, projected.journal, projected.plan).ok).toBe(
        true
      );
      replica.materializer.rebuild();
      expect(names(paragraphProperties(packageOf(replica)))).toEqual([
        'pStyle',
        'tabs',
        'jc',
        'rPr',
      ]);
    } finally {
      destroyReplica(replica);
    }
  });
});
