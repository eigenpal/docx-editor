// Full `w:pBdr` resolution, placement and paint (ECMA-376 §17.3.1.24).
//
// Before this, only `w:bottom` was read, so a boxed callout — four edges, the shape every
// template uses for a note or a warning — rendered as a single underline.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core-contract/store';
import {
  MAX_BORDER_SPACE_PT,
  MAX_BORDER_WIDTH_PT,
  cascadedParagraphBorders,
  paragraphBorders,
  paragraphBordersFingerprint,
} from '../paragraph-style.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import {
  fragmentsOfParagraph,
  type PageGeometry,
  type ParagraphBorderSide,
  type ParagraphFragmentRecord,
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

const SMALL: PageGeometry = {
  width: 200,
  height: 100,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

const lay = (body: string, geometry?: PageGeometry) =>
  layoutSemanticDocument(load(body), 1, { measurer, ...(geometry ? { geometry } : {}) });

const paragraph = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${text ? `<w:r><w:t>${text}</w:t></w:r>` : ''}</w:p>`;

/** A four-edge box: 1pt rules, 4pt from the text — Word's own Box defaults. */
const BOX =
  '<w:pBdr>' +
  '<w:top w:val="single" w:sz="8" w:space="4" w:color="C00000"/>' +
  '<w:left w:val="single" w:sz="8" w:space="4" w:color="C00000"/>' +
  '<w:bottom w:val="single" w:sz="8" w:space="4" w:color="C00000"/>' +
  '<w:right w:val="single" w:sz="8" w:space="4" w:color="C00000"/>' +
  '</w:pBdr>';

function propertiesNodeOf(part: OoxmlPart, paragraphIndex = 0) {
  return part.root.children[0]!.children[paragraphIndex]!.children.find(
    (child) => child.kind === 'paragraphProperties'
  );
}

function paragraphsOf(layout: ReturnType<typeof lay>, pageIndex = 0): ParagraphFragmentRecord[] {
  const fragments: ParagraphFragmentRecord[] = [];
  for (const fragment of layout.pages[pageIndex]!.fragments) {
    if (fragment.kind === 'paragraph') fragments.push(fragment);
  }
  return fragments;
}

function sides(fragment: ParagraphFragmentRecord): ParagraphBorderSide[] {
  return (fragment.borders ?? []).map((stroke) => stroke.side);
}

function stroke(fragment: ParagraphFragmentRecord, side: ParagraphBorderSide) {
  const found = (fragment.borders ?? []).find((entry) => entry.side === side);
  if (!found) throw new Error(`no ${side} stroke on ${fragment.id}`);
  return found;
}

describe('paragraphBorders reads every CT_PBdr child', () => {
  test('all six edges resolve with their own val/sz/space/color', () => {
    const part = load(
      paragraph(
        'x',
        '<w:pBdr>' +
          '<w:top w:val="single" w:sz="24" w:space="1" w:color="C00000"/>' +
          '<w:left w:val="dashed" w:sz="8" w:space="4" w:color="0000FF"/>' +
          '<w:bottom w:val="double" w:sz="16" w:space="2" w:color="auto"/>' +
          '<w:right w:val="dotted" w:sz="4" w:space="5"/>' +
          '<w:between w:val="single" w:sz="8" w:space="3" w:color="008000"/>' +
          '<w:bar w:val="single" w:sz="12" w:space="0" w:color="808080"/>' +
          '</w:pBdr>'
      )
    );
    expect(paragraphBorders(propertiesNodeOf(part))).toEqual({
      top: { val: 'single', color: 'C00000', widthPt: 3, spacePt: 1 },
      left: { val: 'dashed', color: '0000FF', widthPt: 1, spacePt: 4 },
      bottom: { val: 'double', color: null, widthPt: 2, spacePt: 2 },
      right: { val: 'dotted', color: null, widthPt: 0.5, spacePt: 5 },
      between: { val: 'single', color: '008000', widthPt: 1, spacePt: 3 },
      bar: { val: 'single', color: '808080', widthPt: 1.5, spacePt: 0 },
    });
  });

  test('w:start/w:end stand in for w:left/w:right', () => {
    const part = load(
      paragraph(
        'x',
        '<w:pBdr><w:start w:val="single" w:sz="8"/><w:end w:val="single" w:sz="16"/></w:pBdr>'
      )
    );
    const borders = paragraphBorders(propertiesNodeOf(part));
    expect(borders.left?.widthPt).toBe(1);
    expect(borders.right?.widthPt).toBe(2);
  });

  test('w:shadow is carried only when authored true', () => {
    const part = load(
      paragraph(
        'x',
        '<w:pBdr><w:top w:val="single" w:sz="8" w:shadow="1"/>' +
          '<w:bottom w:val="single" w:sz="8" w:shadow="0"/></w:pBdr>'
      )
    );
    const borders = paragraphBorders(propertiesNodeOf(part));
    expect(borders.top?.shadow).toBe(true);
    expect(borders.bottom?.shadow).toBeUndefined();
  });

  test('every edge is clamped and sanitised, not only the bottom one', () => {
    const hostile = (name: string) =>
      `<w:${name} w:val="single" w:sz="999999999" w:space="999999999" w:color="url(javascript:1)"/>`;
    const part = load(
      paragraph(
        'x',
        `<w:pBdr>${['top', 'left', 'bottom', 'right', 'between', 'bar'].map(hostile).join('')}</w:pBdr>`
      )
    );
    const borders = paragraphBorders(propertiesNodeOf(part));
    for (const side of ['top', 'left', 'bottom', 'right', 'between', 'bar'] as const) {
      const edge = borders[side]!;
      expect(edge.color).toBeNull();
      expect(edge.widthPt).toBeLessThanOrEqual(MAX_BORDER_WIDTH_PT);
      expect(edge.spacePt).toBeLessThanOrEqual(MAX_BORDER_SPACE_PT);
    }
  });

  test('nil/none clear their own edge and leave the rest of the box', () => {
    const part = load(
      paragraph(
        'x',
        '<w:pBdr><w:top w:val="single" w:sz="8"/><w:left w:val="nil"/>' +
          '<w:bottom w:val="none"/><w:right w:val="single" w:sz="8"/></w:pBdr>'
      )
    );
    expect(Object.keys(paragraphBorders(propertiesNodeOf(part))).sort()).toEqual(['right', 'top']);
  });
});

describe('cascadedParagraphBorders replaces a w:pBdr wholesale', () => {
  test('a later w:pBdr discards the box an earlier one declared', () => {
    const styled = load(paragraph('x', BOX));
    const direct = load(paragraph('x', '<w:pBdr><w:bottom w:val="single" w:sz="8"/></w:pBdr>'));
    const merged = cascadedParagraphBorders([propertiesNodeOf(styled)!, propertiesNodeOf(direct)!]);
    // Word does not fold edge by edge: a style stating only `w:bottom` leaves an underline,
    // not the ancestor's box with a new bottom.
    expect(Object.keys(merged)).toEqual(['bottom']);
  });

  test('a node without a w:pBdr inherits rather than clearing', () => {
    const styled = load(paragraph('x', BOX));
    const plain = load(paragraph('x', '<w:spacing w:after="120"/>'));
    const merged = cascadedParagraphBorders([propertiesNodeOf(styled)!, propertiesNodeOf(plain)!]);
    expect(Object.keys(merged).sort()).toEqual(['bottom', 'left', 'right', 'top']);
  });

  test('a paragraph style box reaches layout through the cascade', () => {
    const styles = readOoxmlPart(
      `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Callout">` +
        `<w:name w:val="Callout"/><w:pPr>${BOX}</w:pPr></w:style></w:styles>`,
      { name: '/word/styles.xml', contentType: 'app/xml' }
    );
    if (!styles.ok) throw new Error(styles.reason);
    const layout = layoutSemanticDocument(
      load(paragraph('note', '<w:pStyle w:val="Callout"/>')),
      1,
      { measurer, styleCascade: buildStyleCascadeTable(styles.part.root) }
    );
    expect(sides(paragraphsOf(layout)[0]!).sort()).toEqual(['bottom', 'left', 'right', 'top']);
  });
});

