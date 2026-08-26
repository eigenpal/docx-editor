/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two authors create the same part for the first time, neither having seen the other's.
//
// The part directory and the node records behind it are both last-write-wins, so one author's
// root loses the name and everything it listed becomes reachable from nothing. `comments.xml`
// and the customXml stores already had a repair for this; the notes parts did not, so the
// first footnote two people added at once left one of them with no footnote at all — and
// nothing said so. A dropped comment can be re-typed once someone notices. This could not be
// noticed at all, which is the reason it is worth a test per part.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlPackage,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import { partMemberSpecFor } from '../document/materialize-part-members.ts';
import { W, createPeerHarness, walk, zipDocument, type Peer } from './document-peer-support.ts';

const harness = createPeerHarness('document-part-races');

afterEach(() => {
  harness.cleanup();
});

const FOOTNOTES_PART = '/word/footnotes.xml';
const ENDNOTES_PART = '/word/endnotes.xml';

function threeParagraphs(): Uint8Array {
  return zipDocument(
    '<w:p><w:r><w:t>First paragraph here</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Second paragraph here</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Third paragraph here</w:t></w:r></w:p>' +
      '<w:sectPr/>'
  );
}

/** Note lifecycle ops are package-level, so they commit through the lifecycle path. */
function applyLifecycle(peer: Peer, op: TreeDocOp): void {
  const refusal = peer.room.session.gateOperations([op], { kind: 'body' });
  if (refusal) throw new Error(`gate refused: ${refusal}`);
  const result = peer.store.applyLifecycleOp(op);
  if (!result.ok) throw new Error(result.detail ?? result.reason);
  peer.port.flushPendingJournals();
}

/** Ids of the notes part's children, in the order they sit in — Word reads this as authority. */
function noteIdOrder(pkg: OoxmlPackage, partName: string, localName: string): number[] {
  const part = pkg.parts.get(partName);
  if (!part) return [];
  const ids: number[] = [];
  for (const child of part.root.children) {
    if (child.kind === 'textValue' || child.localName !== localName) continue;
    const id = child.attributes.find((attribute) => attribute.localName === 'id')?.value;
    if (id !== undefined) ids.push(Number(id));
  }
  return ids;
}

/** The positive note ids this replica's part currently holds, in ascending order. */
function authoredIds(peer: Peer, testCase: RaceCase): number[] {
  const ids = noteIdOrder(peer.store.currentPackage(), testCase.partName, testCase.localName);
  return ids.filter((id) => id > 0).sort((left, right) => left - right);
}

function referenceCount(pkg: OoxmlPackage, localName: string): number {
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) return 0;
  let count = 0;
  walk(main.root, (node) => {
    if (node.kind !== 'textValue' && node.localName === localName && node.namespaceUri === W) {
      count += 1;
    }
  });
  return count;
}

interface RaceCase {
  readonly label: string;
  readonly noteKind: 'footnote' | 'endnote';
  readonly partName: string;
  readonly localName: string;
  readonly referenceName: string;
}

const CASES: readonly RaceCase[] = [
  {
    label: 'footnotes',
    noteKind: 'footnote',
    partName: FOOTNOTES_PART,
    localName: 'footnote',
    referenceName: 'footnoteReference',
  },
  {
    label: 'endnotes',
    noteKind: 'endnote',
    partName: ENDNOTES_PART,
    localName: 'endnote',
    referenceName: 'endnoteReference',
  },
];

