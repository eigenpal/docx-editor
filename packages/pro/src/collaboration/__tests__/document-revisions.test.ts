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
// Accept and reject of tracked changes go through `applyTreeOps`, so they must
// replicate as ordinary story journals. A peer that keeps the `w:ins` after an
// accept would still show a suggestion the author already took.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';
import type { StoryScope } from '@docx-editor.dev/core/store';

const DATE = '2026-03-26T11:00:00Z';
const QA = { id: '1', author: 'QA', date: DATE };
const peers = createPeerHarness('revision-replication-room');
const HEADER: StoryScope = { kind: 'headerFooter', rId: 'rId7' };

afterEach(() => peers.cleanup());

function insertionBytes(): Uint8Array {
  return zipDocument(
    `<w:p><w:r><w:t xml:space="preserve">keep </w:t></w:r>` +
      `<w:ins w:id="1" w:author="QA" w:date="${DATE}"><w:r><w:t>new</w:t></w:r></w:ins></w:p>` +
      '<w:sectPr/>'
  );
}

function deletionBytes(): Uint8Array {
  return zipDocument(
    `<w:p><w:r><w:t xml:space="preserve">keep </w:t></w:r>` +
      `<w:del w:id="1" w:author="QA" w:date="${DATE}">` +
      `<w:r><w:delText>gone</w:delText></w:r></w:del></w:p>` +
      '<w:sectPr/>'
  );
}

function headerInsertionBytes(): Uint8Array {
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return zipDocument(
    '<w:p><w:r><w:t>body</w:t></w:r></w:p>' +
      '<w:sectPr><w:headerReference w:type="default" r:id="rId7"/></w:sectPr>',
    {
      overrides:
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
      documentRels:
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/></Relationships>`,
      extraXml: {
        'word/header1.xml':
          `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
          `<w:p><w:r><w:t xml:space="preserve">keep </w:t></w:r>` +
          `<w:ins w:id="1" w:author="QA" w:date="${DATE}"><w:r><w:t>new</w:t></w:r></w:ins></w:p>` +
          `</w:hdr>`,
      },
    }
  );
}

function storyText(peer: Peer, scope?: StoryScope): string {
  const part = scope === undefined ? peer.store.bodyStore().part : peer.store.partFor(scope);
  if (!part) throw new Error('missing part');
  return nodeText(part.root);
}

function hasRevision(peer: Peer, localName: 'ins' | 'del', scope?: StoryScope): boolean {
  const part = scope === undefined ? peer.store.bodyStore().part : peer.store.partFor(scope);
  if (!part) return false;
  let found = false;
  walk(part.root, (node) => {
    if (node.kind !== 'textValue' && node.localName === localName) found = true;
  });
  return found;
}

describe('accepting and rejecting a tracked change replicates to the peer', () => {
  test('accepting an insertion unwraps it on the receiving peer', async () => {
    const { alice, bob } = await peers.pair(insertionBytes());
    peers.apply(alice, [{ op: 'acceptRevision', revision: QA }]);
    expect(hasRevision(bob, 'ins')).toBe(false);
    expect(storyText(bob)).toContain('keep ');
    expect(storyText(bob)).toContain('new');
    peers.expectConverged(alice, bob);
  });

  test('rejecting an insertion drops the inserted text on the receiving peer', async () => {
    const { alice, bob } = await peers.pair(insertionBytes());
    peers.apply(alice, [{ op: 'rejectRevision', revision: QA }]);
    expect(hasRevision(bob, 'ins')).toBe(false);
    expect(storyText(bob)).toContain('keep ');
    expect(storyText(bob)).not.toContain('new');
    peers.expectConverged(alice, bob);
  });

  test('accepting a deletion drops the deleted text on the receiving peer', async () => {
    const { alice, bob } = await peers.pair(deletionBytes());
    peers.apply(alice, [{ op: 'acceptRevision', revision: QA }]);
    expect(hasRevision(bob, 'del')).toBe(false);
    expect(storyText(bob)).toContain('keep ');
    expect(storyText(bob)).not.toContain('gone');
    peers.expectConverged(alice, bob);
  });

  test('rejecting a deletion restores the deleted text on the receiving peer', async () => {
    const { alice, bob } = await peers.pair(deletionBytes());
    peers.apply(alice, [{ op: 'rejectRevision', revision: QA }]);
    expect(hasRevision(bob, 'del')).toBe(false);
    expect(storyText(bob)).toContain('keep ');
    expect(storyText(bob)).toContain('gone');
    expect(hasRevision(alice, 'del')).toBe(false);
    expect(storyText(alice)).toContain('gone');
    peers.expectConverged(alice, bob);
  });

  test('accepting an insertion in a header story replicates on that story', async () => {
    const { alice, bob } = await peers.pair(headerInsertionBytes());
    peers.apply(alice, [{ op: 'acceptRevision', revision: QA }], HEADER);
    expect(hasRevision(bob, 'ins', HEADER)).toBe(false);
    expect(storyText(bob, HEADER)).toContain('keep ');
    expect(storyText(bob, HEADER)).toContain('new');
    expect(storyText(bob)).toContain('body');
    peers.expectConverged(alice, bob);
  });

  test('rejecting an insertion in a header story replicates on that story', async () => {
    const { alice, bob } = await peers.pair(headerInsertionBytes());
    peers.apply(alice, [{ op: 'rejectRevision', revision: QA }], HEADER);
    expect(hasRevision(bob, 'ins', HEADER)).toBe(false);
    expect(storyText(bob, HEADER)).toContain('keep ');
    expect(storyText(bob, HEADER)).not.toContain('new');
    expect(storyText(bob)).toContain('body');
    peers.expectConverged(alice, bob);
  });
});
