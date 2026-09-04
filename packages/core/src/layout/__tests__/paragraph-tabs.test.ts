// OOXML paragraph tab-stop layout — shared paragraph-flow feature.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildNumberingIndex,
  buildStyleCascadeTable,
  createFixedMeasurer,
  defaultTabIntervalFromSettings,
  enumerateDocumentSections,
  geometryOfSection,
  layoutHeaderFooterStory,
  layoutSemanticDocument,
  linesOf,
  MAX_TAB_STOPS,
  paragraphFragmentsOf,
  paragraphTabStops,
} from '../index.ts';
import { elevenPointDefaults } from './fixtures/eleven-point-defaults.ts';
import {
  readOoxmlPackage,
  readOoxmlPart,
  resolveHeaderFooterPartsBySection,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  cascadedTabStops,
  EMPTY_TAB_STOPS,
  nextTabDestination,
  tabAdvanceWidth,
  withHangingIndentTabStop,
} from '../paragraph-tabs.ts';
import { cascadeParagraphFormatting } from '../style-cascade.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:a="${A}"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function loadStyles(inner: string) {
  const result = readOoxmlPart(`<w:styles xmlns:w="${W}">${inner}</w:styles>`, {
    name: '/word/styles.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part.root;
}

const measurer = createFixedMeasurer(6, 14);
const lay = (part: OoxmlPart) =>
  layoutSemanticDocument(part, 1, { measurer, styleCascade: elevenPointDefaults() });

const FIXTURE = resolve(
  import.meta.dir,
  '../../../../../e2e/fixtures/comprehensive-word-element-test.docx'
);

describe('paragraphTabStops sanitises authored stops', () => {
  test('reads left/center/right/decimal and drops hostile values', () => {
    const part = load(
      `<w:p><w:pPr><w:tabs>` +
        `<w:tab w:val="left" w:pos="720"/>` +
        `<w:tab w:val="center" w:pos="1440"/>` +
        `<w:tab w:val="right" w:pos="2880"/>` +
        `<w:tab w:val="decimal" w:pos="3600"/>` +
        `<w:tab w:val="bar" w:pos="4000"/>` +
        `<w:tab w:val="left" w:pos="not-a-number"/>` +
        `<w:tab w:val="left" w:pos="-100"/>` +
        `<w:tab w:val="left" w:pos="999999999"/>` +
        `</w:tabs></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`
    );
    const pPr = part.root.children[0]!.children[0]!.children[0]!;
    const tabs = paragraphTabStops(pPr);
    expect(tabs.stops.map((s) => [s.alignment, s.positionPt])).toEqual([
      ['left', 36],
      ['center', 72],
      ['right', 144],
      ['decimal', 180],
      ['left', 31680 / 20], // clamped ceiling
    ]);
  });

  test('caps stop count', () => {
    const stops = Array.from(
      { length: MAX_TAB_STOPS + 40 },
      (_, i) => `<w:tab w:val="left" w:pos="${(i + 1) * 20}"/>`
    ).join('');
    const part = load(`<w:p><w:pPr><w:tabs>${stops}</w:tabs></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`);
    const pPr = part.root.children[0]!.children[0]!.children[0]!;
    expect(paragraphTabStops(pPr).stops.length).toBeLessThanOrEqual(MAX_TAB_STOPS);
  });

  test('clear removes an inherited stop during cascade', () => {
    const table = buildStyleCascadeTable(
      loadStyles(
        `<w:style w:type="paragraph" w:styleId="T">` +
          `<w:pPr><w:tabs>` +
          `<w:tab w:val="left" w:pos="720"/>` +
          `<w:tab w:val="right" w:pos="2880"/>` +
          `</w:tabs></w:pPr></w:style>`
      )
    );
    const part = load(
      `<w:p><w:pPr><w:pStyle w:val="T"/><w:tabs>` +
        `<w:tab w:val="clear" w:pos="720"/>` +
        `</w:tabs></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`
    );
    const pPr = part.root.children[0]!.children[0]!.children[0]!;
    const cascaded = cascadeParagraphFormatting(table, pPr);
    const tabs = cascadedTabStops(cascaded.paragraphPropertyNodes);
    expect(tabs.stops).toEqual([{ alignment: 'right', positionPt: 144 }]);
  });
});

describe('tabAdvanceWidth / nextTabDestination', () => {
  test('default interval advances when no custom stop remains', () => {
    const dest = nextTabDestination({ stops: [], defaultIntervalPt: 36 }, 10, 500);
    expect(dest).toEqual({ positionPt: 36, alignment: 'left' });
  });

  test('right and center account for the following segment', () => {
    expect(tabAdvanceWidth('right', 20, 100, 30, 30)).toBe(50);
    expect(tabAdvanceWidth('center', 20, 100, 40, 40)).toBe(60);
    expect(tabAdvanceWidth('left', 20, 100, 40, 40)).toBe(80);
    expect(tabAdvanceWidth('decimal', 20, 100, 40, 25)).toBe(55);
  });
});

describe('breakParagraph tab-stop geometry', () => {
  test('left tab jumps to the stop from the content origin', () => {
    // 720 twips = 36pt. "Hi" is 12pt at 6pt/char; tab should land at 36.
    const part = load(
      `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>` +
        `<w:r><w:t>Hi</w:t><w:tab/><w:t>X</w:t></w:r></w:p>`
    );
    const [line] = linesOf(lay(part));
    const tab = line!.spans.find((span) => span.text === '\t')!;
    const after = line!.spans[line!.spans.indexOf(tab) + 1]!;
    expect(tab.box.x).toBe(12);
    expect(tab.box.width).toBe(24);
    expect(after.box.x).toBe(36);
    expect(after.text).toBe('X');
  });

  test('right tab sizes from the measured following segment', () => {
    // Stop at 120pt; "ABCD" is 24pt → tab ends so text ends at 120.
    const part = load(
      `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="2400"/></w:tabs></w:pPr>` +
        `<w:r><w:t>L</w:t><w:tab/><w:t>ABCD</w:t></w:r></w:p>`
    );
    const [line] = linesOf(lay(part));
    const tab = line!.spans.find((span) => span.text === '\t')!;
    const after = line!.spans[line!.spans.indexOf(tab) + 1]!;
    expect(after.box.x + after.box.width).toBeCloseTo(120, 5);
    expect(tab.box.width).toBeGreaterThan(6); // not a narrow character
  });

  test('center tab centers the following segment on the stop', () => {
    const part = load(
      `<w:p><w:pPr><w:tabs><w:tab w:val="center" w:pos="2400"/></w:tabs></w:pPr>` +
        `<w:r><w:tab/><w:t>ABCD</w:t></w:r></w:p>`
    );
    const [line] = linesOf(lay(part));
    const after = line!.spans.find((span) => span.text === 'ABCD')!;
    expect(after.box.x + after.box.width / 2).toBeCloseTo(120, 5);
  });

  test('default tab interval applies with no custom stops', () => {
    // Default 36pt. "Hi"(12) → next default stop at 36.
    const part = load(`<w:p><w:r><w:t>Hi</w:t><w:tab/><w:t>Z</w:t></w:r></w:p>`);
    const [line] = linesOf(lay(part));
    const after = line!.spans.find((span) => span.text === 'Z')!;
    expect(after.box.x).toBe(36);
  });

  test('literal tab in w:t is handled like w:tab', () => {
    const part = load(
      `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>` +
        `<w:r><w:t xml:space="preserve">A\tB</w:t></w:r></w:p>`
    );
    const [line] = linesOf(lay(part));
    expect(line!.spans.map((s) => s.text)).toEqual(['A', '\t', 'B']);
    expect(line!.spans[2]!.box.x).toBe(36);
  });

  test('left indent is respected; stops stay relative to content origin', () => {
    // Indent 36pt; left tab at 72pt from content origin → after "A"(6) tab lands at 72.
    const part = load(
      `<w:p><w:pPr><w:ind w:left="720"/><w:tabs><w:tab w:val="left" w:pos="1440"/></w:tabs></w:pPr>` +
        `<w:r><w:t>A</w:t><w:tab/><w:t>B</w:t></w:r></w:p>`
    );
    const [line] = linesOf(lay(part));
    const after = line!.spans.find((span) => span.text === 'B')!;
    expect(after.box.x).toBe(72);
  });

  test('mixed run styles still measure the following segment', () => {
    // Right stop 120pt; "AB"(12 at 6pt) + bold "CD" still 12 → segment 24.
    const part = load(
      `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="2400"/></w:tabs></w:pPr>` +
        `<w:r><w:tab/></w:r>` +
        `<w:r><w:t>AB</w:t></w:r>` +
        `<w:r><w:rPr><w:b/></w:rPr><w:t>CD</w:t></w:r></w:p>`
    );
    const [line] = linesOf(lay(part));
    const last = line!.spans[line!.spans.length - 1]!;
    expect(last.box.x + last.box.width).toBeCloseTo(120, 5);
  });

  test('ordinary paragraphs without tabs keep prior geometry', () => {
    const part = load(`<w:p><w:r><w:t>abc</w:t></w:r><w:r><w:t>de</w:t></w:r></w:p>`);
    const [line] = linesOf(lay(part));
    expect(line!.spans[0]!.box.x).toBe(0);
    expect(line!.spans[1]!.box.x).toBe(18);
    expect(line!.spans.map((s) => s.text)).toEqual(['abc', 'de']);
  });

  test('source ranges stay contiguous across a tab', () => {
    const part = load(
      `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>` +
        `<w:r><w:t>Hi</w:t><w:tab/><w:t>X</w:t></w:r></w:p>`
    );
    const [line] = linesOf(lay(part));
    expect(line!.spans.map((s) => [s.range.start, s.range.end, s.text])).toEqual([
      [0, 2, 'Hi'],
      [2, 3, '\t'],
      [3, 4, 'X'],
    ]);
  });
});

describe('shared flow: comprehensive fixture HF right-tab evidence', () => {
  test('footer1 right tab lands following text on the authored stop', () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const sections = enumerateDocumentSections(part);
    const bySection = resolveHeaderFooterPartsBySection(loaded.package);
    // Section 0 is cover (no HF); section 1 carries footer1 with a right tab at 9026 twips.
    const footer = bySection[1]?.footers.get('default');
    expect(footer).toBeDefined();
    const geometry = geometryOfSection(sections[1]!.properties);
    const contentWidth = geometry.width - geometry.margin.left - geometry.margin.right;
    const story = layoutHeaderFooterStory(footer!, contentWidth, measurer, 'test');

    const spans = story.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph' ? fragment.lines.flatMap((line) => line.spans) : []
    );
    const tabIndex = spans.findIndex((span) => span.text === '\t');
    expect(tabIndex).toBeGreaterThanOrEqual(0);
    const tab = spans[tabIndex]!;
    expect(tab.box.width).toBeGreaterThan(6);

    // Following spans until end of line (no further tab) should end at the stop (9026/20).
    let endX = tab.box.x + tab.box.width;
    for (let index = tabIndex + 1; index < spans.length; index += 1) {
      const span = spans[index]!;
      if (span.text === '\t') break;
      endX = span.box.x + span.box.width;
    }
    expect(endX).toBeCloseTo(9026 / 20, 5);
  });
});

