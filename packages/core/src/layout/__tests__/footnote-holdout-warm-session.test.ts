// Footnote hold-outs in a warm session: an edit seeds the reflow loop with the previous
// document state's reserves, and no hold may keep itself alive on that seed alone. After
// every edit the warm layout must equal a clean one.
import { describe, expect, test } from 'bun:test';
import type { TreeDocOp } from '../../store/store/tree-op-types.ts';
import {
  expectNotesWithReferences,
  pages,
  shapeOf,
  warmSessionOver,
  type Probe,
} from './footnote-probe-harness.ts';

const EXACT_24 = 'w:after="0" w:line="480" w:lineRule="exact"';
const ONE_AND_HALF = 'w:after="0" w:line="360" w:lineRule="auto"';
const AT_LEAST_26 = 'w:after="0" w:line="520" w:lineRule="atLeast"';
const SPACED_BEFORE = 'w:before="240" w:after="0" w:line="480" w:lineRule="auto"';
const SPACED_AROUND = 'w:before="120" w:after="240" w:line="480" w:lineRule="auto"';
const SINGLE_AFTER_8 = 'w:after="160" w:line="259" w:lineRule="auto"';

type Edit = readonly [paragraph: number, op: (paragraphId: string) => TreeDocOp];

const insert = (paragraphId: string): TreeDocOp => ({
  op: 'insertText',
  paragraphId,
  offset: 3,
  text: 'x',
});
const deleteLabel = (paragraphId: string): TreeDocOp => ({
  op: 'deleteText',
  paragraphId,
  start: 0,
  end: 9,
});
const split = (paragraphId: string): TreeDocOp => ({
  op: 'splitParagraph',
  paragraphId,
  offset: 9,
});

/** Apply each edit to the paragraph at its index, comparing warm and clean after each. */
function expectWarmMatchesClean(probe: Probe, edits: readonly Edit[]): void {
  const doc = warmSessionOver(probe);
  expect(shapeOf(doc.warm())).toEqual(shapeOf(doc.clean()));
  for (const [index, op] of edits) {
    expect(doc.edit(op(doc.paragraphIds()[index]!))).toBe(true);
    expect(shapeOf(doc.warm())).toEqual(shapeOf(doc.clean()));
  }
}

describe('footnote hold-out with keep-with-next groups in a warm session', () => {
  test('a keep-with-next chain that cannot fit one page does not hold the page before it', () => {
    // The chain from L03 runs past the next page. Its end was unknown there, so the
    // previous state's hold kept L03-L09 off the first page after the split made the
    // chain taller than a page. Read across the later pages, the chain never keeps.
    const probe: Probe = {
      lines: 30,
      paragraphs: [
        { lines: 2, spacing: SPACED_BEFORE },
        { lines: 4, widowControl: true, keepNext: true, spacing: SPACED_BEFORE },
        { lines: 20, widowControl: true, keepNext: true, spacing: EXACT_24 },
        { lines: 2, bottomBorder: true },
        { lines: 2, widowControl: true, keepNext: true, spacing: ONE_AND_HALF },
      ],
      refs: { 3: [5], 8: [7], 10: [1, 6], 18: [4], 19: [2], 22: [3] },
      notes: { 1: 4, 2: 1, 3: 6, 4: 3, 5: 12, 6: 16, 7: 10 },
    };
    expectWarmMatchesClean(probe, [
      [1, split],
      [5, deleteLabel],
      [0, split],
      [2, insert],
      [4, split],
    ]);
  });

  test('a keep-with-next chain that cannot stay beside its own notes does not hold its lines', () => {
    // The chain's head is on the first page and its keep is dropped there. Released, the
    // chain would return whole, but its notes then drop the keep again. Pricing it whole
    // held every line of the chain on the next page and left the first page nearly empty.
    const probe: Probe = {
      lines: 8,
      paragraphs: [
        { lines: 1, spacing: SINGLE_AFTER_8 },
        { lines: 5, widowControl: true, keepNext: true, spacing: SPACED_AROUND },
        { lines: 2, widowControl: true, bottomBorder: true },
      ],
      refs: { 2: [6], 3: [1], 4: [3], 5: [7], 7: [5], 8: [2, 4] },
      notes: { 1: 20, 2: 12, 3: 8, 4: 4, 5: 20, 6: 2, 7: 1 },
    };
    expectWarmMatchesClean(probe, [
      [1, split],
      [2, split],
      [4, deleteLabel],
      [1, split],
      [4, insert],
    ]);
  });
});

