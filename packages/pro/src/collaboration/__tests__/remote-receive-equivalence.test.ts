/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Is an incrementally materialized package the same document a cold full pass builds?
//
// The materializer reuses cached subtrees by object identity for everything a change did not
// name. That is what makes receiving one remote character cost the size of the edit, and it
// is also the one place where a wrong answer is INVISIBLE: the replica renders and converges
// happily, and the corruption surfaces the day somebody saves the file.
//
// So the oracle is the repo's own fidelity oracle, `canonicalOoxmlFingerprint`, applied after
// EVERY step of a long mixed sequence rather than once at the end. Incremental bugs compound;
// a one-edit test finds none of them. Each step also asserts that the untouched parts kept
// their object identity, because reuse that quietly stops happening is a performance
// regression no fingerprint can see.
//
// Both sides of the comparison read the SAME shared state, one with a warm node cache and one
// with none. Whether shared state says what the author's own local tree says is a different
// property, owned by the journal tests, so this file does not assert it.

import { afterEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { strToU8, zipSync } from 'fflate';
import {
  canonicalOoxmlFingerprint,
  type OoxmlNode,
  type OoxmlPackage,
  type StoryScope,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import {
  DocumentRegistry,
  PackageMaterializer,
  materializedNodeReads,
  type BlobBytesStore,
} from '../document/index.ts';
import { createPeerHarness, walk, type Peer } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const HEADER_REL = `${R}/header`;
/** Owned by `document-session.ts`. Mirrored so the oracle reads the same shared blobs. */
const BLOBS_KEY = 'docx-package-blobs-v1';

const harness = createPeerHarness('remote-receive-equivalence');

afterEach(() => {
  harness.cleanup();
});

function paragraph(paraId: string, text: string): string {
  return (
    `<w:p w14:paraId="${paraId}" w14:textId="${paraId}">` +
    `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
  );
}

/**
 * A document with a body, a table, a header story and a section that references it.
 *
 * The header matters: it is a second story root, so a change under the body must leave the
 * header part object-identical, and a header edit must not rebuild the body.
 */
function mixedFixture(): Uint8Array {
  const body =
    paragraph('11111111', 'Alpha paragraph') +
    paragraph('22222222', 'Bravo paragraph') +
    paragraph('33333333', 'Charlie paragraph') +
    '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid>' +
    '<w:tr><w:tc>' +
    paragraph('44444444', 'Cell one') +
    '</w:tc><w:tc>' +
    paragraph('55555555', 'Cell two') +
    '</w:tc></w:tr></w:tbl>' +
    paragraph('66666666', 'Delta paragraph') +
    '<w:sectPr><w:headerReference w:type="default" r:id="rId10"/></w:sectPr>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId10" Type="${HEADER_REL}" Target="header1.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
    'word/header1.xml': strToU8(
      `<w:hdr xmlns:w="${W}" xmlns:w14="${W14}">${paragraph('77777777', 'Header line')}</w:hdr>`
    ),
  });
}

function sharedBlobs(doc: Y.Doc): BlobBytesStore {
  const shared = doc.getMap<Uint8Array>(BLOBS_KEY);
  return {
    get: (digest: string) => shared.get(digest) ?? null,
    put: () => {
      throw new Error('the oracle never writes');
    },
  };
}

/**
 * Materialize the same shared state from nothing.
 *
 * A brand new registry and materializer over a copy of the replica's Yjs document has no
 * node cache to reuse, so its answer is the full-rebuild answer by construction.
 */
function coldPackage(source: Y.Doc): OoxmlPackage {
  const fresh = new Y.Doc();
  const registry = new DocumentRegistry(fresh);
  registry.beginBulkLoad();
  Y.applyUpdate(fresh, Y.encodeStateAsUpdate(source), 'oracle');
  registry.endBulkLoad();
  const materializer = new PackageMaterializer(registry, sharedBlobs(fresh));
  const result = materializer.rebuild();
  materializer.destroy();
  if (!result.ok) throw new Error(`cold rebuild failed: ${result.code}`);
  return result.package;
}

function partNames(pkg: OoxmlPackage): string[] {
  return [...pkg.parts.keys()].sort((left, right) => left.localeCompare(right));
}

/** Every part of both packages says the same thing, part by part, and so does the whole. */
function expectSameDocument(incremental: OoxmlPackage, cold: OoxmlPackage, step: string): void {
  expect(partNames(incremental), `${step}: part directory`).toEqual(partNames(cold));
  for (const [name, part] of incremental.parts) {
    const other = cold.parts.get(name);
    if (!other) throw new Error(`${step}: cold rebuild has no ${name}`);
    expect(canonicalOoxmlFingerprint(part), `${step}: ${name}`).toBe(
      canonicalOoxmlFingerprint(other)
    );
  }
  expect(packageFingerprint(incremental), `${step}: package`).toBe(packageFingerprint(cold));
  expect(JSON.stringify(saveReopenDigest(incremental)), `${step}: save/reopen`).toBe(
    JSON.stringify(saveReopenDigest(cold))
  );
}

function blockIds(peer: Peer, kind: OoxmlNode['kind']): string[] {
  const ids: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === kind) ids.push(node.id);
  });
  return ids;
}

function textLength(peer: Peer, paragraphId: string, scope: StoryScope): number {
  const part = peer.store.partFor(scope);
  if (!part) throw new Error('no story part');
  let length = 0;
  walk(part.root, (node) => {
    if (node.id !== paragraphId || node.kind === 'textValue') return;
    walk(node, (inner) => {
      if (inner.kind === 'textValue') length += inner.value.length;
    });
  });
  return length;
}

interface Step {
  readonly name: string;
  readonly author: 'alice' | 'bob';
  readonly ops: (peer: Peer) => readonly TreeDocOp[];
  readonly scope?: StoryScope;
}

const HEADER: StoryScope = { kind: 'headerFooter', rId: 'rId10' };
const REVISION = { author: 'Reviewer' } as const;

/**
 * One mixed sequence, alternating authors so both replicas both send and receive.
 *
 * Every kind here reaches the materializer differently: text splices one Y.Text, a split
 * mints nodes and splices a child array, a join tombstones a paragraph and hands its
 * children to a survivor through the DERIVED adoption index, a table edit works several
 * levels down, and a header edit changes a different story root entirely.
 */
const STEPS: readonly Step[] = [
  {
    name: 'type into a body paragraph',
    author: 'alice',
    ops: (peer) => [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(peer, 0), offset: 5, text: 'X' },
    ],
  },
  {
    name: 'type again into the same paragraph',
    author: 'alice',
    ops: (peer) => [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(peer, 0), offset: 6, text: 'Y' },
    ],
  },
  {
    name: 'type from the other replica',
    author: 'bob',
    ops: (peer) => [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(peer, 1), offset: 0, text: 'Z' },
    ],
  },
  {
    name: 'delete text',
    author: 'alice',
    ops: (peer) => [
      { op: 'deleteText', paragraphId: harness.paragraphIdAt(peer, 1), start: 0, end: 2 },
    ],
  },
  {
    name: 'split a paragraph',
    author: 'bob',
    ops: (peer) => [
      { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(peer, 2), offset: 7 },
    ],
  },
  {
    name: 'type into the new paragraph',
    author: 'alice',
    ops: (peer) => [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(peer, 3), offset: 0, text: 'new-' },
    ],
  },
  {
    name: 'join the paragraphs back',
    author: 'bob',
    ops: (peer) => [
      {
        op: 'joinParagraphs',
        firstId: harness.paragraphIdAt(peer, 2),
        secondId: harness.paragraphIdAt(peer, 3),
      },
    ],
  },
  {
    name: 'insert a tab and a hard break',
    author: 'alice',
    ops: (peer) => [
      { op: 'insertTab', paragraphId: harness.paragraphIdAt(peer, 1), offset: 1 },
      { op: 'insertHardBreak', paragraphId: harness.paragraphIdAt(peer, 1), offset: 2 },
    ],
  },
  {
    name: 'format a run',
    author: 'bob',
    ops: (peer) => [
      {
        op: 'setRunProperties',
        paragraphId: harness.paragraphIdAt(peer, 0),
        start: 0,
        end: 3,
        properties: [{ localName: 'b' }],
      },
    ],
  },
  {
    name: 'edit a table cell',
    author: 'alice',
    ops: (peer) => [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(peer, 3), offset: 4, text: '-A' },
    ],
  },
  {
    name: 'edit the other table cell',
    author: 'bob',
    ops: (peer) => [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(peer, 4), offset: 0, text: 'B-' },
    ],
  },
  {
    name: 'insert a second table',
    author: 'alice',
    ops: (peer) => [
      {
        op: 'insertTable',
        beforeParagraphId: harness.paragraphIdAt(peer, 5),
        rows: 2,
        cols: 2,
        columnWidthTwips: 4680,
      },
    ],
  },
  {
    name: 'type into the new table',
    author: 'bob',
    ops: (peer) => [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(peer, 5), offset: 0, text: 'grid' },
    ],
  },
  {
    name: 'edit the header story',
    author: 'alice',
    scope: HEADER,
    ops: (peer) => [
      {
        op: 'insertText',
        paragraphId: harness.paragraphIdAt(peer, 0, HEADER),
        offset: textLength(peer, harness.paragraphIdAt(peer, 0, HEADER), HEADER),
        text: '!',
      },
    ],
  },
  {
    name: 'edit the header again from the other replica',
    author: 'bob',
    scope: HEADER,
    ops: (peer) => [
      {
        op: 'insertText',
        paragraphId: harness.paragraphIdAt(peer, 0, HEADER),
        offset: 0,
        text: '#',
      },
    ],
  },
  {
    name: 'write a tracked insertion',
    author: 'alice',
    ops: (peer) => [
      {
        op: 'insertText',
        paragraphId: harness.paragraphIdAt(peer, 0),
        offset: 1,
        text: 'ins',
        revision: REVISION,
      },
    ],
  },
  {
    name: 'write a tracked deletion',
    author: 'bob',
    ops: (peer) => [
      {
        op: 'deleteText',
        paragraphId: harness.paragraphIdAt(peer, 1),
        start: 0,
        end: 2,
        revision: REVISION,
      },
    ],
  },
  {
    name: 'insert comment markers',
    author: 'alice',
    ops: (peer) => [
      {
        op: 'insertCommentMarker',
        paragraphId: harness.paragraphIdAt(peer, 0),
        offset: 0,
        commentId: '1',
        marker: 'start',
      },
      {
        op: 'insertCommentMarker',
        paragraphId: harness.paragraphIdAt(peer, 0),
        offset: 3,
        commentId: '1',
        marker: 'end',
      },
    ],
  },
  {
    name: 'insert a hyperlink',
    author: 'bob',
    ops: (peer) => [
      {
        op: 'insertHyperlink',
        paragraphId: harness.paragraphIdAt(peer, 1),
        start: 0,
        end: 2,
        anchor: 'top',
      },
    ],
  },
  {
    name: 'set paragraph properties',
    author: 'alice',
    ops: (peer) => [
      {
        op: 'setParagraphProperties',
        paragraphId: harness.paragraphIdAt(peer, 1),
        properties: [{ localName: 'jc', attributes: { val: 'center' } }],
      },
    ],
  },
  {
    name: 'delete a block',
    author: 'bob',
    ops: (peer) => [{ op: 'deleteBlock', blockId: harness.paragraphIdAt(peer, 1) }],
  },
  {
    name: 'type after the deletion',
    author: 'alice',
    ops: (peer) => [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(peer, 0), offset: 0, text: 'after-' },
    ],
  },
  {
    name: 'delete the table',
    author: 'bob',
    ops: (peer) => [{ op: 'deleteBlock', blockId: blockIds(peer, 'table')[0] ?? '' }],
  },
  {
    name: 'type after the table went away',
    author: 'alice',
    ops: (peer) => [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(peer, 1), offset: 0, text: 'tail-' },
    ],
  },
];

describe('incremental materialization equals a cold full rebuild', () => {
  test(
    'every step of a mixed remote edit sequence',
    async () => {
      const { alice, bob } = await harness.pair(mixedFixture());
      const peers = { alice, bob };
      expectSameDocument(harness.packageOf(bob), coldPackage(bob.ydoc), 'seed');

      let replayed = 0;
      for (const step of STEPS) {
        const author = peers[step.author];
        const receiver = step.author === 'alice' ? bob : alice;
        harness.apply(author, step.ops(author), step.scope);
        replayed += 1;
        // The receiving replica's package IS the incremental one: its materializer kept the
        // node cache from every earlier step. The cold pass reads the same shared state with
        // no cache at all.
        expectSameDocument(harness.packageOf(receiver), coldPackage(receiver.ydoc), step.name);
        // Both replicas hold the same shared state, so a full pass on either has to agree.
        expectSameDocument(
          coldPackage(alice.ydoc),
          coldPackage(bob.ydoc),
          `${step.name} (shared state)`
        );
      }
      expect(replayed).toBe(STEPS.length);
    },
    { timeout: 180_000 }
  );

  test('a body edit leaves every other part object-identical', async () => {
    const { alice, bob } = await harness.pair(mixedFixture());
    const before = harness.packageOf(bob);
    harness.apply(alice, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 0), offset: 1, text: 'q' },
    ]);
    const after = harness.packageOf(bob);
    expect(after).not.toBe(before);
    const rebuilt: string[] = [];
    for (const [name, part] of after.parts) {
      if (before.parts.get(name) !== part) rebuilt.push(name);
    }
    expect(rebuilt).toEqual([before.mainDocumentPart]);
  });

  test('a header edit leaves the main document part object-identical', async () => {
    const { alice, bob } = await harness.pair(mixedFixture());
    const before = harness.packageOf(bob);
    const headerParagraph = harness.paragraphIdAt(alice, 0, HEADER);
    harness.apply(
      alice,
      [{ op: 'insertText', paragraphId: headerParagraph, offset: 0, text: 'q' }],
      HEADER
    );
    const after = harness.packageOf(bob);
    expect(after.parts.get(before.mainDocumentPart)).toBe(
      before.parts.get(before.mainDocumentPart)
    );
    expect(after.parts.get('/word/header1.xml')).not.toBe(before.parts.get('/word/header1.xml'));
  });

  test('receiving one character reads the size of the edit, not the document', async () => {
    const { alice, bob } = await harness.pair(mixedFixture());
    let documentNodes = 0;
    walk(bob.store.bodyStore().part.root, () => {
      documentNodes += 1;
    });
    const target = harness.paragraphIdAt(alice, 0);
    // The first receive can still find a cold cache on either side; the steady state follows.
    harness.apply(alice, [{ op: 'insertText', paragraphId: target, offset: 1, text: 'a' }]);
    const reads: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const before = materializedNodeReads();
      harness.apply(alice, [
        { op: 'insertText', paragraphId: target, offset: 2 + index, text: 'b' },
      ]);
      reads.push(materializedNodeReads() - before);
    }
    for (const read of reads) {
      if (read > 64) {
        throw new Error(
          `Receiving one remote character read ${read} shared-state records. One keystroke ` +
            `mints two nodes and moves one child list, so the receiving replica has to read ` +
            `a handful of records and take the rest of the document — ${documentNodes} nodes ` +
            `in this fixture — from its node cache by identity. A number near the document ` +
            `size means the cache was disabled wholesale again, most likely by treating a ` +
            `membership change as a reason to distrust every cached subtree.`
        );
      }
    }
    expect(reads.every((read) => read > 0)).toBe(true);
    harness.expectConverged(alice, bob);
  });
});