describe('a box publishes four strokes around the unchanged text column', () => {
  test('every edge is placed, and the side rules sit OUTSIDE the text', () => {
    const layout = lay(paragraph('boxed', BOX));
    const fragment = paragraphsOf(layout)[0]!;
    expect(sides(fragment).sort()).toEqual(['bottom', 'left', 'right', 'top']);

    const line = fragment.lines[0]!;
    const top = stroke(fragment, 'top');
    const bottom = stroke(fragment, 'bottom');
    const left = stroke(fragment, 'left');
    const right = stroke(fragment, 'right');

    // Horizontal rules span the text column, `space` away from the lines.
    expect(top.box.y + top.box.height).toBe(line.box.y - 4);
    expect(bottom.box.y).toBe(line.box.y + line.box.height + 4);
    expect(top.box.x).toBe(line.box.x);
    expect(top.box.width).toBe(line.box.width);

    // Word draws the side rules beyond the text and never re-breaks the lines for them, so
    // the left rule ends 4pt left of the text and the right one starts 4pt right of it.
    expect(left.box.x + left.box.width).toBe(line.box.x - 4);
    expect(right.box.x).toBe(line.box.x + line.box.width + 4);
    // Sides run the full height of the frame, corner to corner.
    expect(left.box.y).toBe(top.box.y);
    expect(left.box.y + left.box.height).toBe(bottom.box.y + bottom.box.height);
    expect(right.box).toEqual({ ...left.box, x: right.box.x });
  });

  test('a box does not reflow the text — same break, same line width, as an unbordered twin', () => {
    const words = Array.from({ length: 30 }, (_, index) => `word${index}`).join(' ');
    const bare = paragraphsOf(lay(paragraph(words)), 0)[0]!;
    const boxed = paragraphsOf(lay(paragraph(words, BOX)), 0)[0]!;
    expect(boxed.lines.map((line) => line.range.end)).toEqual(
      bare.lines.map((line) => line.range.end)
    );
    expect(boxed.box.width).toBe(bare.box.width);
  });

  test('the top rule is flow height: it pushes the first line down and grows the fragment', () => {
    const bare = paragraphsOf(lay(paragraph('x')))[0]!;
    const boxed = paragraphsOf(lay(paragraph('x', BOX)))[0]!;
    // top space (4) + top rule (1) above the line; bottom space (4) + rule (1) below it.
    expect(boxed.lines[0]!.box.y - bare.lines[0]!.box.y).toBe(5);
    expect(boxed.box.height - bare.box.height).toBe(10);
    expect(boxed.box.y).toBe(bare.box.y);
  });

  test('the added extent paginates: a top rule alone fills a page sooner', () => {
    // A TOP-only rule, so the page count moves on extent the bottom edge never contributed.
    // Each gets its own colour: no two paragraphs group into one frame, so every one of them
    // pays for its own top rule.
    const body = (bordered: boolean) =>
      Array.from({ length: 5 }, (_, index) =>
        paragraph(
          `line ${index}`,
          bordered
            ? `<w:pBdr><w:top w:val="single" w:sz="8" w:space="4" w:color="C0000${index}"/></w:pBdr>`
            : ''
        )
      ).join('');
    expect(lay(body(false), SMALL).pages).toHaveLength(1);
    expect(lay(body(true), SMALL).pages.length).toBeGreaterThan(1);
  });

  test('a paragraph split across pages opens once and closes once', () => {
    const long = paragraph(Array.from({ length: 40 }, (_, i) => `word${i}`).join(' '), BOX);
    const layout = lay(long, SMALL);
    const fragments = fragmentsOfParagraph(layout, '/word/document.xml#0.0.0');
    expect(fragments.length).toBeGreaterThan(1);
    expect(sides(fragments[0]!)).toContain('top');
    expect(sides(fragments[0]!)).not.toContain('bottom');
    const last = fragments[fragments.length - 1]!;
    expect(sides(last)).toContain('bottom');
    expect(sides(last)).not.toContain('top');
    // The side rules follow the text onto the second page.
    for (const fragment of fragments) expect(sides(fragment)).toContain('left');
  });

  test('w:bar draws its vertical rule beside the paragraph', () => {
    const layout = lay(
      paragraph('changed', '<w:pBdr><w:bar w:val="single" w:sz="8" w:space="2"/></w:pBdr>')
    );
    const fragment = paragraphsOf(layout)[0]!;
    expect(sides(fragment)).toEqual(['bar']);
    const bar = stroke(fragment, 'bar');
    const line = fragment.lines[0]!;
    expect(bar.box.x + bar.box.width).toBe(line.box.x - 2);
    expect(bar.box.height).toBe(line.box.height);
    // A bar is beside the text, not above or below it: no flow height of its own.
    expect(fragment.box.height).toBe(paragraphsOf(lay(paragraph('changed')))[0]!.box.height);
  });
});

