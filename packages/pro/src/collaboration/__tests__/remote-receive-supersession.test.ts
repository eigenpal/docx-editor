/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// What the author's own edit superseded must not come back on the other replica.
//
// An edit that replaces a run tombstones it and names a survivor. The survivor then adopts
// whatever the tombstone still lists, which is how a CONCURRENT peer's child reaches the tree
// instead of disappearing with the run its author never saw removed.
//
// The tombstone also still lists the children the edit itself replaced. A run holds one `w:t`
// per insertion point, so the first insert splits the run and every later structural edit
// mints fresh `w:t` nodes over the old ones. Adopting those put the pre-edit text back beside
// the new text on the receiving replica, and the two replicas never reconciled — the author's
// tree said `AlphaXY paragraph` while every other replica said `AlphaXY paragraphAlpha`.
//
// One insert is not enough to show it, because a run with a single `w:t` has nothing to
// supersede. Each shape here inserts twice first, which is what splits the run.

import { afterEach, describe, expect, test } from 'bun:test';
import type { StoryScope, TreeDocOp } from '@docx-editor.dev/core/store';
import type { CanonicalPrimitiveEffect } from '@docx-editor.dev/core/collaboration/replication';
import {
  BODY,
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';
import {
  applyJournal,
  collectKind,
  concurrent,
  destroyReplica,
  joinReplica,
  loadPackage,
  packageFingerprint,
  packageOf,
  saveReopenDigest,
  seedReplica,
  WML,
  type Replica,
} from './document-support.ts';

const harness = createPeerHarness('remote-receive-supersession');

afterEach(() => {
  harness.cleanup();
});

const REVISION = { author: 'Reviewer' } as const;

function fixture(): Uint8Array {
  return zipDocument(
    '<w:p><w:r><w:t xml:space="preserve">Alpha paragraph</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t xml:space="preserve">Bravo paragraph</w:t></w:r></w:p>' +
      '<w:sectPr/>',
    {
      documentRels:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
    }
  );
}

function paragraphTexts(peer: Peer, scope: StoryScope = BODY): string[] {
  const part = peer.store.partFor(scope);
  if (!part) throw new Error('missing story part');
  const texts: string[] = [];
  walk(part.root, (node) => {
    if (node.kind === 'paragraph') texts.push(nodeText(node));
  });
  return texts;
}

/** Both D9 oracles, on the two replicas' own packages. */
function expectReplicasAgree(alice: Peer, bob: Peer, step: string): void {
  expect(alice.room.session.status(), `${step}: author status`).toBe('ready');
  expect(bob.room.session.status(), `${step}: receiver status`).toBe('ready');
  expect(packageFingerprint(harness.packageOf(bob)), `${step}: fingerprint`).toBe(
    packageFingerprint(harness.packageOf(alice))
  );
  expect(
    JSON.stringify(saveReopenDigest(harness.packageOf(bob))),
    `${step}: save/reopen digest`
  ).toBe(JSON.stringify(saveReopenDigest(harness.packageOf(alice))));
}

/**
 * Split the first run, then run one structural edit over the split range.
 *
 * The two inserts are the setup: they are what leaves the run holding several `w:t` nodes for
 * the structural edit to supersede.
 */
async function afterSplitThen(
  edit: (paragraphId: string) => readonly TreeDocOp[]
): Promise<{ alice: Peer; bob: Peer }> {
  const { alice, bob } = await harness.pair(fixture());
  const paragraphId = harness.paragraphIdAt(alice, 0);
  harness.apply(alice, [{ op: 'insertText', paragraphId, offset: 5, text: 'X' }]);
  harness.apply(alice, [{ op: 'insertText', paragraphId, offset: 6, text: 'Y' }]);
  expect(paragraphTexts(alice)[0], 'split setup').toBe('AlphaXY paragraph');
  expectReplicasAgree(alice, bob, 'after the two inserts');
  harness.apply(alice, edit(paragraphId));
  return { alice, bob };
}

describe('an edit over a split run does not resurrect the text it replaced', () => {
  test('formatting a range of a split run', async () => {
    const { alice, bob } = await afterSplitThen((paragraphId) => [
      {
        op: 'setRunProperties',
        paragraphId,
        start: 0,
        end: 3,
        properties: [{ localName: 'b' }],
      },
    ]);
    expect(paragraphTexts(alice)[0]).toBe('AlphaXY paragraph');
    expect(paragraphTexts(bob)[0]).toBe('AlphaXY paragraph');
    expectReplicasAgree(alice, bob, 'setRunProperties over a split run');
  });

  test('tracked-deleting a range of a split run', async () => {
    const { alice, bob } = await afterSplitThen((paragraphId) => [
      { op: 'deleteText', paragraphId, start: 0, end: 3, revision: REVISION },
    ]);
    // A tracked deletion keeps the characters as `w:delText`, so the text is unchanged. What
    // must not happen is a second copy of `Alpha` arriving with it.
    expect(paragraphTexts(alice)[0]).toBe('AlphaXY paragraph');
    expect(paragraphTexts(bob)[0]).toBe('AlphaXY paragraph');
    expectReplicasAgree(alice, bob, 'tracked deletion over a split run');
  });

  test('hyperlinking a range of a split run', async () => {
    const { alice, bob } = await afterSplitThen((paragraphId) => [
      { op: 'insertHyperlink', paragraphId, start: 0, end: 3, anchor: 'top' },
    ]);
    expect(paragraphTexts(alice)[0]).toBe('AlphaXY paragraph');
    expect(paragraphTexts(bob)[0]).toBe('AlphaXY paragraph');
    expectReplicasAgree(alice, bob, 'hyperlink over a split run');
  });

  test('a concurrent peer types into the same run the format replaces', async () => {
    const { alice, bob, pause, resume } = await harness.pair(fixture());
    const paragraphId = harness.paragraphIdAt(alice, 0);
    harness.apply(alice, [{ op: 'insertText', paragraphId, offset: 5, text: 'X' }]);
    harness.apply(alice, [{ op: 'insertText', paragraphId, offset: 6, text: 'Y' }]);
    expectReplicasAgree(alice, bob, 'before the split');

    // Neither replica sees the other's edit until `resume`, so both are authored against the
    // same run: Bob adds a `w:t` to it and Alice replaces it.
    pause();
    harness.apply(bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 0), offset: 17, text: 'Q' },
    ]);
    harness.apply(alice, [
      {
        op: 'setRunProperties',
        paragraphId,
        start: 0,
        end: 3,
        properties: [{ localName: 'b' }],
      },
    ]);
    resume();
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();

    // Adoption exists for exactly this: Bob's `w:t` hangs off a run Alice tombstoned, and
    // without the rescue his keystroke would vanish with it.
    expect(paragraphTexts(alice)[0], "Bob's character on the author's replica").toBe(
      'AlphaXY paragraphQ'
    );
    expect(paragraphTexts(bob)[0], "Bob's character on his own replica").toBe('AlphaXY paragraphQ');
    expectReplicasAgree(alice, bob, 'concurrent insert into a replaced run');
  });
});

