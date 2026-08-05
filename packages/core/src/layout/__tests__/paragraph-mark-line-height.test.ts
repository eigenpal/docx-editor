// Cover-page vertical rhythm: auto line spacing extras sit BELOW each line (Word), and a
// taller paragraph mark grows the last line's box without pushing the glyph baseline down.
// The shapes-and-page-breaks title block is the oracle — the full inter-glyph gap sequence
// must match Word's arithmetic (not a single padding assertion).

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readOoxmlPart, readOoxmlPackage, type OoxmlPart } from '@docx-editor.dev/core-contract/store';
import {
  applyLineSpacing,
  buildStyleCascadeTable,
  layoutSemanticDocument,
  linesOf,
  type TextMeasurer,
} from '../index.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const OWNER = '/word/document.xml';

/** Size-aware metrics (~Arial): height ≈ 1.15em, baseline ≈ 0.9em. */
const measurer: TextMeasurer = {
  measure(text, style) {
    return text.length * style.fontSizePt * 0.5;
  },
  lineMetrics(style) {
    return { height: style.fontSizePt * 1.15, baseline: style.fontSizePt * 0.9 };
  },
};

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: OWNER,
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const lay = (body: string) => layoutSemanticDocument(load(body), 1, { measurer });

const RUN_H = 10 * 1.15;
const RUN_BL = 10 * 0.9;
const MARK_H = 16 * 1.15;
/** Auto 460/240 extras on a 10pt run line. */
const AUTO_460_EXTRA = RUN_H * (460 / 240) - RUN_H;
const MARK_EXTRA = MARK_H - RUN_H;

describe('auto line spacing and paragraph-mark height', () => {
  test('auto extras leave the baseline put (space falls below)', () => {
    expect(applyLineSpacing({ rule: 'auto', value: 460 }, RUN_H, RUN_BL)).toEqual({
      height: RUN_H * (460 / 240),
      baseline: RUN_BL,
    });
  });

  test('a taller mark grows height without raising leading above the glyphs', () => {
    const markTall = linesOf(
      lay(
        '<w:p><w:pPr><w:rPr><w:sz w:val="32"/></w:rPr></w:pPr>' +
          '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>MERIDIAN</w:t></w:r></w:p>'
      )
    )[0]!;
    expect(markTall.box.height).toBeCloseTo(MARK_H, 5);
    expect(markTall.baseline).toBeCloseTo(RUN_BL, 5);
    expect(markTall.leading).toBeCloseTo(0, 5);
  });

  test('title-block inter-glyph gaps match Word arithmetic line-by-line', () => {
    // Verbatim spacing from shapes-and-page-breaks.docx title region.
    // "as Borrower and" keeps the authored left/right indents so it wraps; every wrap line
    // must appear in the gap table (skipping a wrap line previously hid a 30pt false gap).
    const body =
      '<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:spacing w:before="182"/>' +
      '<w:jc w:val="center"/></w:pPr><w:r><w:t>LOAN FACILITY</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:spacing w:before="202" w:line="460" w:lineRule="auto"/>' +
      '<w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>between</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pStyle w:val="TableParagraph"/><w:rPr><w:sz w:val="32"/></w:rPr></w:pPr>' +
      '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>MERIDIAN HOLDINGS PLC</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:spacing w:before="22" w:line="460" w:lineRule="auto"/>' +
      '<w:ind w:left="4816" w:right="4838"/><w:jc w:val="center"/></w:pPr>' +
      '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>as Borrower and</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pStyle w:val="TableParagraph"/><w:rPr><w:sz w:val="32"/></w:rPr></w:pPr>' +
      '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>APEX CAPITAL PARTNERS LIMITED</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:spacing w:line="218" w:lineRule="exact"/>' +
      '<w:jc w:val="center"/></w:pPr><w:r><w:t>as Lender</w:t></w:r></w:p>' +
      '<w:sectPr><w:pgSz w:w="11900" w:h="16840"/>' +
      '<w:pgMar w:top="600" w:right="540" w:bottom="440" w:left="560"/></w:sectPr>';

    const styles = readOoxmlPart(
      `<w:styles xmlns:w="${W}">` +
        '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>' +
        '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/>' +
        '<w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="20"/></w:rPr></w:style>' +
        '<w:style w:type="paragraph" w:styleId="BodyText"><w:basedOn w:val="Normal"/>' +
        '<w:rPr><w:sz w:val="20"/></w:rPr></w:style>' +
        '<w:style w:type="paragraph" w:customStyle="1" w:styleId="TableParagraph">' +
        '<w:basedOn w:val="Normal"/></w:style></w:styles>',
      { name: '/word/styles.xml', contentType: 'app/xml' }
    );
    if (!styles.ok) throw new Error(styles.reason);
    const layout = layoutSemanticDocument(load(body), 1, {
      measurer,
      styleCascade: buildStyleCascadeTable(styles.part.root),
    });

    // First page body lines in order through "as Lender" — no regex that drops wrap lines.
    const focus: ReturnType<typeof linesOf> = [];
    for (const line of linesOf(layout)) {
      focus.push(line);
      const text = line.spans.map((span) => span.text).join('');
      if (text.includes('as Lender')) break;
    }
    expect(focus.length).toBeGreaterThanOrEqual(7);

    const glyphTop = (line: (typeof focus)[number]) => line.box.y + line.leading;
    const glyphBottom = (line: (typeof focus)[number]) => {
      const spanH = Math.max(0, ...line.spans.map((span) => span.box.height), RUN_H);
      return line.box.y + line.leading + spanH;
    };

    const labels = focus.map((line) => line.spans.map((span) => span.text).join(''));
    const gaps = focus.slice(0, -1).map((_, index) => glyphTop(focus[index + 1]!) - glyphBottom(focus[index]!));

    // Word expected with this measurer (auto/atLeast extras BELOW; mark deepens below):
    //   LOAN→between     = before 202twip = 10.1
    //   between→MERIDIAN = auto460 extra ≈ 10.5417
    //   MERIDIAN→(wrap0) = mark extra 6.9 + before 22twip 1.1 = 8.0
    //   wrap→wrap        = auto460 extra ≈ 10.5417 each
    //   last wrap→APEX   = auto460 extra ≈ 10.5417
    //   APEX→Lender      = mark extra 6.9
    // Rejected above-leading model produced ~20.6 then ~5.4 (clumps).
    expect(labels[0]).toContain('LOAN');
    expect(labels[1]).toContain('between');
    expect(labels[2]).toContain('MERIDIAN');
    expect(labels.at(-2)).toContain('APEX');
    expect(labels.at(-1)).toContain('Lender');

    const expected = [
      202 / 20, // LOAN → between
      AUTO_460_EXTRA, // between → MERIDIAN
      MARK_EXTRA + 22 / 20, // MERIDIAN → first wrap of "as Borrower and"
      ...Array.from({ length: gaps.length - 4 }, () => AUTO_460_EXTRA), // wraps + → APEX
      MARK_EXTRA, // APEX → as Lender
    ];
    expect(gaps.length).toBe(expected.length);
    for (let index = 0; index < gaps.length; index += 1) {
      expect(gaps[index]!).toBeCloseTo(expected[index]!, 1);
    }
    // Old bug: max/min ratio ~20.6/5.4 ≈ 3.8. Uniform band stays under 2.
    const max = Math.max(...gaps);
    const min = Math.min(...gaps);
    expect(max / min).toBeLessThan(2);
  });

  test('paint puts auto trailing depth in padding-bottom, not padding-top', () => {
    const layout = lay(
      '<w:p><w:pPr><w:spacing w:line="480" w:lineRule="auto"/></w:pPr>' +
        '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>between</w:t></w:r></w:p>'
    );
    const line = linesOf(layout)[0]!;
    expect(line.leading).toBeCloseTo(0, 5);
    expect(line.box.height).toBeCloseTo(RUN_H * 2, 5);
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1 });
    const painted = container.querySelector<HTMLElement>('.docx-line')!;
    const run = container.querySelector<HTMLElement>('.layout-run-text')!;
    expect(parseFloat(run.style.paddingTop)).toBeCloseTo(0, 5);
    expect(parseFloat(painted.style.paddingBottom)).toBeCloseTo(RUN_H, 5);
  });
});

