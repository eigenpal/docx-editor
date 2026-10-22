// The label bar of an open story sits above it, or below it when the sheet has no room above.

import { expect, test } from 'bun:test';
import { storyLabelTop } from '../story-label-placement.ts';

test('the bar sits above a story with room for it on the sheet', () => {
  expect(storyLabelTop({ top: 200, bottom: 240 }, 100, 28, 6)).toBe(166);
});

test('the bar goes below a story that starts at the paper edge', () => {
  expect(storyLabelTop({ top: 100, bottom: 240 }, 100, 28, 6)).toBe(246);
});

test('with no sheet known, the bar keeps its place above the story', () => {
  expect(storyLabelTop({ top: 10, bottom: 50 }, undefined, 28, 6)).toBe(-24);
});