/**
 * The same two cases with hand-written journals, so nothing depends on how one op lowers.
 *
 * `left` replaces a run that holds two `w:t` nodes with a run that keeps the second one and
 * mints a replacement for the first. That is the split shape reduced to its smallest form:
 * one superseded child, one moved child, one survivor.
 */
function twoTextRun(): Uint8Array {
  return zipDocument(
    '<w:p><w:r><w:t xml:space="preserve">Al</w:t>' +
      '<w:t xml:space="preserve">pha</w:t></w:r></w:p><w:sectPr/>'
  );
}

interface RunParts {
  readonly paragraphId: string;
  readonly runId: string;
  readonly firstTextId: string;
  readonly secondTextId: string;
}

function runPartsOf(replica: Replica): RunParts {
  const paragraph = collectKind(packageOf(replica), 'paragraph')[0];
  const run = collectKind(packageOf(replica), 'run')[0];
  if (!paragraph || !run) throw new Error('fixture has no run');
  const texts = run.children.filter((child) => child.kind === 'text');
  const [first, second] = texts;
  if (!first || !second) throw new Error('fixture run needs two w:t children');
  return {
    paragraphId: paragraph.id,
    runId: run.id,
    firstTextId: first.id,
    secondTextId: second.id,
  };
}

/** A `w:t` holding `value`, as the three effects that mint it. */
function mintText(
  replica: Replica,
  value: string
): { id: string; effects: CanonicalPrimitiveEffect[] } {
  const elementId = replica.mint.take();
  const valueId = replica.mint.take();
  return {
    id: elementId,
    effects: [
      {
        kind: 'putNode',
        descriptor: {
          logicalId: elementId,
          kind: 'text',
          qname: { namespaceUri: WML, localName: 't', prefix: 'w' },
        },
      },
      { kind: 'putNode', descriptor: { logicalId: valueId, kind: 'textValue' } },
      { kind: 'spliceText', logicalId: valueId, utf16Start: 0, deleteCount: 0, insert: value },
      {
        kind: 'spliceChildren',
        parentLogicalId: elementId,
        start: 0,
        deleteCount: 0,
        childLogicalIds: [valueId],
      },
    ],
  };
}