describe('second case: BodyText line=336 extras stay below (same fixture family)', () => {
  test('definition-style auto-336 does not invert inter-line gaps', () => {
    // Independent of the cover: BodyText clauses in the same package use line=336.
    const layout = lay(
      '<w:p><w:pPr><w:pStyle w:val="BodyText"/>' +
        '<w:spacing w:before="210" w:line="336" w:lineRule="auto"/></w:pPr>' +
        '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>First definition line that is long enough to wrap onto a second line in this narrow column xx</w:t></w:r></w:p>' +
        '<w:sectPr><w:pgSz w:w="5000" w:h="16840"/>' +
        '<w:pgMar w:top="600" w:right="200" w:bottom="440" w:left="200"/></w:sectPr>'
    );
    const wrapped = linesOf(layout);
    expect(wrapped.length).toBeGreaterThan(1);
    for (const line of wrapped) {
      expect(line.leading).toBe(0);
      expect(line.box.height).toBeCloseTo(RUN_H * (336 / 240), 5);
    }
    const gap =
      wrapped[1]!.box.y + wrapped[1]!.leading - (wrapped[0]!.box.y + wrapped[0]!.leading + RUN_H);
    const extra336 = RUN_H * (336 / 240) - RUN_H;
    expect(gap).toBeCloseTo(extra336, 5);
  });
});

describe('real package smoke (optional geometry)', () => {
  test('pr140 fixture title lines expose below-band extras on line=460 paras', () => {
    const fixture = resolve(
      import.meta.dir,
      '../../../../../e2e/fixtures/pr140-shapes-and-page-breaks.docx'
    );
    const loaded = readOoxmlPackage(new Uint8Array(readFileSync(fixture)));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const cascade = buildStyleCascadeTable(loaded.package.parts.get('/word/styles.xml')!.root);
    const atoms = indexInlineDrawingProjectionsInPart(main);
    const ready = Object.freeze({
      kind: 'ready' as const,
      partName: '/word/media/image1.png',
      contentId: 'image1',
      resourceKey: 'k1',
      mime: 'image/png',
      pixelWidth: 100,
      pixelHeight: 100,
      dpiX: 96,
      dpiY: 96,
    });
    const layout = layoutSemanticDocument(main, 1, {
      measurer,
      styleCascade: cascade,
      inlineDrawingLayout: {
        ownerPartName: OWNER,
        projectionForAtom: (id) => atoms.get(id) ?? null,
        project: (node) =>
          atoms.get(node.id) ??
          projectDrawing(node, {
            ownerPartName: OWNER,
            limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
          }),
        resourceOf: () => ready,
      },
    });
    const between = linesOf(layout).find((line) =>
      line.spans.some((span) => span.text.includes('between'))
    );
    expect(between).toBeDefined();
    expect(between!.leading).toBeCloseTo(0, 5);
    expect(between!.box.height).toBeGreaterThan(between!.baseline + 2);
  });
});
