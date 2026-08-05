// Word's paragraph pagination controls: `w:widowControl`, `w:keepNext`, `w:keepLines`
// (ECMA-376 §17.3.1.44, §17.3.1.15, §17.3.1.16).
//
// Every assertion here is about the DISTRIBUTION OF LINES ACROSS A PAGE BOUNDARY, not about a
// property having been read: the whole point of these three is where the cut lands.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import {
  adjustedBreakIndex,
  paragraphKeeps,
  DEFAULT_PARAGRAPH_KEEPS,
} from '../pagination-keeps.ts';
import type { PageGeometry, PageRecord } from '../semantic-records.ts';
import { paragraphIndent } from '../paragraph-flow.ts';
import { paragraphTabStops } from '../paragraph-tabs.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

// 14pt lines in an 80pt content column: exactly five lines fit on a page.
const measurer = createFixedMeasurer(6, 14);
const SMALL: PageGeometry = {
  width: 200,
  height: 100,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

const lay = (body: string) => layoutSemanticDocument(load(body), 1, { measurer, geometry: SMALL });

// The 6pt/14pt measurer base describes an 11pt run, so every fixture authors `w:sz="22"`.
// Leaning on the terminal fallback instead would measure at 10pt (see `DEFAULT_RUN_STYLE`)
// and scale every line box by 10/11, which is a font-size question, not a pagination one.

/** One line of text, so filler paragraphs are countable. */
const one = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;

/** `count` lines in ONE paragraph, via hard breaks — deterministic, no wrap arithmetic. */
const multi = (count: number, pPr = '') => {
  const runs = Array.from({ length: count }, (_, index) => `<w:t>l${index}</w:t>`).join('<w:br/>');
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:rPr><w:sz w:val="22"/></w:rPr>${runs}</w:r></w:p>`;
};

const fillers = (count: number) =>
  Array.from({ length: count }, (_, index) => one(`f${index}`)).join('');

/** Lines on each page, in order — the shape every pagination rule here is about. */
const linesPerPage = (pages: readonly PageRecord[]): number[] =>
  pages.map((page) =>
    page.fragments.reduce((sum, f) => sum + (f.kind === 'paragraph' ? f.lines.length : 0), 0)
  );

const WIDOW_OFF = '<w:widowControl w:val="0"/>';

describe('w:widowControl (§17.3.1.44) — on unless a document turns it off', () => {
  test('an absent property means ON, so it applies to documents that never mention it', () => {
    expect(paragraphKeeps([])).toEqual(DEFAULT_PARAGRAPH_KEEPS);
    expect(paragraphKeeps([]).widowControl).toBe(true);
  });

  test('an explicit w:val="0" turns it off, and a later bare element turns it back on', () => {
    expect(paragraphKeeps([{ localName: 'widowControl', attributes: { val: '0' } }])).toMatchObject(
      {
        widowControl: false,
      }
    );
    // Cascade order is docDefaults → style → direct, so the LAST statement wins.
    expect(
      paragraphKeeps([
        { localName: 'widowControl', attributes: { val: 'false' } },
        { localName: 'widowControl' },
      ]).widowControl
    ).toBe(true);
  });

  test('an orphan is prevented: a lone FIRST line at the page bottom pulls the paragraph over', () => {
    // Four fillers leave room for exactly one more line. Without the rule the two-line
    // paragraph splits 1/1; Word moves both lines instead.
    const layout = lay(fillers(4) + multi(2));
    expect(linesPerPage(layout.pages)).toEqual([4, 2]);
    // And it is ONE fragment, not two — the paragraph was moved, not cut.
    const moved = layout.pages[1]!.fragments.filter((f) => f.kind === 'paragraph');
    expect(moved).toHaveLength(1);
  });

  test('turning it off restores the naive split, proving the rule is what moved the line', () => {
    expect(linesPerPage(lay(fillers(4) + multi(2, WIDOW_OFF)).pages)).toEqual([5, 1]);
  });

  test('a widow is prevented: a lone LAST line at the page top drags a second over with it', () => {
    // Two fillers plus a four-line paragraph would break 3/1. Word breaks 2/2.
    expect(linesPerPage(lay(fillers(2) + multi(4)).pages)).toEqual([4, 2]);
    expect(linesPerPage(lay(fillers(2) + multi(4, WIDOW_OFF)).pages)).toEqual([5, 1]);
  });

  test('a three-line paragraph with room for two moves whole: fixing the widow makes an orphan', () => {
    expect(linesPerPage(lay(fillers(3) + multi(3)).pages)).toEqual([3, 3]);
    expect(linesPerPage(lay(fillers(3) + multi(3, WIDOW_OFF)).pages)).toEqual([5, 1]);
  });

  test('a single-line paragraph is never moved — there is no line to strand', () => {
    expect(linesPerPage(lay(fillers(4) + one('tail')).pages)).toEqual([5]);
  });

  test('a paragraph taller than a page still fragments rather than looping', () => {
    // Nothing can satisfy the rule here, so it fails open and the content is placed.
    const layout = lay(multi(12));
    expect(linesPerPage(layout.pages).reduce((a, b) => a + b, 0)).toBe(12);
    expect(layout.pages.length).toBeGreaterThan(1);
  });
});

describe('w:keepLines (§17.3.1.16) — every line of one paragraph on one page', () => {
  test('a paragraph that would split moves whole, past what widow control alone would do', () => {
    // One filler leaves room for four of the five lines. Widow control alone breaks 3/2;
    // keepLines moves all five.
    expect(linesPerPage(lay(one('f0') + multi(5)).pages)).toEqual([4, 2]);
    expect(linesPerPage(lay(one('f0') + multi(5, '<w:keepLines/>')).pages)).toEqual([1, 5]);
  });

  test('w:val="0" is an explicit off, so the paragraph splits again', () => {
    expect(
      linesPerPage(lay(one('f0') + multi(5, '<w:keepLines w:val="0"/>' + WIDOW_OFF)).pages)
    ).toEqual([5, 1]);
  });

  test('a paragraph taller than a page fails open and fragments — Word gives up, it does not hang', () => {
    const layout = lay(multi(12, '<w:keepLines/>'));
    expect(linesPerPage(layout.pages).reduce((a, b) => a + b, 0)).toBe(12);
    expect(layout.pages.length).toBeGreaterThan(1);
  });
});

describe('w:keepNext (§17.3.1.15) — stay on the page the next paragraph starts on', () => {
  test('a heading at the foot of a page moves down to meet its body text', () => {
    const body = fillers(4) + one('heading', '<w:keepNext/>') + one('body');
    expect(linesPerPage(lay(body).pages)).toEqual([4, 2]);
    // Without the property the heading is stranded as the last line of page one.
    expect(linesPerPage(lay(fillers(4) + one('heading') + one('body')).pages)).toEqual([5, 1]);
  });

  test('a chain of keepNext paragraphs moves together, not one at a time', () => {
    const body = fillers(4) + one('h1', '<w:keepNext/>') + one('h2', '<w:keepNext/>') + one('body');
    expect(linesPerPage(lay(body).pages)).toEqual([4, 3]);
  });

  test('a chain that cannot fit a page of its own is abandoned, and everything is still placed', () => {
    // The kept-with paragraph is twelve lines: no page can hold the group.
    const body = fillers(4) + one('h1', '<w:keepNext/>') + multi(12, '<w:keepNext/>') + one('end');
    const layout = lay(body);
    expect(linesPerPage(layout.pages).reduce((a, b) => a + b, 0)).toBe(4 + 1 + 12 + 1);
  });

  test('the last paragraph of a story keeps with nothing, so it is not moved', () => {
    expect(linesPerPage(lay(fillers(4) + one('tail', '<w:keepNext/>')).pages)).toEqual([5]);
  });

  test('a keepNext paragraph followed by a table is left alone — a table cannot be priced', () => {
    const table = `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
    const layout = lay(fillers(4) + one('heading', '<w:keepNext/>') + table);
    expect(linesPerPage(layout.pages)[0]).toBe(5);
  });
});