describe('w:between groups consecutive paragraphs into one bordered block', () => {
  const grouped = (pBdr: string) =>
    paragraph('one', pBdr) + paragraph('two', pBdr) + paragraph('three', pBdr);

  const BETWEEN =
    '<w:pBdr>' +
    '<w:top w:val="single" w:sz="8" w:space="4"/>' +
    '<w:left w:val="single" w:sz="8" w:space="4"/>' +
    '<w:bottom w:val="single" w:sz="8" w:space="4"/>' +
    '<w:right w:val="single" w:sz="8" w:space="4"/>' +
    '<w:between w:val="single" w:sz="8" w:space="1"/>' +
    '</w:pBdr>';

  test('the frame opens above the first member and closes below the last', () => {
    const [first, middle, last] = paragraphsOf(lay(grouped(BETWEEN)));
    expect(sides(first!).sort()).toEqual(['between', 'left', 'right', 'top']);
    expect(sides(middle!).sort()).toEqual(['between', 'left', 'right']);
    expect(sides(last!).sort()).toEqual(['bottom', 'left', 'right']);
  });

  test('a between rule is not published as the bottom border', () => {
    const [first, , last] = paragraphsOf(lay(grouped(BETWEEN)));
    expect(first!.bottomBorder).toBeUndefined();
    expect(last!.bottomBorder).toBeDefined();
  });

  test('without w:between the interior boundaries carry no rule at all', () => {
    const [first, middle, last] = paragraphsOf(lay(grouped(BOX)));
    expect(sides(first!).sort()).toEqual(['left', 'right', 'top']);
    expect(sides(middle!).sort()).toEqual(['left', 'right']);
    expect(sides(last!).sort()).toEqual(['bottom', 'left', 'right']);
  });

  test('a differing border set breaks the group, so each paragraph closes itself', () => {
    const other = BOX.replace(/C00000/g, '0000FF');
    const [first, second] = paragraphsOf(lay(paragraph('one', BOX) + paragraph('two', other)));
    expect(sides(first!)).toContain('bottom');
    expect(sides(second!)).toContain('top');
  });

  test('an unbordered neighbour never groups', () => {
    const [first] = paragraphsOf(lay(paragraph('one') + paragraph('two')));
    expect(first!.borders).toBeUndefined();
    expect(paragraphBordersFingerprint({})).toBe('');
  });

  test('side rules run through the gap between members so the box reads as one outline', () => {
    const spaced = `<w:spacing w:after="200"/>${BETWEEN}`;
    const [first, second] = paragraphsOf(lay(paragraph('one', spaced) + paragraph('two', spaced)));
    const upper = stroke(first!, 'left');
    const lower = stroke(second!, 'left');
    expect(upper.box.y + upper.box.height).toBe(lower.box.y);
  });
});