describe('page layout regression with tabs present', () => {
  test('a multi-paragraph body still paginates and keeps non-tab lines flush left', () => {
    const body =
      Array.from({ length: 8 }, (_, i) => `<w:p><w:r><w:t>line ${i} plain</w:t></w:r></w:p>`).join(
        ''
      ) +
      `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="2400"/></w:tabs></w:pPr>` +
      `<w:r><w:t>L</w:t><w:tab/><w:t>R</w:t></w:r></w:p>`;
    const layout = layoutSemanticDocument(load(body), 1, {
      measurer,
      geometry: {
        width: 200,
        height: 100,
        margin: { top: 10, right: 10, bottom: 10, left: 10 },
      },
    });
    expect(layout.pages.length).toBeGreaterThan(1);
    const plain = linesOf(layout).find((line) => line.spans.some((s) => s.text.includes('plain')));
    expect(plain!.spans[0]!.box.x).toBe(0);
  });
});

describe('a trailing tab ends its line rather than starting one', () => {
  // Word treats a tab with nothing after it like a trailing space: it does not wrap. The
  // shape this protects is the ordinary header line — `LEFT<tab><tab>RIGHT<tab><tab>` —
  // where wrapping on each trailing tab added a line per tab. In a header that also moves
  // the BODY, because a header's flow height sets the effective top margin.
  // 80pt of content width against the default 36pt tab grid: the third tab is already past
  // the right edge, so the wrap rule is genuinely reached rather than merely stated.
  const narrow = {
    width: 100,
    height: 400,
    margin: { top: 10, right: 10, bottom: 10, left: 10 },
  };

  test('tabs past the right edge with no text after them add no lines', () => {
    const part = load(`<w:p><w:r><w:t>LEFT</w:t><w:tab/><w:tab/><w:tab/><w:tab/></w:r></w:p>`);
    const layout = layoutSemanticDocument(part, 1, { measurer, geometry: narrow });
    expect(linesOf(layout)).toHaveLength(1);
  });

  test('a tab that still has text after it wraps as before', () => {
    // The same shape with content after the tabs keeps Word's wrap rule, so the
    // trailing-tab exception cannot be mistaken for "tabs never wrap".
    const part = load(
      `<w:p><w:r><w:t>LEFT</w:t><w:tab/><w:tab/><w:tab/><w:t>AFTER</w:t></w:r></w:p>`
    );
    const layout = layoutSemanticDocument(part, 1, { measurer, geometry: narrow });
    expect(linesOf(layout).length).toBeGreaterThan(1);
  });

  test('trailing tabs after the last word add no lines of their own', () => {
    const part = load(
      `<w:p><w:r><w:t>LEFT</w:t><w:tab/><w:t>RIGHT</w:t><w:tab/><w:tab/><w:tab/></w:r></w:p>`
    );
    const layout = layoutSemanticDocument(part, 1, { measurer, geometry: narrow });
    const lines = linesOf(layout);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.spans.some((span) => span.text === 'RIGHT')).toBe(true);
  });
});

