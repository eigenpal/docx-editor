// `w:pBdr` on a paragraph INSIDE a table cell (ECMA-376 §17.3.1.24).
//
// Body flow publishes all six edges; cell flow read only `w:bottom`, so the boxed callout
// every template puts in a cell — four rules around a note — rendered as a lone underline.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import {
  type PageGeometry,
  type ParagraphBorderSide,
  type ParagraphFragmentRecord,
  type SemanticLayout,
} from '../semantic-records.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);

/** Tiny page: 100pt tall, 10pt margins → 80pt content box, so a cell row paginates. */
const TINY: PageGeometry = {
  width: 200,
  height: 100,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

const lay = (body: string, geometry?: PageGeometry): SemanticLayout =>
  layoutSemanticDocument(load(body), 1, { measurer, ...(geometry ? { geometry } : {}) });

const paragraph = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${text ? `<w:r><w:t>${text}</w:t></w:r>` : ''}</w:p>`;

const oneCellTable = (content: string, tcPr = '') =>
  `<w:tbl><w:tr><w:tc>${tcPr}${content}</w:tc></w:tr></w:tbl>`;

/** A four-edge box: 1pt rules, 4pt from the text — Word's own Box defaults. */
const BOX =
  '<w:pBdr>' +
  '<w:top w:val="single" w:sz="8" w:space="4" w:color="C00000"/>' +
  '<w:left w:val="single" w:sz="8" w:space="4" w:color="C00000"/>' +
  '<w:bottom w:val="single" w:sz="8" w:space="4" w:color="C00000"/>' +
  '<w:right w:val="single" w:sz="8" w:space="4" w:color="C00000"/>' +
  '</w:pBdr>';

/** Every cell paragraph fragment of a layout, in reading order across pages. */
function cellParagraphs(layout: SemanticLayout): ParagraphFragmentRecord[] {
  const found: ParagraphFragmentRecord[] = [];
  for (const page of layout.pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'table') continue;
      for (const row of fragment.rows) {
        for (const cell of row.cells) {
          for (const block of cell.blocks) {
            if (block.kind === 'paragraph') found.push(block);
          }
        }
      }
    }
  }
  return found;
}

function sides(fragment: ParagraphFragmentRecord): ParagraphBorderSide[] {
  return (fragment.borders ?? []).map((entry) => entry.side);
}

function stroke(fragment: ParagraphFragmentRecord, side: ParagraphBorderSide) {
  const found = (fragment.borders ?? []).find((entry) => entry.side === side);
  if (!found) throw new Error(`no ${side} stroke on ${fragment.id}`);
  return found;
}

describe('a boxed cell paragraph publishes the whole frame, not just the underline', () => {
  test('all four edges are placed around the cell text', () => {
    const fragment = cellParagraphs(lay(oneCellTable(paragraph('note', BOX))))[0]!;
    expect(sides(fragment).sort()).toEqual(['bottom', 'left', 'right', 'top']);
  });

  test('the rules sit at the same offsets body flow uses', () => {
    const fragment = cellParagraphs(lay(oneCellTable(paragraph('note', BOX))))[0]!;
    const line = fragment.lines[0]!;
    const top = stroke(fragment, 'top');
    const bottom = stroke(fragment, 'bottom');
    const left = stroke(fragment, 'left');
    const right = stroke(fragment, 'right');

    // Horizontal rules sit `space` away from the lines vertically.
    expect(top.box.y + top.box.height).toBe(line.box.y - 4);
    expect(bottom.box.y).toBe(line.box.y + line.box.height + 4);

    // Word draws the side rules OUTSIDE the text column and never re-breaks the lines,
    // so inside a cell they hang into the cell margin exactly as they hang into the
    // page margin in the body.
    expect(left.box.x + left.box.width).toBe(line.box.x - 4);
    expect(right.box.x).toBe(line.box.x + line.box.width + 4);

    // And the frame CLOSES, exactly as it does in body flow — one document must not paint
    // the same callout two ways depending on whether it sits in a cell.
    expect(top.box.x).toBe(left.box.x);
    expect(top.box.x + top.box.width).toBe(right.box.x + right.box.width);
    expect(bottom.box.x).toBe(top.box.x);
    expect(bottom.box.width).toBe(top.box.width);
    expect(left.box.y).toBe(top.box.y);
    expect(left.box.y + left.box.height).toBe(bottom.box.y + bottom.box.height);
    expect(right.box.height).toBe(left.box.height);
  });

  test('bottomBorder still names the bottom rule alone', () => {
    const fragment = cellParagraphs(lay(oneCellTable(paragraph('note', BOX))))[0]!;
    expect(fragment.bottomBorder?.box).toEqual(stroke(fragment, 'bottom').box);
  });

  test('the top rule is flow height: it pushes the text down and grows the row', () => {
    const bareLayout = lay(oneCellTable(paragraph('note')));
    const boxedLayout = lay(oneCellTable(paragraph('note', BOX)));
    const bare = cellParagraphs(bareLayout)[0]!;
    const boxed = cellParagraphs(boxedLayout)[0]!;
    // top space (4) + top rule (1) above the line; bottom space (4) + rule (1) below it.
    expect(boxed.lines[0]!.box.y - bare.lines[0]!.box.y).toBe(5);
    expect(boxed.box.height - bare.box.height).toBe(10);
    expect(boxed.box.y).toBe(bare.box.y);
    // The cell has to grow with it, or the frame paints over the cell's own bottom rule.
    const rowOf = (layout: SemanticLayout) =>
      layout.pages[0]!.fragments.find((fragment) => fragment.kind === 'table')!;
    expect(rowOf(boxedLayout).box.height - rowOf(bareLayout).box.height).toBe(10);
  });

  test('a box does not reflow cell text — same breaks as an unbordered twin', () => {
    const words = Array.from({ length: 30 }, (_, index) => `word${index}`).join(' ');
    const bare = cellParagraphs(lay(oneCellTable(paragraph(words))))[0]!;
    const boxed = cellParagraphs(lay(oneCellTable(paragraph(words, BOX))))[0]!;
    expect(boxed.lines.map((line) => line.range.end)).toEqual(
      bare.lines.map((line) => line.range.end)
    );
    expect(boxed.box.width).toBe(bare.box.width);
  });

  test('w:bar draws beside the cell paragraph and costs no height', () => {
    const BAR = '<w:pBdr><w:bar w:val="single" w:sz="8" w:space="2"/></w:pBdr>';
    const fragment = cellParagraphs(lay(oneCellTable(paragraph('changed', BAR))))[0]!;
    expect(sides(fragment)).toEqual(['bar']);
    const bar = stroke(fragment, 'bar');
    const line = fragment.lines[0]!;
    expect(bar.box.x + bar.box.width).toBe(line.box.x - 2);
    expect(bar.box.height).toBe(line.box.height);
    expect(fragment.box.height).toBe(
      cellParagraphs(lay(oneCellTable(paragraph('changed'))))[0]!.box.height
    );
  });

  test('an unbordered cell paragraph publishes no strokes at all', () => {
    expect(cellParagraphs(lay(oneCellTable(paragraph('plain'))))[0]!.borders).toBeUndefined();
  });
});

describe('consecutive cell paragraphs with identical borders are ONE bordered block', () => {
  /** Word's `HorizontalLine`: a bottom rule and nothing else. */
  const RULE = '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>';

  test('two identically ruled paragraphs draw one rule, not two', () => {
    const fragments = cellParagraphs(
      lay(oneCellTable(paragraph('first', RULE) + paragraph('second', RULE)))
    );
    expect(fragments).toHaveLength(2);
    // The run has no `w:between`, so the interior boundary carries nothing at all.
    expect(fragments[0]!.borders ?? []).toHaveLength(0);
    expect(sides(fragments[1]!)).toEqual(['bottom']);
    expect(fragments[0]!.bottomBorder).toBeUndefined();
  });

  test('a boxed run opens above the first paragraph and closes below the last', () => {
    const fragments = cellParagraphs(
      lay(oneCellTable(paragraph('first', BOX) + paragraph('second', BOX)))
    );
    expect(sides(fragments[0]!).sort()).toEqual(['left', 'right', 'top']);
    expect(sides(fragments[1]!).sort()).toEqual(['bottom', 'left', 'right']);
    // One outline: the side rules meet across the gap between the two paragraphs.
    const upper = stroke(fragments[0]!, 'left');
    const lower = stroke(fragments[1]!, 'left');
    expect(upper.box.y + upper.box.height).toBeCloseTo(lower.box.y, 6);
  });

  test('an interior boundary carries w:between when the run declares one', () => {
    const withBetween =
      '<w:pBdr>' +
      '<w:top w:val="single" w:sz="8" w:space="4" w:color="C00000"/>' +
      '<w:between w:val="single" w:sz="4" w:space="2" w:color="00B050"/>' +
      '<w:bottom w:val="single" w:sz="8" w:space="4" w:color="C00000"/>' +
      '</w:pBdr>';
    const fragments = cellParagraphs(
      lay(oneCellTable(paragraph('first', withBetween) + paragraph('second', withBetween)))
    );
    expect(sides(fragments[0]!).sort()).toEqual(['between', 'top']);
    expect(sides(fragments[1]!)).toEqual(['bottom']);
    // `bottomBorder` names the block's bottom rule alone; a `between` is a different edge.
    expect(fragments[0]!.bottomBorder).toBeUndefined();
    expect(stroke(fragments[0]!, 'between').edge.color).toBe('00B050');
  });

  test('paragraphs whose borders differ each keep their own frame', () => {
    const other = BOX.replace(/C00000/g, '0070C0');
    const fragments = cellParagraphs(
      lay(oneCellTable(paragraph('first', BOX) + paragraph('second', other)))
    );
    expect(sides(fragments[0]!).sort()).toEqual(['bottom', 'left', 'right', 'top']);
    expect(sides(fragments[1]!).sort()).toEqual(['bottom', 'left', 'right', 'top']);
  });

  test('a different indent splits the group, exactly as it does in body flow', () => {
    const indented = `<w:ind w:left="720"/>${BOX}`;
    const fragments = cellParagraphs(
      lay(oneCellTable(paragraph('first', BOX) + paragraph('second', indented)))
    );
    expect(sides(fragments[0]!)).toContain('bottom');
    expect(sides(fragments[1]!)).toContain('top');
  });
});

describe('a boxed cell paragraph that spans pages opens once and closes once', () => {
  const long = 'word '.repeat(40).trim();

  test('the top rule rides the first fragment and the bottom the last', () => {
    const fragments = cellParagraphs(lay(oneCellTable(paragraph(long, BOX)), TINY));
    expect(fragments.length).toBeGreaterThan(1);
    expect(sides(fragments[0]!)).toContain('top');
    expect(sides(fragments[0]!)).not.toContain('bottom');
    const last = fragments[fragments.length - 1]!;
    expect(sides(last)).toContain('bottom');
    expect(sides(last)).not.toContain('top');
    // Exactly one closing rule across the whole paragraph.
    expect(fragments.filter((fragment) => sides(fragment).includes('bottom'))).toHaveLength(1);
    // The side rules follow the text onto every page it reaches.
    for (const fragment of fragments) expect(sides(fragment)).toContain('left');
  });

  test('no fragment paints its frame past the page content box', () => {
    const layout = lay(oneCellTable(paragraph(long, BOX)), TINY);
    for (const page of layout.pages) {
      const limit = page.contentBox.height;
      for (const fragment of cellParagraphs({ ...layout, pages: [page] })) {
        for (const entry of fragment.borders ?? []) {
          expect(entry.box.y + entry.box.height).toBeLessThanOrEqual(limit + 0.001);
        }
      }
    }
  });
});

describe('vAlign moves the frame with the text it encloses', () => {
  test('a centred cell shifts strokes and lines by the same amount', () => {
    // Two cells in one row: a tall one sets the row height, the bordered one centres in it.
    const body =
      '<w:tbl><w:tr>' +
      `<w:tc><w:tcPr><w:vAlign w:val="center"/></w:tcPr>${paragraph('note', BOX)}</w:tc>` +
      `<w:tc>${Array.from({ length: 6 }, (_, index) => paragraph(`tall${index}`)).join('')}</w:tc>` +
      '</w:tr></w:tbl>';
    const centred = cellParagraphs(lay(body))[0]!;
    const flush = cellParagraphs(lay(body.replace('<w:vAlign w:val="center"/>', '')))[0]!;
    const dy = centred.lines[0]!.box.y - flush.lines[0]!.box.y;
    expect(dy).toBeGreaterThan(0);
    for (const side of ['top', 'bottom', 'left', 'right'] as const) {
      expect(stroke(centred, side).box.y - stroke(flush, side).box.y).toBeCloseTo(dy, 6);
    }
  });
});

describe('paint draws the cell frame from the published boxes', () => {
  test('four rules reach the DOM at the layout-owned geometry', () => {
    const layout = lay(oneCellTable(paragraph('note', BOX)));
    const fragment = cellParagraphs(layout)[0]!;
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1 });
    expect(container.querySelectorAll('.docx-paragraph-border')).toHaveLength(4);
    for (const side of ['top', 'left', 'bottom', 'right'] as const) {
      const rule = container.querySelector<HTMLElement>(`.docx-paragraph-border-${side}`)!;
      const published = stroke(fragment, side);
      expect(Number.parseFloat(rule.style.left)).toBeCloseTo(published.box.x - fragment.box.x, 6);
      expect(Number.parseFloat(rule.style.top)).toBeCloseTo(published.box.y - fragment.box.y, 6);
      expect(rule.style.backgroundColor.toLowerCase()).toBe('#c00000');
    }
  });
});

describe('a shaded box in a cell is filled across the frame', () => {
  test('shading covers the bordered rectangle, exactly as it does in body flow', () => {
    // The border/shading rule landed in the body flow first; a cell paragraph kept painting
    // the old geometry, so one document rendered the identical callout two ways.
    const fragment = cellParagraphs(
      lay(oneCellTable(paragraph('note', `${BOX}<w:shd w:val="clear" w:fill="E8F0FE"/>`)))
    )[0]!;
    const top = stroke(fragment, 'top');
    const bottom = stroke(fragment, 'bottom');
    const left = stroke(fragment, 'left');
    const right = stroke(fragment, 'right');
    const box = fragment.shadingBox!;
    expect(fragment.shading).toBe('E8F0FE');
    expect(box.x).toBe(left.box.x);
    expect(box.x + box.width).toBe(right.box.x + right.box.width);
    expect(box.y).toBe(top.box.y);
    expect(box.y + box.height).toBe(bottom.box.y + bottom.box.height);
  });
});