describe('paint draws every published stroke and invents no geometry', () => {
  function painted(body: string): HTMLElement {
    const container = document.createElement('div');
    paintSemanticLayout(container, lay(body), { scale: 1 });
    return container;
  }

  test('a box paints four rules at the published boxes', () => {
    const layout = lay(paragraph('boxed', BOX));
    const fragment = paragraphsOf(layout)[0]!;
    const container = painted(paragraph('boxed', BOX));
    expect(container.querySelectorAll('.docx-paragraph-border')).toHaveLength(4);
    for (const side of ['top', 'left', 'bottom', 'right'] as const) {
      const rule = container.querySelector<HTMLElement>(`.docx-paragraph-border-${side}`)!;
      const published = stroke(fragment, side);
      expect(Number.parseFloat(rule.style.left)).toBe(published.box.x - fragment.box.x);
      expect(Number.parseFloat(rule.style.top)).toBe(published.box.y - fragment.box.y);
      expect(rule.style.width).toBe(`${published.box.width}px`);
      expect(rule.style.height).toBe(`${published.box.height}px`);
      expect(rule.style.backgroundColor.toLowerCase()).toBe('#c00000');
    }
  });

  test('a hostile colour on a non-bottom edge is refused at the sink too', () => {
    const container = painted(
      paragraph(
        'x',
        '<w:pBdr><w:left w:val="single" w:sz="8" w:color="javascript:alert(1)"/></w:pBdr>'
      )
    );
    const rule = container.querySelector<HTMLElement>('.docx-paragraph-border-left')!;
    expect(rule.style.backgroundColor.toLowerCase()).toBe('#000000');
    expect(rule.style.backgroundImage).toBe('');
  });

  test('a dashed side rule dashes DOWN the rule, not across it', () => {
    const container = painted(
      paragraph('x', '<w:pBdr><w:left w:val="dashed" w:sz="8" w:space="4"/></w:pBdr>')
    );
    const rule = container.querySelector<HTMLElement>('.docx-paragraph-border-left')!;
    expect(rule.style.backgroundImage).toContain('to bottom');
  });
});
