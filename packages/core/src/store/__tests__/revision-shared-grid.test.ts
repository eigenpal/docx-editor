import { expect, test } from 'bun:test';
import {
  applyTreeOp,
  planRevisionBatch,
  readOoxmlPart,
  revisionItemsOf,
  reviewItemKey,
  serializeOoxmlPart,
} from '../index.ts';
import {
  reviewTableGroupingCases,
  reviewTableGroupingParts,
} from './fixtures/review-table-grouping-cases.ts';

// Word single-entry accept/reject results, captured on 2026-09-18: either row
// decision leaves one entry and the shared grid history. Check both orders and
// mixed decisions so rejecting one group cannot consume the other's snapshot.
for (const name of ['format-grid-with-gap', 'format-grid-row-authors']) {
  for (const first of [0, 1]) {
    for (const actions of [
      ['accept', 'accept'],
      ['accept', 'reject'],
      ['reject', 'accept'],
      ['reject', 'reject'],
    ] as const) {
      test(`${name}: resolve ${first} first, ${actions.join('/')}`, () => {
        const fixture = reviewTableGroupingCases.find((entry) => entry.name === name)!;
        const parsed = readOoxmlPart(reviewTableGroupingParts(fixture)['word/document.xml']!, {
          name: '/word/document.xml',
          contentType: 'application/xml',
        });
        if (!parsed.ok) throw new Error(parsed.reason);
        let part = parsed.part;
        expect(revisionItemsOf(part)).toHaveLength(2);
        for (const [step, action] of actions.entries()) {
          const items = revisionItemsOf(part);
          const selected = items[step === 0 ? first : 0]!;
          const plan = planRevisionBatch(part, action, [reviewItemKey(selected)]);
          expect(plan.result.skipped).toEqual([]);
          expect(plan.result.remaining).toBe(1 - step);
          for (const op of plan.ops) {
            const result = applyTreeOp(part, op);
            if (!result.ok) throw new Error(result.reason);
            part = result.part;
          }
          expect(revisionItemsOf(part)).toHaveLength(1 - step);
          const xml = serializeOoxmlPart(part);
          expect(xml.includes('<w:tblGridChange')).toBe(step === 0);
          if (step === 0) expect(xml).toContain('<w:trPrChange');
          else {
            expect(xml).not.toMatch(/<w:\w+Change\b/);
            const heights = [...xml.matchAll(/<w:trHeight\b/g)];
            expect(heights).toHaveLength(actions.filter((value) => value === 'accept').length);
          }
          for (const text of name === 'format-grid-with-gap'
            ? ['First A', 'First B', 'Last A', 'Last B']
            : ['First A', 'First B', 'Second A', 'Second B'])
            expect(xml).toContain(text);
        }
      });
    }
  }
}
