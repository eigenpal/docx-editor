import { expect, test } from 'bun:test';
import { mergeDurations } from './merge-durations.mjs';

test('later sources win and deleted test files are pruned', () => {
  const present = new Set(['a.test.ts', 'b.test.ts', 'c.test.ts']);
  const merged = mergeDurations(
    [
      { 'a.test.ts': { ms: 10, peak: 5 }, 'b.test.ts': 20, 'gone.test.ts': { ms: 99 } },
      { 'b.test.ts': { ms: 25, peak: 7 }, 'c.test.ts': { ms: 30 } },
    ],
    (file) => present.has(file)
  );
  expect(merged).toEqual({
    'a.test.ts': { ms: 10, peak: 5 },
    'b.test.ts': { ms: 25, peak: 7 },
    'c.test.ts': { ms: 30 },
  });
});

test('entries without a finite duration are dropped', () => {
  expect(mergeDurations([{ 'a.test.ts': { peak: 5 }, 'b.test.ts': null }], () => true)).toEqual({});
});
