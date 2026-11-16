/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Every synthetic compare case must round-trip: accepting all revisions gives the revised
// document, rejecting all gives the original, and a document compared with itself has none.
// The engine runs its own self-check on the accepted inputs and fails a compare that misses it.
import { describe, expect, test } from 'bun:test';
import { allCases } from '../../../../../scripts/compare-corpus/cases.ts';
import { buildDocx } from '../../../../../scripts/compare-corpus/docx-builder.ts';
import { compareDocuments } from '../index.ts';
import { redlineNormalForm } from './support/redline-normal-form.ts';
import { viewFingerprint } from './support/redline-score.ts';

const DATE = new Date('2026-01-10T12:00:00Z');

const families = new Map<string, ReturnType<typeof allCases>>();
for (const entry of allCases()) {
  const list = families.get(entry.family) ?? [];
  list.push(entry);
  families.set(entry.family, list);
}

for (const [family, cases] of families) {
  describe(`compare corpus: ${family}`, () => {
    test(`${cases.length} cases accept to the revised and reject to the original`, () => {
      const failures: string[] = [];
      for (const entry of cases) {
        const base = buildDocx(entry.base);
        const revised = buildDocx(entry.revised);
        const result = compareDocuments(base, revised, { authorName: 'Test', date: DATE });
        if (!result.ok) {
          failures.push(`${entry.name}: ${result.code}`);
          continue;
        }
        const ours = redlineNormalForm(result.bytes);
        if (
          viewFingerprint(ours, 'accept') !== viewFingerprint(redlineNormalForm(revised), 'accept')
        )
          failures.push(`${entry.name}: accept view`);
        if (viewFingerprint(ours, 'reject') !== viewFingerprint(redlineNormalForm(base), 'accept'))
          failures.push(`${entry.name}: reject view`);
        const identity = compareDocuments(base, base, { authorName: 'Test', date: DATE });
        if (!identity.ok || identity.revisionCount !== 0) failures.push(`${entry.name}: identity`);
      }
      expect(failures).toEqual([]);
    });
  });
}
