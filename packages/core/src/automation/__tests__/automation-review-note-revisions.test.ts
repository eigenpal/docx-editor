import { describe, expect, test } from 'bun:test';
import type { AutomationHandle, AutomationHost } from '../protocol.ts';
import { REL_TYPES, noteReference, notesPart, richDocx } from './support/furniture.ts';
import { noteBodies } from './support/review-comments.ts';
import { handlesAt, open, reopen, savedPartBytes } from './support/protocol.ts';

function revisionsOf(host: AutomationHost, body: AutomationHandle): readonly AutomationHandle[] {
  return handlesAt(host.execute({ operations: [{ op: 'getRevisions', body }] }), 0);
}

function collidingReviewedNotes(siblingKind: 'ins' | 'del'): AutomationHost {
  const triple = `w:id="7" w:author="Same" w:date="2026-04-07T09:00:00Z"`;
  const tracked = (kind: 'ins' | 'del', text: string): string =>
    kind === 'ins'
      ? `<w:ins ${triple}><w:r><w:t>${text}</w:t></w:r></w:ins>`
      : `<w:del ${triple}><w:r><w:delText>${text}</w:delText></w:r></w:del>`;
  return open(
    richDocx({
      body: `<w:p>${noteReference('footnote', 1)}${noteReference('footnote', 2)}</w:p>`,
      rels: [{ id: 'rId4', type: REL_TYPES.footnotes, target: 'footnotes.xml' }],
      parts: [
        notesPart('footnote', [
          { id: 1, xml: `<w:p>${tracked('ins', 'target')}</w:p>` },
          { id: 2, xml: `<w:p>${tracked(siblingKind, 'sibling')}</w:p>` },
        ]),
      ],
    })
  );
}

describe('a note revision collection is rooted in exactly one shared-part story', () => {
  test('same-identity sibling insertions cannot turn accept-all into a false no-op', () => {
    const host = collidingReviewedNotes('ins');
    const [first] = noteBodies(host);
    // The old listing-based planner grouped both sites into one mixed-story card, listed it in
    // neither note, and reported success after planning zero writes.
    expect(revisionsOf(host, first!)).toEqual([]);
    expect(host.execute({ operations: [{ op: 'acceptAllRevisions', body: first! }] }).ok).toBe(
      true
    );

    const next = reopen(host);
    const [afterFirst, afterSecond] = noteBodies(next.host);
    expect(revisionsOf(next.host, afterFirst!)).toEqual([]);
    expect(revisionsOf(next.host, afterSecond!)).toHaveLength(1);
    expect(savedPartBytes(next.host, 'word/footnotes.xml').match(/<w:ins\b/g) ?? []).toHaveLength(
      1
    );
  });

  test('a target insertion cannot leak to a sibling deletion with the same identity', () => {
    const host = collidingReviewedNotes('del');
    const [first] = noteBodies(host);
    expect(host.execute({ operations: [{ op: 'acceptAllRevisions', body: first! }] }).ok).toBe(
      true
    );

    const next = reopen(host);
    const [afterFirst, afterSecond] = noteBodies(next.host);
    expect(revisionsOf(next.host, afterFirst!)).toEqual([]);
    expect(revisionsOf(next.host, afterSecond!)).toHaveLength(1);
    const notesXml = savedPartBytes(next.host, 'word/footnotes.xml');
    expect(notesXml).not.toContain('<w:ins');
    expect(notesXml).toContain('<w:del ');
  });
});
