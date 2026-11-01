/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Every synthetic compare case runs through the engine and is scored against a reference
// redline of the same two documents. The agreement must stay above the floors below; a case
// that disagrees must be listed, with its reason, in compare-reference-known.json. The list
// only shrinks: a listed case that agrees again fails until it is removed.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'bun:test';
import { allCases } from '../../../../../scripts/compare-corpus/cases.ts';
import { buildDocx } from '../../../../../scripts/compare-corpus/docx-builder.ts';
import { compareDocuments } from '../index.ts';
import known from './fixtures/compare-reference-known.json';
import { compactRedline, expandRedline, type CompactRedline } from './support/redline-compact.ts';
import { redlineNormalForm } from './support/redline-normal-form.ts';
import { scoreRedline } from './support/redline-score.ts';

/** Token agreement on changed text, over all cases. */
const OVERALL_FLOOR = 0.95;
/** Token agreement on changed text, per family, without the listed cases. */
const FAMILY_FLOOR = 0.9;
/** Share of cases whose paragraph-mark and row revisions agree exactly. */
const MARKS_FLOOR = 0.95;
/** A case below this agreement, or with different marks, must be listed. */
const CASE_FLOOR = 0.9;

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
// Read at run time: the fixture is large, and typing it as a module would slow the checker.
const cases = (
  JSON.parse(
    readFileSync(new URL('./fixtures/compare-reference.json', import.meta.url), 'utf8')
  ) as { cases: Record<string, CompactRedline & { inputs: string[] }> }
).cases;
const knownCases = known as Record<string, string>;

test('compare agrees with the reference redlines', () => {
  const families = new Map<string, { n: number; f1: number }>();
  const unlisted: string[] = [];
  const recovered: string[] = [];
  const stale: string[] = [];
  let total = 0;
  let f1 = 0;
  let marks = 0;
  for (const entry of allCases()) {
    const id = `${entry.family}/${entry.name}`;
    const expected = cases[id];
    const base = buildDocx(entry.base);
    const revised = buildDocx(entry.revised);
    if (!expected || expected.inputs[0] !== sha(base) || expected.inputs[1] !== sha(revised)) {
      if (!knownCases[id]) stale.push(id);
      continue;
    }
    const result = compareDocuments(base, revised, {
      authorName: 'Reference',
      date: new Date('2026-01-10T12:00:00Z'),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) continue;
    const ours = expandRedline(compactRedline(redlineNormalForm(result.bytes)));
    const score = scoreRedline(ours, expandRedline(expected));
    const agrees = score.paragraphMarksEqual && score.rowMarksEqual;
    total++;
    f1 += score.changedF1;
    if (agrees) marks++;
    const pass = agrees && score.changedF1 >= CASE_FLOOR;
    if (!pass && !knownCases[id]) unlisted.push(`${id} (F1 ${score.changedF1.toFixed(3)})`);
    if (pass && knownCases[id]) recovered.push(id);
    if (knownCases[id]) continue;
    const family = families.get(entry.family) ?? { n: 0, f1: 0 };
    family.n++;
    family.f1 += score.changedF1;
    families.set(entry.family, family);
  }
  expect(stale).toEqual([]);
  expect(unlisted).toEqual([]);
  expect(recovered).toEqual([]);
  expect(f1 / total).toBeGreaterThanOrEqual(OVERALL_FLOOR);
  expect(marks / total).toBeGreaterThanOrEqual(MARKS_FLOOR);
  const weak = [...families]
    .filter(([, family]) => family.f1 / family.n < FAMILY_FLOOR)
    .map(([name]) => name);
  expect(weak).toEqual([]);
});