describe('the keeps are style-inheritable, not direct-only', () => {
  test('cascaded properties are what the rule reads, so a style can carry the keep', () => {
    // `paragraphKeeps` is fed the CASCADED bag, so a style contributing `w:keepNext` reaches
    // the rule exactly as a direct `w:pPr` child would.
    expect(paragraphKeeps([{ localName: 'keepNext' }, { localName: 'keepLines' }])).toEqual({
      keepNext: true,
      keepLines: true,
      widowControl: true,
    });
  });
});

describe('the break-retreat rule in isolation', () => {
  const keeps = (over: Partial<typeof DEFAULT_PARAGRAPH_KEEPS>) => ({
    ...DEFAULT_PARAGRAPH_KEEPS,
    ...over,
  });

  test('a break with two lines each side is already legal and does not move', () => {
    expect(adjustedBreakIndex(2, 0, 4, keeps({}), false)).toBe(2);
  });

  test('a break leaving one line behind retreats to move the paragraph whole', () => {
    expect(adjustedBreakIndex(1, 0, 3, keeps({}), false)).toBe(0);
  });

  test('a break stranding the last line retreats by one', () => {
    expect(adjustedBreakIndex(3, 0, 4, keeps({}), false)).toBe(2);
  });

  test('keepLines retreats to the start of what the page holds', () => {
    expect(adjustedBreakIndex(4, 0, 5, keeps({ keepLines: true }), false)).toBe(0);
  });

  test('no retreat is offered when it could not progress — the paragraph already owns the page', () => {
    // Two lines with room for one: retreating moves both onto an identical empty page.
    expect(adjustedBreakIndex(1, 0, 2, keeps({}), true)).toBe(1);
    expect(adjustedBreakIndex(1, 0, 2, keeps({ keepLines: true }), true)).toBe(1);
  });

  test('keepLines on a page the paragraph owns still yields to widow control', () => {
    // Five lines, four fit, nothing can hold all five: keepLines gives up, but pulling the
    // cut back one line still stops the fifth opening the next page alone.
    expect(adjustedBreakIndex(4, 0, 5, keeps({ keepLines: true }), true)).toBe(3);
  });

  test('widow control off leaves the natural break alone', () => {
    expect(adjustedBreakIndex(3, 0, 4, keeps({ widowControl: false }), false)).toBe(3);
  });
});