describe('footnote hold-out with seeded reserves', () => {
  test('a hold from the previous state does not keep a reference line off its page', () => {
    // The split adds one line above the page end. The previous state's reserve then
    // equals the new frontier hold exactly, but no body pass refused the returning line.
    const probe: Probe = {
      lines: 21,
      paragraphs: [{ lines: 20 }, { lines: 1, widowControl: true, spacing: AT_LEAST_26 }],
      refs: { 2: [4], 12: [5], 13: [3], 14: [1], 19: [2] },
      notes: { 1: 20, 2: 4, 3: 12, 4: 1, 5: 2 },
    };
    expectWarmMatchesClean(probe, [
      [0, deleteLabel],
      [0, deleteLabel],
      [0, split],
    ]);
  });

  test('a split before a held page lets the returning lines back', () => {
    const probe: Probe = {
      lines: 177,
      paragraphs: [
        { lines: 30 },
        { lines: 12, spacing: EXACT_24 },
        { lines: 45, spacing: AT_LEAST_26 },
        { lines: 45, widowControl: true, spacing: AT_LEAST_26 },
        { lines: 45, spacing: SINGLE_AFTER_8 },
      ],
      refs: { 2: [5], 21: [7], 50: [4], 52: [6], 53: [2], 58: [1], 107: [3] },
      notes: { 1: 3, 2: 10, 3: 10, 4: 2, 5: 10, 6: 8, 7: 10 },
    };
    expectWarmMatchesClean(probe, [
      [2, split],
      [1, deleteLabel],
      [0, insert],
    ]);
  });
});

describe('footnote hold-out with keep-lines paragraphs taller than a page', () => {
  test('a keep-lines paragraph alone on the page splits for a returning reference', () => {
    // The 45-line keep-lines paragraph opens the second page alone, so the body pass splits
    // it anyway. Treating it as unsplittable held L33 and its note off that page.
    const probe: Probe = {
      lines: 93,
      paragraphs: [
        { lines: 4, widowControl: true, spacing: SPACED_BEFORE },
        { lines: 20, spacing: AT_LEAST_26 },
        { lines: 45, widowControl: true, keepLines: true },
        { lines: 4, widowControl: true, spacing: ONE_AND_HALF },
        { lines: 12, widowControl: true, spacing: ONE_AND_HALF },
        { lines: 8, widowControl: true, spacing: ONE_AND_HALF },
      ],
      refs: { 18: [3], 27: [4], 33: [1], 76: [2] },
      notes: { 1: 12, 2: 4, 3: 1, 4: 2 },
    };
    expectWarmMatchesClean(probe, [
      [0, deleteLabel],
      [1, deleteLabel],
    ]);
  });

  test('a keep-lines paragraph that fills both columns reaches a fixed point', () => {
    // The paragraph holds each column of the first page alone, which lets the body pass
    // split it there. The reserve pass read the other column's fragment as a second block
    // and the reserves orbited to the attempt cap.
    const probe: Probe = {
      lines: 30,
      columns: 2,
      paragraphs: [{ lines: 30, keepLines: true, spacing: SPACED_BEFORE }],
      refs: { 27: [1], 28: [2] },
      notes: { 1: 16, 2: 8 },
    };
    expect(pages(probe)).toEqual(['L01..L21', 'L22..L30 | 1 2']);
    expectNotesWithReferences(probe);
  });
});
