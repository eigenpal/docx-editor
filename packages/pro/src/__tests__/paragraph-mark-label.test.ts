/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

// A card must say what the change IS.
//
// `EG_ParaRPrTrackChanges` is `ins? del? moveFrom? moveTo?`. The four say opposite things
// about one paragraph break: `w:ins` proposes it, `w:del` proposes taking it away. The review
// item carried one kind for all four and the card read "Inserted paragraph break" for every
// one of them — the reverse of what Accept on that card does to a deleted mark.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, revisionItemsOf, type OoxmlPart } from '@docx-editor.dev/core/store';
import { revisionLabelKey } from '../react/review-labels.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(mark: string): OoxmlPart {
  const body =
    `<w:p><w:pPr><w:rPr>${mark}</w:rPr></w:pPr><w:r><w:t>first</w:t></w:r></w:p>` +
    '<w:p><w:r><w:t>second</w:t></w:r></w:p>';
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const markItem = (mark: string) => {
  const items = revisionItemsOf(load(mark)).filter((item) => item.kind === 'revision');
  const item = items.find((entry) => entry.revisionKind === 'paragraphMark');
  if (!item) throw new Error('no paragraph mark item');
  return item;
};

describe('a paragraph mark card names its own decision', () => {
  test('a deleted mark does not read as an inserted one', () => {
    const item = markItem('<w:del w:id="1" w:author="A"/>');
    expect(item.markDirection).toBe('delete');
    expect(revisionLabelKey(item.revisionKind, item.markDirection)).toBe(
      'revisions.paragraphMarkDeleted'
    );
  });

  test('an inserted mark still reads as an insertion', () => {
    const item = markItem('<w:ins w:id="1" w:author="A"/>');
    expect(item.markDirection).toBe('insert');
    expect(revisionLabelKey(item.revisionKind, item.markDirection)).toBe(
      'revisions.paragraphMarkInserted'
    );
  });

  test('the two halves of a move are opposite decisions, and read that way', () => {
    // Accepting a `moveFrom` takes this copy of the break away; accepting a `moveTo` keeps
    // it. One sentence for both told a reviewer nothing about which they were answering.
    const from = markItem('<w:moveFrom w:id="1" w:author="A"/>');
    const to = markItem('<w:moveTo w:id="1" w:author="A"/>');
    expect(revisionLabelKey(from.revisionKind, from.markDirection)).toBe(
      'revisions.paragraphMarkMovedFrom'
    );
    expect(revisionLabelKey(to.revisionKind, to.markDirection)).toBe(
      'revisions.paragraphMarkMovedTo'
    );
  });

  test('a mark carrying two decisions raises one card each', () => {
    // B proposes removing a break A proposed adding. Two authors, two decisions, two cards.
    const items = revisionItemsOf(
      load('<w:ins w:id="1" w:author="A"/><w:del w:id="2" w:author="B"/>')
    ).filter((item) => item.kind === 'revision' && item.revisionKind === 'paragraphMark');
    expect(items.map((item) => item.markDirection).sort()).toEqual(['delete', 'insert']);
  });
});