/** Replace the run with a new one that keeps its second `w:t` and supersedes the first. */
function replaceRunJournal(replica: Replica, parts: RunParts): CanonicalPrimitiveEffect[] {
  const survivorId = replica.mint.take();
  const minted = mintText(replica, 'Al');
  return [
    {
      kind: 'putNode',
      descriptor: {
        logicalId: survivorId,
        kind: 'run',
        qname: { namespaceUri: WML, localName: 'r', prefix: 'w' },
      },
    },
    ...minted.effects,
    {
      kind: 'spliceChildren',
      parentLogicalId: survivorId,
      start: 0,
      deleteCount: 0,
      childLogicalIds: [minted.id, parts.secondTextId],
    },
    {
      kind: 'spliceChildren',
      parentLogicalId: parts.paragraphId,
      start: 0,
      deleteCount: 1,
      childLogicalIds: [survivorId],
    },
  ];
}

function runText(replica: Replica): string {
  const run = collectKind(packageOf(replica), 'run')[0];
  if (!run) throw new Error('no run');
  return nodeText(run);
}

describe('adoption rescues a concurrent peer, not the author', () => {
  test('a replaced run does not hand its superseded w:t to the survivor', async () => {
    const left = await seedReplica(loadPackage(twoTextRun()));
    const right = joinReplica(left);
    try {
      const parts = runPartsOf(left);
      applyJournal(left, { effects: replaceRunJournal(left, parts) });
      expect(runText(left)).toBe('Alpha');
      concurrent(
        left,
        right,
        () => {},
        () => {}
      );
      expect(runText(right), 'the receiving replica').toBe('Alpha');
      expect(packageFingerprint(packageOf(right))).toBe(packageFingerprint(packageOf(left)));
      expect(JSON.stringify(saveReopenDigest(packageOf(right)))).toBe(
        JSON.stringify(saveReopenDigest(packageOf(left)))
      );
    } finally {
      destroyReplica(right);
      destroyReplica(left);
    }
  });

  test('a child a peer adds concurrently still reaches the survivor', async () => {
    const left = await seedReplica(loadPackage(twoTextRun()));
    const right = joinReplica(left);
    try {
      const parts = runPartsOf(left);
      const rightParts = runPartsOf(right);
      const added = mintText(right, '!');
      concurrent(
        left,
        right,
        () => {
          applyJournal(left, { effects: replaceRunJournal(left, parts) });
        },
        () => {
          applyJournal(right, {
            effects: [
              ...added.effects,
              {
                kind: 'spliceChildren',
                parentLogicalId: rightParts.runId,
                start: 2,
                deleteCount: 0,
                childLogicalIds: [added.id],
              },
            ],
          });
        }
      );
      expect(runText(left), "the tombstoning replica keeps the peer's child").toBe('Alpha!');
      expect(runText(right), 'the adding replica keeps its own child').toBe('Alpha!');
      expect(packageFingerprint(packageOf(right))).toBe(packageFingerprint(packageOf(left)));
      expect(JSON.stringify(saveReopenDigest(packageOf(right)))).toBe(
        JSON.stringify(saveReopenDigest(packageOf(left)))
      );
    } finally {
      destroyReplica(right);
      destroyReplica(left);
    }
  });
});
