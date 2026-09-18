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
const source = reviewTableGroupingCases.find((c) => c.name === 'move-range-wrapper-destination')!;
const load = (body = source.body) => {
  const r = readOoxmlPart(
    reviewTableGroupingParts({ name: source.name, body })['word/document.xml']!,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!r.ok) throw Error(r.reason);
  return r.part;
};
for (const action of ['accept', 'reject'] as const)
  for (const target of ['moveTo', 'insert', 'all'] as const) {
    test(`${action} orphan wrapper ${target}: native remaining decisions and text`, () => {
      let part = load();
      const items = revisionItemsOf(part);
      expect(items.map((i) => i.revisionKind)).toEqual(['moveTo', 'insert']);
      expect(items.every((i) => i.text === 'Destination')).toBe(true);
      const keys =
        target === 'all'
          ? undefined
          : [reviewItemKey(items.find((i) => i.revisionKind === target)!)];
      const plan = planRevisionBatch(part, action, keys);
      expect(plan.result.skipped).toEqual([]);
      for (const op of plan.ops) {
        const r = applyTreeOp(part, op);
        if (!r.ok) throw Error(r.reason);
        part = r.part;
      }
      const xml = serializeOoxmlPart(part);
      const insertionAccepted = target === 'insert' && action === 'accept';
      expect(revisionItemsOf(part).map((i) => i.revisionKind)).toEqual(
        insertionAccepted ? ['moveTo'] : []
      );
      expect(plan.result.remaining).toBe(insertionAccepted ? 1 : 0);
      expect(plan.result.resolved).toHaveLength(insertionAccepted ? 1 : 2);
      expect(xml.includes('>Destination<')).toBe(!(target === 'insert' && action === 'reject'));
      expect(xml.includes('<w:moveToRangeStart')).toBe(insertionAccepted);
      expect(xml).not.toMatch(/<w:moveTo\b/);
    });
  }
for (const action of ['accept', 'reject'] as const) {
  for (const target of ['moveTo', 'insert'] as const)
    test(`${action} orphan ${target} cannot consume a shared insertion identity partially`, () => {
      const wrapper = source.body.match(/<w:moveTo\b.*?<\/w:moveTo>/)![0];
      const part = load(source.body + `<w:p>${wrapper}</w:p>`);
      const move = revisionItemsOf(part).find(
        (i) => i.revisionKind === target && i.ranges[0]?.start.paragraphId.includes('#')
      )!;
      const plan = planRevisionBatch(part, action, [reviewItemKey(move)]);
      expect(plan.ops).toEqual([]);
      expect(plan.result.skipped.some((s) => s.reason === 'incomplete-group')).toBe(true);
    });
  test(`${action} orphan move respects a containing lock`, () => {
    const part = load(
      `<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>${source.body}</w:sdtContent></w:sdt>`
    );
    const plan = planRevisionBatch(part, action);
    expect(plan.ops).toHaveLength(1);
    expect(applyTreeOp(part, plan.ops[0]!)).toMatchObject({ ok: false, reason: 'locked' });
  });
}
test('rejecting a pretty-printed orphan insertion consumes its empty move metadata', () => {
  let part = load(source.body.replaceAll('><', '>\n<'));
  const insertion = revisionItemsOf(part).find((i) => i.revisionKind === 'insert')!;
  const plan = planRevisionBatch(part, 'reject', [reviewItemKey(insertion)]);
  expect(plan.result.skipped).toEqual([]);
  for (const op of plan.ops) {
    const r = applyTreeOp(part, op);
    if (!r.ok) throw Error(r.reason);
    part = r.part;
  }
  expect(revisionItemsOf(part)).toHaveLength(0);
  expect(serializeOoxmlPart(part)).not.toContain('>Destination<');
});