describe('incremental layout still reuses pages by identity (task 9.4)', () => {
  const session = () => createLayoutSession();

  test('a no-change pass over a document with keeps returns the SAME page objects', () => {
    const part = load(fillers(4) + one('heading', '<w:keepNext/>') + multi(3));
    const options = {
      measurer,
      geometry: SMALL,
      session: session(),
      cache: createParagraphLayoutCache(),
    };
    const first = layoutSemanticDocument(part, 1, options);
    const second = layoutSemanticDocument(part, 2, options);
    expect(second.pages).toBe(first.pages);
    for (const [index, page] of second.pages.entries()) expect(page).toBe(first.pages[index]!);
  });

  test('editing the block a keepNext paragraph is kept WITH re-decides the keep', () => {
    // The heading fits beside a one-line body, so nothing moves. Grow the body past what the
    // page can hold beside the heading and the pair must move together — which only happens
    // if the heading's flow key saw the body change.
    const before = load(fillers(3) + one('heading', '<w:keepNext/>') + one('body'));
    const after = load(fillers(3) + one('heading', '<w:keepNext/>') + multi(3));
    const options = {
      measurer,
      geometry: SMALL,
      session: session(),
      cache: createParagraphLayoutCache(),
    };
    expect(linesPerPage(layoutSemanticDocument(before, 1, options).pages)).toEqual([5]);
    const grown = layoutSemanticDocument(after, 2, options);
    expect(linesPerPage(grown.pages)).toEqual([3, 4]);
    // Same answer as a cold pass with no session at all.
    expect(
      linesPerPage(layoutSemanticDocument(after, 1, { measurer, geometry: SMALL }).pages)
    ).toEqual(linesPerPage(grown.pages));
  });

  test('an incremental pass produces the same line ids a cold pass does', () => {
    // The retreat hands line ids back before re-placing, so an un-placed line keeps its id.
    const part = load(fillers(2) + multi(4) + one('tail'));
    const options = {
      measurer,
      geometry: SMALL,
      session: session(),
      cache: createParagraphLayoutCache(),
    };
    layoutSemanticDocument(load(fillers(2) + multi(4)), 1, options);
    const warm = layoutSemanticDocument(part, 2, options);
    const cold = layoutSemanticDocument(part, 1, { measurer, geometry: SMALL });
    const ids = (pages: readonly PageRecord[]) =>
      pages.flatMap((page) =>
        page.fragments.flatMap((f) => (f.kind === 'paragraph' ? f.lines.map((l) => l.id) : []))
      );
    expect(ids(warm.pages)).toEqual(ids(cold.pages));
  });
});

