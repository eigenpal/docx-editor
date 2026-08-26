/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// TOC insert and refresh go through `applyTreeOps`. Bookmarks and `_Toc` names
// must arrive with the field, or a peer holds a TOC whose hyperlinks name
// nothing.

import { afterEach, describe, expect, test } from 'bun:test';
import { buildBookmarkIndex, detectBodyTocs } from '@docx-editor.dev/core/store';
import { createPeerHarness, walk, zipDocument } from './document-peer-support.ts';

const peers = createPeerHarness('toc-replication-room');

afterEach(() => peers.cleanup());

function headingsBytes(): Uint8Array {
  return zipDocument(
    '<w:p><w:r><w:t>Intro</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Body</w:t></w:r></w:p>' +
      '<w:sectPr/>'
  );
}

function existingTocBytes(): Uint8Array {
  return zipDocument(
    '<w:p><w:r><w:fldChar w:fldCharType="begin"/>' +
      '<w:instrText xml:space="preserve"> TOC \\o "1-2" \\h </w:instrText>' +
      '<w:fldChar w:fldCharType="separate"/></w:r></w:p>' +
      '<w:p><w:r><w:t>Old entry</w:t></w:r></w:p>' +
      '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
      '<w:p><w:r><w:t>Heading</w:t></w:r></w:p>' +
      '<w:sectPr/>'
  );
}

describe('inserting and refreshing a table of contents replicates bookmarks', () => {
  test('insertToc carries the field, entries, and _Toc bookmarks to the peer', async () => {
    const { alice, bob } = await peers.pair(headingsBytes());
    const headingId = peers.paragraphIdAt(alice, 0);
    peers.apply(alice, [
      {
        op: 'insertToc',
        beforeParagraphId: headingId,
        instruction: ' TOC \\o "1-3" \\h ',
        alias: 'TOC',
        entries: [
          {
            level: 0,
            text: 'Intro',
            headingParagraphId: headingId,
            bookmarkName: '_Toc1',
            pageNumberText: '1',
          },
        ],
        bookmarksToCreate: [{ paragraphId: headingId, name: '_Toc1' }],
      },
    ]);
    const bobPart = bob.store.bodyStore().part;
    expect(detectBodyTocs(bobPart).length).toBe(1);
    expect(buildBookmarkIndex(bobPart).has('_Toc1')).toBe(true);
    peers.expectConverged(alice, bob);
  });

  test('replaceTocResult updates cached entries and created bookmarks on the peer', async () => {
    const { alice, bob } = await peers.pair(existingTocBytes());
    const toc = detectBodyTocs(alice.store.bodyStore().part)[0];
    if (!toc) throw new Error('missing toc');
    const headingId = peers.paragraphIdAt(alice, 3);
    peers.apply(alice, [
      {
        op: 'replaceTocResult',
        tocId: toc.id,
        entries: [
          {
            level: 0,
            text: 'Heading',
            headingParagraphId: headingId,
            bookmarkName: '_Toc2',
            pageNumberText: '2',
          },
        ],
        bookmarksToCreate: [{ paragraphId: headingId, name: '_Toc2' }],
      },
    ]);
    const bobPart = bob.store.bodyStore().part;
    expect([...buildBookmarkIndex(bobPart).keys()]).toContain('_Toc2');
    let sawOld = false;
    walk(bobPart.root, (node) => {
      if (node.kind === 'textValue' && node.value === 'Old entry') sawOld = true;
    });
    expect(sawOld).toBe(false);
    expect(detectBodyTocs(bobPart).length).toBe(1);
    peers.expectConverged(alice, bob);
  });
});
