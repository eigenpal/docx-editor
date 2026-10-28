/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A document-scope note properties write lands in every section's `w:sectPr` and in
// settings.xml, because note numbering resolves from the section. Both are ordinary shared
// package state: a peer must converge on the same properties in every section, keep a concurrent
// body edit, undo the write as one step, and read it again after a remount.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  authoredDocumentEndnoteProperties,
  authoredEndnotePropertiesFromSectPr,
  authoredFootnotePropertiesFromSectPr,
  collectSectionPropertyNodes,
  readOoxmlPackage,
  resolveEndnoteProperties,
  resolveFootnoteProperties,
  settingsPartOf,
  writeOoxmlPackage,
  type OoxmlElement,
  type OoxmlPackage,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import {
  W,
  R,
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const harness = createPeerHarness('document-note-properties');

afterEach(() => {
  harness.cleanup();
});

/** Three sections: two paragraph-level `w:sectPr`, then the body-level one. */
function threeSections(): Uint8Array {
  return zipDocument(
    '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>' +
      '<w:r><w:t>First section</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:sectPr><w:footnotePr><w:numStart w:val="5"/></w:footnotePr>' +
      '<w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>' +
      '<w:r><w:t>Second section</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Third section</w:t></w:r></w:p>' +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>',
    {
      overrides:
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>',
      documentRels:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rIdS" Type="${R}/settings" Target="settings.xml"/></Relationships>`,
      extraXml: {
        'word/settings.xml': `<w:settings xmlns:w="${W}"><w:compat/></w:settings>`,
      },
    }
  );
}

const lowerRoman = (numStart?: number): TreeDocOp => ({
  op: 'setNoteProperties',
  scope: 'document',
  footnote: {
    numFmt: 'lowerRoman',
    numRestart: 'eachSect',
    position: 'pageBottom',
    ...(numStart !== undefined ? { numStart } : {}),
  },
  endnote: { numFmt: 'decimal', position: 'sectEnd' },
});

function applyLifecycle(peer: Peer, op: TreeDocOp): void {
  const refusal = peer.room.session.gateOperations([op], { kind: 'body' });
  if (refusal) throw new Error(`gate refused: ${refusal}`);
  const result = peer.store.applyLifecycleOp(op, { actorId: peer.room.session.identity.actorId });
  if (!result.ok) throw new Error(result.detail ?? result.reason);
  peer.port.flushPendingJournals();
}

/** What each section numbers its notes by, as layout resolves it. */
function numbering(pkg: OoxmlPackage) {
  const settings = authoredDocumentEndnoteProperties(settingsPartOf(pkg));
  return collectSectionPropertyNodes(pkg.parts.get(pkg.mainDocumentPart)!.root).map((sectPr) => {
    const footnote = resolveFootnoteProperties(authoredFootnotePropertiesFromSectPr(sectPr));
    const endnote = resolveEndnoteProperties(authoredEndnotePropertiesFromSectPr(sectPr), settings);
    return `${footnote.numFmt}/${footnote.numStart}/${footnote.numRestart} ${endnote.numFmt}/${endnote.pos}`;
  });
}

/**
 * How many copies of each note properties element, and of each field inside one, a replica
 * shows. The schema allows one of each; concurrent writers must not leave two.
 */
function copies(pkg: OoxmlPackage): string[] {
  const containers: OoxmlElement[] = [];
  const settings = settingsPartOf(pkg);
  if (settings) containers.push(settings.root as OoxmlElement);
  for (const sectPr of collectSectionPropertyNodes(pkg.parts.get(pkg.mainDocumentPart)!.root))
    if (sectPr) containers.push(sectPr);
  const counts: string[] = [];
  const named = (parent: OoxmlElement, name: string) =>
    parent.children.filter(
      (child) => child.kind !== 'textValue' && child.localName === name
    ) as OoxmlElement[];
  for (const container of containers) {
    for (const name of ['footnotePr', 'endnotePr']) {
      const found = named(container, name);
      if (found.length > 1) counts.push(`${container.localName}/${name} x${found.length}`);
      for (const props of found)
        for (const field of ['pos', 'numFmt', 'numStart', 'numRestart']) {
          const fields = named(props, field).length;
          if (fields > 1) counts.push(`${container.localName}/${name}/${field} x${fields}`);
        }
    }
  }
  return counts;
}

/** The package as a save writes it, read back. */
function saved(peer: Peer): OoxmlPackage {
  const reread = readOoxmlPackage(writeOoxmlPackage(harness.packageOf(peer)));
  if (!reread.ok) throw new Error(reread.reason);
  return reread.package;
}

function bodyText(pkg: OoxmlPackage): string[] {
  const texts: string[] = [];
  walk(pkg.parts.get(pkg.mainDocumentPart)!.root, (node) => {
    if (node.kind === 'paragraph') texts.push(nodeText(node));
  });
  return texts;
}

/** Every section after `lowerRoman()`: the second keeps the `numStart` the write leaves out. */
const WRITTEN = [
  'lowerRoman/1/eachSect decimal/sectEnd',
  'lowerRoman/5/eachSect decimal/sectEnd',
  'lowerRoman/1/eachSect decimal/sectEnd',
];
const ORIGINAL = [
  'decimal/1/continuous lowerRoman/docEnd',
  'decimal/5/continuous lowerRoman/docEnd',
  'decimal/1/continuous lowerRoman/docEnd',
];

describe('document-scope note properties collaboration', () => {
  test('replicate to every section and survive a remount', async () => {
    const { alice, bob } = await harness.pair(threeSections());
    expect(numbering(harness.packageOf(bob))).toEqual(ORIGINAL);
    applyLifecycle(alice, lowerRoman());
    harness.expectConverged(alice, bob);
    expect(numbering(harness.packageOf(bob))).toEqual(WRITTEN);
    const reopened = await harness.remount(bob);
    harness.expectConverged(alice, reopened);
    expect(numbering(harness.packageOf(reopened))).toEqual(WRITTEN);
  });

  test('undo and redo as one step on every peer', async () => {
    const { alice, bob } = await harness.pair(threeSections());
    applyLifecycle(alice, lowerRoman());
    harness.expectConverged(alice, bob);
    expect(alice.room.session.undo()).toBe(true);
    alice.port.flushPendingJournals();
    harness.expectConverged(alice, bob);
    for (const peer of [alice, bob]) {
      expect(numbering(harness.packageOf(peer))).toEqual(ORIGINAL);
      expect(authoredDocumentEndnoteProperties(settingsPartOf(harness.packageOf(peer)))).toBe(
        undefined
      );
    }
    expect(alice.room.session.redo()).toBe(true);
    alice.port.flushPendingJournals();
    harness.expectConverged(alice, bob);
    expect(numbering(harness.packageOf(bob))).toEqual(WRITTEN);
  });

  test('a concurrent body edit and the write both survive', async () => {
    const { alice, bob, pause, resume } = await harness.pair(threeSections());
    pause();
    applyLifecycle(alice, lowerRoman());
    harness.apply(bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 1), offset: 0, text: 'New ' },
    ]);
    resume();
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();
    harness.expectConverged(alice, bob);
    for (const peer of [alice, bob]) {
      expect(peer.room.session.status()).toBe('ready');
      expect(numbering(harness.packageOf(peer))).toEqual(WRITTEN);
      expect(bodyText(harness.packageOf(peer))[1]).toBe('New Second section');
    }
  });

  test('two concurrent first writes converge, read by the first copy, and the next write heals', async () => {
    const { alice, bob, pause, resume } = await harness.pair(threeSections());
    pause();
    applyLifecycle(alice, lowerRoman(2));
    applyLifecycle(bob, lowerRoman(7));
    resume();
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();
    harness.expectConverged(alice, bob);
    // A section that had no footnotePr gets one from each peer; shared state keeps both, and
    // every reader (this release, a released one, a plain first-copy reader) reads the first.
    const sections = numbering(harness.packageOf(alice));
    expect(numbering(harness.packageOf(bob))).toEqual(sections);
    for (const section of sections) {
      expect(section).toMatch(/^lowerRoman\/[257]\/eachSect decimal\/sectEnd$/);
    }
    expect(copies(harness.packageOf(alice)).length).toBeGreaterThan(0);
    // The saved file keeps only the first copy.
    expect(copies(saved(alice))).toEqual([]);
    expect(numbering(saved(alice))).toEqual(sections);
    // The next write by either peer collapses the copies with ordinary edits.
    applyLifecycle(bob, {
      op: 'setNoteProperties',
      scope: 'document',
      footnote: { numFmt: 'upperRoman' },
    });
    harness.expectConverged(alice, bob);
    for (const peer of [alice, bob]) {
      expect(copies(harness.packageOf(peer))).toEqual([]);
      for (const section of numbering(harness.packageOf(peer))) {
        expect(section).toMatch(/^upperRoman\/[257]\/eachSect decimal\/sectEnd$/);
      }
    }
  });

  test('a peer joining two sections while the write lands converges', async () => {
    const { alice, bob, pause, resume } = await harness.pair(threeSections());
    pause();
    applyLifecycle(alice, lowerRoman());
    // Joining the first two paragraphs removes the section break the first one carried.
    harness.apply(bob, [
      {
        op: 'joinParagraphs',
        firstId: harness.paragraphIdAt(bob, 0),
        secondId: harness.paragraphIdAt(bob, 1),
      },
    ]);
    resume();
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();
    harness.expectConverged(alice, bob);
    for (const peer of [alice, bob]) {
      expect(peer.room.session.status()).toBe('ready');
      expect(bodyText(harness.packageOf(peer))[0]).toBe('First sectionSecond section');
    }
    // The join keeps the second paragraph's section properties, written in place by Alice.
    for (const peer of [alice, bob]) {
      expect(numbering(harness.packageOf(peer))).toEqual([WRITTEN[1], WRITTEN[2]]);
      expect(copies(harness.packageOf(peer))).toEqual([]);
    }
  });

  test('concurrent section-scope writes to two sections converge, and the next write heals settings.xml', async () => {
    const { alice, bob, pause, resume } = await harness.pair(threeSections());
    pause();
    const sectionWrite = (sectionIndex: number, position: string): TreeDocOp => ({
      op: 'setNoteProperties',
      scope: 'section',
      sectionIndex,
      footnote: { numFmt: 'upperRoman' },
      endnote: { numFmt: 'decimal', position },
    });
    applyLifecycle(alice, sectionWrite(0, 'sectEnd'));
    applyLifecycle(bob, sectionWrite(1, 'sectEnd'));
    resume();
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();
    harness.expectConverged(alice, bob);
    const expected = [
      'upperRoman/1/continuous decimal/sectEnd',
      'upperRoman/5/continuous decimal/sectEnd',
      'decimal/1/continuous lowerRoman/sectEnd',
    ];
    for (const peer of [alice, bob]) {
      expect(peer.room.session.status()).toBe('ready');
      expect(numbering(harness.packageOf(peer))).toEqual(expected);
    }
    expect(copies(harness.packageOf(bob))).toEqual(['settings/endnotePr x2']);
    expect(copies(saved(bob))).toEqual([]);
    applyLifecycle(alice, sectionWrite(2, 'sectEnd'));
    harness.expectConverged(alice, bob);
    for (const peer of [alice, bob]) {
      expect(copies(harness.packageOf(peer))).toEqual([]);
      expect(numbering(harness.packageOf(peer))).toEqual([
        expected[0],
        expected[1],
        'upperRoman/1/continuous decimal/sectEnd',
      ]);
    }
  });
});