describe('w:ind digit cap (C3) — a hostile indent cannot reach paint geometry', () => {
  test('a 1000-digit w:left is dropped rather than becoming Infinity', () => {
    const huge = '9'.repeat(1000);
    const indent = paragraphIndent([{ localName: 'ind', attributes: { left: huge } }]);
    expect(indent.left).toBe(0);
    expect(Number.isFinite(indent.left)).toBe(true);
  });

  test('an over-long but finite value is dropped, matching the sibling readers', () => {
    // Ten digits: `Number` handles it, but every other reader in layout caps at nine.
    expect(paragraphIndent([{ localName: 'ind', attributes: { left: '1234567890' } }]).left).toBe(
      0
    );
  });

  test('an in-range value still clamps rather than running away', () => {
    // 999_999_999 twips is nine digits and passes the pattern; the clamp holds it at 22".
    const indent = paragraphIndent([{ localName: 'ind', attributes: { left: '999999999' } }]);
    expect(indent.left).toBe(31_680 / 20);
  });

  test('negative indents survive, clamped symmetrically', () => {
    expect(paragraphIndent([{ localName: 'ind', attributes: { left: '-720' } }]).left).toBe(-36);
    expect(
      paragraphIndent([{ localName: 'ind', attributes: { right: '-99999999999' } }]).right
    ).toBe(0);
  });

  test('ordinary indents are untouched', () => {
    const indent = paragraphIndent([
      { localName: 'ind', attributes: { left: '720', right: '360' } },
    ]);
    expect(indent).toEqual({ left: 36, right: 18 });
  });
});

describe('ISO 29500 Strict tab alignments (B12)', () => {
  const tabs = (xml: string) => {
    const part = load(`<w:p><w:pPr><w:tabs>${xml}</w:tabs></w:pPr></w:p>`);
    // document → body → p → pPr
    return paragraphTabStops(part.root.children[0]!.children[0]!.children[0]!);
  };

  test('w:val="end" is a RIGHT stop, not a dropped one', () => {
    // A Strict-saved table of contents writes `end`; dropping it sent every page number to a
    // default-interval left tab.
    const resolved = tabs('<w:tab w:val="end" w:pos="3600" w:leader="dot"/>');
    expect(resolved.stops).toHaveLength(1);
    expect(resolved.stops[0]).toMatchObject({ positionPt: 180, alignment: 'right', leader: 'dot' });
  });

  test('w:val="start" is a LEFT stop', () => {
    expect(tabs('<w:tab w:val="start" w:pos="1440"/>').stops[0]).toMatchObject({
      positionPt: 72,
      alignment: 'left',
    });
  });

  test('the transitional spellings are unchanged', () => {
    const resolved = tabs(
      '<w:tab w:val="left" w:pos="720"/><w:tab w:val="center" w:pos="1440"/>' +
        '<w:tab w:val="right" w:pos="2160"/><w:tab w:val="decimal" w:pos="2880"/>'
    );
    expect(resolved.stops.map((stop) => stop.alignment)).toEqual([
      'left',
      'center',
      'right',
      'decimal',
    ]);
  });

  test('a genuinely unknown alignment is still ignored', () => {
    expect(tabs('<w:tab w:val="sideways" w:pos="720"/>').stops).toHaveLength(0);
    // `bar` and `num` are not stops.
    expect(tabs('<w:tab w:val="bar" w:pos="720"/>').stops).toHaveLength(0);
  });
});