describe('concurrent first-create of a notes part', () => {
  for (const testCase of CASES) {
    test(`both authors keep their ${testCase.label.slice(0, -1)} when neither replica had the part`, async () => {
      const { alice, bob, pause, resume } = await harness.pair(threeParagraphs());
      const aliceParagraph = harness.paragraphIdAt(alice, 0);
      const bobParagraph = harness.paragraphIdAt(bob, 2);

      // Neither sees the other's create, which is the whole point: both mint a first root.
      pause();
      applyLifecycle(alice, {
        op: 'insertNote',
        noteKind: testCase.noteKind,
        paragraphId: aliceParagraph,
        offset: 5,
      });
      applyLifecycle(bob, {
        op: 'insertNote',
        noteKind: testCase.noteKind,
        paragraphId: bobParagraph,
        offset: 5,
      });
      expect(authoredIds(alice, testCase)).toHaveLength(1);
      expect(authoredIds(bob, testCase)).toHaveLength(1);

      resume();
      alice.port.flushPendingJournals();
      bob.port.flushPendingJournals();

      for (const peer of [alice, bob] as const) {
        const pkg = peer.store.currentPackage();
        // Two authors, two notes. `w:id` cannot tell them apart, because note ids are not
        // actor-scoped and both replicas mint 1 — so this counts the elements themselves.
        const kept = authoredIds(peer, testCase);
        expect(
          kept,
          `expected both authors' ${testCase.label} to survive the merge, got ${JSON.stringify(kept)}`
        ).toHaveLength(2);
        // A note body with no reference in the story is unreachable in Word.
        expect(referenceCount(pkg, testCase.referenceName)).toBe(2);
        // Word reads the notes part in order, and the reserved ids come first.
        const order = noteIdOrder(pkg, testCase.partName, testCase.localName);
        expect([...order].sort((left, right) => left - right)).toEqual(order);
      }
      harness.expectConverged(alice, bob);
    });
  }

  test('an uncontested first note is byte-identical to the one a solo author gets', async () => {
    // The repair reorders members when it adopts. It must not reorder anything otherwise, or
    // every document that merely HAS a notes part starts drifting from what Word wrote.
    const { alice, bob } = await harness.pair(threeParagraphs());
    applyLifecycle(alice, {
      op: 'insertNote',
      noteKind: 'footnote',
      paragraphId: harness.paragraphIdAt(alice, 1),
      offset: 5,
    });
    bob.port.flushPendingJournals();
    expect(noteIdOrder(bob.store.currentPackage(), FOOTNOTES_PART, 'footnote')).toEqual([-1, 0, 1]);
    harness.expectConverged(alice, bob);
  });
});

/**
 * Adoption re-homes a member into whichever root survived, so the order it puts them in is
 * what Word reads. Every replica has to compute that order the same way, and it has to be the
 * order the schema requires — this covers the numbering part, whose two member kinds are
 * ordered against each other rather than by id alone.
 */
describe('member order a replica derives for an adopted part', () => {
  function element(localName: string, attributes: Record<string, string>): OoxmlElement {
    return {
      id: `${localName}-${Object.values(attributes).join('-')}`,
      kind: 'generic',
      namespaceUri: WML_NAMESPACE_URI,
      localName,
      prefix: 'w',
      namespaceBindings: [],
      attributes: Object.entries(attributes).map(([name, value]) => ({
        kind: 'genericExtension',
        namespaceUri: WML_NAMESPACE_URI,
        localName: name,
        prefix: 'w',
        value,
      })),
      children: [],
    } as unknown as OoxmlElement;
  }

  function ordered(partName: string, root: OoxmlElement, members: OoxmlElement[]): string[] {
    const spec = partMemberSpecFor(partName, root);
    if (!spec) throw new Error(`no spec for ${partName}`);
    return [...members]
      .sort((left, right) => spec.sortKey(left).localeCompare(spec.sortKey(right)))
      .map((member) => member.id);
  }

  test('numbering puts every abstractNum before every num, each by numeric id', () => {
    const root = element('numbering', {});
    const members = [
      element('num', { numId: '10' }),
      element('abstractNum', { abstractNumId: '9' }),
      element('num', { numId: '9' }),
      element('abstractNum', { abstractNumId: '10' }),
    ];
    expect(ordered('/word/numbering.xml', root, members)).toEqual([
      'abstractNum-9',
      'abstractNum-10',
      'num-9',
      'num-10',
    ]);
  });

  test('a notes part keeps the reserved negative ids first and sorts the rest numerically', () => {
    const root = element('footnotes', {});
    const members = [
      element('footnote', { id: '10' }),
      element('footnote', { id: '2' }),
      element('footnote', { id: '0' }),
      element('footnote', { id: '-1' }),
    ];
    expect(ordered('/word/footnotes.xml', root, members)).toEqual([
      'footnote--1',
      'footnote-0',
      'footnote-2',
      'footnote-10',
    ]);
  });

  test('headers have no spec, because a stray w:p cannot be traced back to one', () => {
    // Adopting a body paragraph into a header is worse than the loss it would repair, so this
    // absence is the design. If a later change gives headers per-node provenance, delete this.
    const root = element('hdr', {});
    expect(partMemberSpecFor('/word/header1.xml', root)).toBeNull();
  });
});
