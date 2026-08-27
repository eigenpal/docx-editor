// A vertical merge under a floating drawing: what happens when the probe was wrong.
//
// `measureRowHeight` strips wrap bands and probes at `y = 0`, so a float over a table makes
// every planned height an under-estimate of the placed one. That is the trigger behind four
// consecutive review findings on span sizing, and it is what `float-over-table-harness.ts`
// exists to put under test.
//
// The claim each test here pins is the same one the span plan's module comment makes: a
// detached head's content stops at the page content box, and it never paints outside the
// table its span made. Neither may depend on the plan's numbers being right.

import { describe, expect, test } from 'bun:test';
import {
  layoutUnderFloat,
  layoutWithoutFloat,
  loadBody,
  squareWrapZone,
  TINY_CONTENT,
} from './float-over-table-harness.ts';
import type { ExclusionZone } from '../drawing-exclusion.ts';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const tc = (content: string, tcPr = '') => `<w:tc>${tcPr}${content}</w:tc>`;
const RESTART = '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>';
const CONTINUE = '<w:tcPr><w:vMerge/></w:tcPr>';
const GRID =
  '<w:tblPr><w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="8" w:color="000000"/>`)
    .join('') +
  '</w:tblBorders></w:tblPr>';

/** Four words in the merged head: wrappable, and short enough to be planned unwrapped. */
const HEAD_TEXT = 'h0 h1 h2 h3';

/**
 * Two filler paragraphs, then a two-row merge in column 0 and a plain row after it. The
 * fillers put the table where a band over column 0 crosses the head row.
 */
const BODY =
  `${p('F0')}${p('F1')}<w:tbl>${GRID}` +
  `<w:tr>${tc(p(HEAD_TEXT), RESTART)}${tc(p('s0'))}</w:tr>` +
  `<w:tr>${tc(p('g'), CONTINUE)}${tc(p('s2'))}</w:tr>` +
  `<w:tr>${tc(p('a2'))}${tc(p('b2'))}</w:tr>` +
  '</w:tbl>';

const part = loadBody(BODY);

function anchorParagraphId(): string {
  const first = layoutWithoutFloat(part).pages[0]!.fragments[0]!;
  if (first.kind !== 'paragraph') throw new Error('expected a leading paragraph to anchor to');
  return first.paragraphId;
}

/** A band over the left column only, so the merged head is the cell that has to wrap. */
function overHeadColumn(top: number, height: number): ReadonlyMap<number, ExclusionZone[]> {
  return new Map([
    [
      0,
      [
        squareWrapZone({
          anchorParagraphId: anchorParagraphId(),
          top,
          height,
          left: 0,
          width: 60,
        }),
      ],
    ],
  ]);
}

/**
 * A band over the RIGHT column, which in this fixture is the covered rows' own cells rather
 * than the merged head. A covered row that places taller than its floor pushes the span past
 * the page it was admitted onto, and the head is measured accurately either way — so this is
 * the half of the divergence an accurate head probe does not cover.
 */
function overCoveredColumn(top: number, height: number): ReadonlyMap<number, ExclusionZone[]> {
  return new Map([
    [
      0,
      [
        squareWrapZone({
          anchorParagraphId: anchorParagraphId(),
          top,
          height,
          left: 120,
          width: 60,
        }),
      ],
    ],
  ]);
}

/** How far the lowest painted block sits BELOW the table that is supposed to contain it. */
function worstOverhangPt(layout: SemanticLayout): number {
  let worst = 0;
  for (const page of layout.pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'table') continue;
      const tableBottom = fragment.box.y + fragment.box.height;
      for (const row of (fragment as TableFragmentRecord).rows) {
        for (const cell of row.cells) {
          for (const block of cell.blocks) {
            worst = Math.max(worst, block.box.y + block.box.height - tableBottom);
          }
        }
      }
    }
  }
  return worst;
}

function paintedBottomPt(layout: SemanticLayout, pageIndex: number): number {
  let bottom = 0;
  for (const fragment of layout.pages[pageIndex]?.fragments ?? []) {
    bottom = Math.max(bottom, fragment.box.y + fragment.box.height);
    if (fragment.kind !== 'table') continue;
    for (const row of (fragment as TableFragmentRecord).rows) {
      for (const cell of row.cells) {
        for (const block of cell.blocks) bottom = Math.max(bottom, block.box.y + block.box.height);
      }
    }
  }
  return bottom;
}

function paintedText(layout: SemanticLayout): string {
  return layout.pages
    .flatMap((page) => page.fragments)
    .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
    .flatMap((table) => table.rows)
    .flatMap((row) => row.cells)
    .flatMap((cell) => cell.blocks)
    .flatMap((block) => (block.kind === 'paragraph' ? block.lines : []))
    .flatMap((textLine) => textLine.spans)
    .map((span) => span.text)
    .join(' ');
}

describe('a merged head under a float the plan could not see', () => {
  // Two bands that both make the head wrap past what it was planned at. They are the two
  // shapes that painted merged text below the table's bottom border while the unsplit
  // placement left a detached head unbounded.
  for (const [top, height] of [
    [0, 45],
    [20, 30],
  ] as const) {
    test(`a band at y=${top} for ${height}pt keeps the head inside its table`, () => {
      const layout = layoutUnderFloat(part, overHeadColumn(top, height));
      expect(worstOverhangPt(layout)).toBe(0);
      for (const pageIndex of layout.pages.keys()) {
        expect(paintedBottomPt(layout, pageIndex)).toBeLessThanOrEqual(TINY_CONTENT.height + 0.001);
      }
    });

    test(`a band at y=${top} for ${height}pt loses no word of the merged head`, () => {
      // A bound that swallows what it clips is the other way to keep content inside a box.
      const painted = paintedText(layoutUnderFloat(part, overHeadColumn(top, height)));
      for (const word of HEAD_TEXT.split(' ')) expect(painted).toContain(word);
    });
  }

  for (const [top, height] of [
    [0, 45],
    [20, 30],
  ] as const) {
    test(`a band at y=${top} for ${height}pt over a COVERED row keeps the span on its page`, () => {
      // The rows a merge covers are measured where they will sit, bands included, for the
      // same reason the head is: a covered row that places taller than the floor the span
      // was admitted on takes the span past the bottom of the page it was admitted onto.
      const layout = layoutUnderFloat(part, overCoveredColumn(top, height));
      expect(worstOverhangPt(layout)).toBe(0);
      for (const pageIndex of layout.pages.keys()) {
        expect(paintedBottomPt(layout, pageIndex)).toBeLessThanOrEqual(TINY_CONTENT.height + 0.001);
      }
    });
  }

  test('the float changes the layout at all: the fixture cannot go quiet', () => {
    // If a band stopped reaching the table — a geometry change, a filter change — every
    // assertion above would pass against a document with no float in it.
    const withFloat = layoutUnderFloat(part, overHeadColumn(20, 30));
    const without = layoutWithoutFloat(part);
    expect(paintedBottomPt(withFloat, 0)).not.toBe(paintedBottomPt(without, 0));
  });
});
