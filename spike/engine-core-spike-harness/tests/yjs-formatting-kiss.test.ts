import { expect, test } from 'bun:test';
import { runFormattingBakeoff } from '../experiments/yjs-formatting-kiss.js';

test('runs six deterministic real-Yjs formatting cases', () => {
  const first = runFormattingBakeoff();
  expect(first).toEqual(runFormattingBakeoff());
  expect(Object.values(first.candidates).some((candidate) => candidate.passed)).toBe(true);
  expect(first.winner).not.toBeNull();
});