describe('a hanging indent is an implicit left tab on the first line', () => {
  // EP_ZMVZ_MULTI_v4: `w:ind w:left="1701" w:hanging="1701"`, no `w:tabs`, default grid 708 twips.
  const INDENT_TWIPS = 1701;
  const INDENT_PT = INDENT_TWIPS / 20;
  const METRIC_INTERVAL_PT = 708 / 20;
  const ZMVZ = resolve(import.meta.dir, '../../../../../e2e/fixtures/EP_ZMVZ_MULTI_v4.docx');

  const hang = (inner: string, tabsXml = '') =>
    `<w:p><w:pPr><w:ind w:left="${INDENT_TWIPS}" w:hanging="${INDENT_TWIPS}"/>${tabsXml}</w:pPr>` +
    `<w:r>${inner}</w:r></w:p>`;

  const layHang = (body: string, defaultTabStopPt?: number) =>
    layoutSemanticDocument(load(body), 1, {
      measurer,
      styleCascade: elevenPointDefaults(),
      ...(defaultTabStopPt !== undefined ? { defaultTabStopPt } : {}),
    });

  const afterTab = (line: ReturnType<typeof linesOf>[number], text: string) =>
    line.spans.find((span) => span.text === text)!;

  test('the helper inserts a left stop at indentLeft and leaves authored stops in front', () => {
    const earlier = { positionPt: 36, alignment: 'left' as const };
    const tabs = { stops: [earlier], defaultIntervalPt: 36 };
    const merged = withHangingIndentTabStop(tabs, INDENT_PT, -INDENT_PT);
    expect(merged.stops.map((stop) => [stop.alignment, stop.positionPt])).toEqual([
      ['left', 36],
      ['left', INDENT_PT],
    ]);
    expect(nextTabDestination(merged, 0, 500).positionPt).toBe(36);
    expect(nextTabDestination(merged, 40, 500).positionPt).toBe(INDENT_PT);
  });

  test('an explicit stop at the indent keeps its alignment and leader', () => {
    const authored = {
      stops: [{ positionPt: INDENT_PT, alignment: 'right' as const, leader: 'dot' as const }],
      defaultIntervalPt: 36,
    };
    expect(withHangingIndentTabStop(authored, INDENT_PT, -INDENT_PT)).toBe(authored);
    expect(nextTabDestination(authored, 0, 500)).toEqual({
      positionPt: INDENT_PT,
      alignment: 'right',
      leader: 'dot',
    });
  });

  test('a caret at the indent continues to the next default stop', () => {
    const tabs = withHangingIndentTabStop(EMPTY_TAB_STOPS, INDENT_PT, -INDENT_PT);
    expect(nextTabDestination(tabs, 0, 500).positionPt).toBe(INDENT_PT);
    expect(nextTabDestination(tabs, INDENT_PT, 500).positionPt).toBe(108);
  });

  test('the 1701-twip hanging indent sends the value to 85.05pt, not the default grid', () => {
    const [line] = linesOf(
      layHang(hang('<w:t>Miesto:</w:t><w:tab/><w:t>VALUE</w:t>'), METRIC_INTERVAL_PT)
    );
    expect(afterTab(line!, 'VALUE').box.x).toBeCloseTo(INDENT_PT, 5);
    expect(afterTab(line!, 'VALUE').box.x).not.toBeCloseTo(METRIC_INTERVAL_PT * 2, 5);
  });

  test('an earlier explicit stop still wins', () => {
    const [line] = linesOf(
      layHang(
        hang(
          '<w:t>Hi</w:t><w:tab/><w:t>X</w:t>',
          '<w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs>'
        )
      )
    );
    expect(afterTab(line!, 'X').box.x).toBe(36);
  });

  test('an explicit stop at the indent keeps right alignment and its leader', () => {
    const [line] = linesOf(
      layHang(
        hang(
          '<w:t>Hi</w:t><w:tab/><w:t>ABCD</w:t>',
          `<w:tabs><w:tab w:val="right" w:pos="${INDENT_TWIPS}" w:leader="dot"/></w:tabs>`
        )
      )
    );
    const tab = line!.spans.find((span) => span.text === '\t')!;
    const value = afterTab(line!, 'ABCD');
    expect(tab.tabLeader).toBe('dot');
    expect(value.box.x + value.box.width).toBeCloseTo(INDENT_PT, 5);
  });

  test('a caret past the hanging indent continues to the next default stop', () => {
    // 15 glyphs at 6pt = 90pt, which is already past 85.05.
    const [line] = linesOf(layHang(hang('<w:t>abcdefghijklmno</w:t><w:tab/><w:t>X</w:t>')));
    expect(afterTab(line!, 'X').box.x).toBe(108);
  });

  test('a continuation line starts at the indent and is not trapped there', () => {
    const lines = linesOf(
      layHang(hang('<w:t>Hi</w:t><w:tab/><w:t>VALUE</w:t><w:br/><w:tab/><w:t>Y</w:t>'))
    );
    expect(lines).toHaveLength(2);
    expect(afterTab(lines[0]!, 'VALUE').box.x).toBeCloseTo(INDENT_PT, 5);
    expect(lines[1]!.spans[0]!.box.x).toBeCloseTo(INDENT_PT, 5);
    expect(afterTab(lines[1]!, 'Y').box.x).toBe(108);
  });

  test('a positional tab still uses its own destination', () => {
    const fragment = paragraphFragmentsOf(
      layHang(
        hang(
          '<w:t>Hi</w:t><w:ptab w:alignment="right" w:relativeTo="margin" w:leader="dot"/><w:t>7</w:t>'
        )
      ).pages[0]!
    )[0]!;
    const last = fragment.lines[0]!.spans[fragment.lines[0]!.spans.length - 1]!;
    expect(last.text).toBe('7');
    expect(Math.round(last.box.x + last.box.width)).toBe(
      Math.round(fragment.box.x + fragment.box.width)
    );
    expect(last.box.x).not.toBeCloseTo(INDENT_PT, 1);
  });

  test('EP_ZMVZ_MULTI_v4 sends the Miesto value to the hanging indent', () => {
    const bytes = new Uint8Array(readFileSync(ZMVZ));
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const numbering = loaded.package.parts.get('/word/numbering.xml');
    const styles = loaded.package.parts.get('/word/styles.xml');
    const settings = loaded.package.parts.get('/word/settings.xml');
    const layout = layoutSemanticDocument(main, 1, {
      measurer,
      numberingIndex: buildNumberingIndex(numbering?.root ?? null),
      styleCascade: buildStyleCascadeTable(styles?.root ?? null),
      defaultTabStopPt: defaultTabIntervalFromSettings(settings?.root),
    });
    const fragment = layout.pages
      .flatMap((page) => paragraphFragmentsOf(page))
      .find((entry) =>
        entry.lines.some((line) => line.spans.some((span) => span.text.includes('Miesto')))
      );
    expect(fragment).toBeDefined();
    const line = fragment!.lines[0]!;
    const tab = line.spans.find((span) => span.text === '\t')!;
    const value = line.spans[line.spans.indexOf(tab) + 1]!;
    expect(value.text).toContain('sídlo');
    expect(value.box.x).toBeCloseTo(INDENT_PT, 2);
  });
});
