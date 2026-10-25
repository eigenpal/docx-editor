// In legacy modes an inline object that opens its line stays beside a floating table.

import { expect, test } from 'bun:test';
import type { ExclusionZone } from '../drawing-exclusion.ts';
import { besideTableWidth } from '../legacy-inline-beside-table.ts';

const zone = (sourceKind?: ExclusionZone['sourceKind']) =>
  ({
    sourceKind,
    drawingNodeId: 'z',
    anchorParagraphId: 'p',
    anchorModelStart: 0,
  }) as ExclusionZone;
const legacy = { inlineObjectsBesideTables: true };

test('an opening object beside a table asks only for a token width in legacy modes', () => {
  expect(besideTableWidth(113, legacy, false, () => [zone('table')])).toBe(1);
});

test('the authored width stays everywhere else', () => {
  // Modern modes, a line that already holds content, and floats that are not tables.
  expect(besideTableWidth(113, {}, false, () => [zone('table')])).toBe(113);
  expect(besideTableWidth(113, legacy, true, () => [zone('table')])).toBe(113);
  expect(besideTableWidth(113, legacy, false, () => [zone()])).toBe(113);
  expect(besideTableWidth(113, legacy, false, () => [])).toBe(113);
  expect(besideTableWidth(0.5, legacy, false, () => [zone('table')])).toBe(0.5);
});
