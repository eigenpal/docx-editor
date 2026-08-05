// The paragraph mark (`w:pPr/w:rPr`, CT_PPr / ECMA-376 17.3.1.29) sits on the last line of
// a paragraph and participates in that line's metrics. Cover pages often author a larger
// mark `w:sz` than the visible runs (e.g. 16pt mark, 10pt party name) — Word's line box
// follows max-ascent/max-descent across the mark, so the extra space lands ABOVE the text.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core-contract/store';
import { layoutSemanticDocument, linesOf, type TextMeasurer } from '../index.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Size-aware measurer so mark `w:sz` and run `w:sz` produce different line boxes. */
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
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const lay = (body: string) => layoutSemanticDocument(load(body), 1, { measurer });

describe('paragraph mark w:sz contributes to last-line height', () => {
  test('a taller mark grows a single-line paragraph past its run size', () => {
    const markTall = lay(
      '<w:p><w:pPr><w:rPr><w:sz w:val="32"/></w:rPr></w:pPr>' +
        '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>MERIDIAN</w:t></w:r></w:p>'
    );
    const plain = lay('<w:p><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>MERIDIAN</w:t></w:r></w:p>');
    // 16pt mark → 18.4; 10pt run alone → 11.5.
    expect(linesOf(markTall)[0]!.box.height).toBeCloseTo(16 * 1.15, 5);
    expect(linesOf(plain)[0]!.box.height).toBeCloseTo(10 * 1.15, 5);
  });

  test('taller mark pushes baseline down and publishes leading above the glyphs', () => {
    // Height-only growth (the first PR #140 attempt) left `leading` at 0, so paint kept the
    // 10pt glyphs at the top of an 18.4pt box and the gap appeared BELOW the party name —
    // "between" sat tight against "MERIDIAN". Word's max-ascent puts that gap ABOVE.
    const between =
      '<w:p><w:pPr><w:spacing w:before="202" w:line="460" w:lineRule="auto"/></w:pPr>' +
      '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>between</w:t></w:r></w:p>';
    const meridian =
      '<w:p><w:pPr><w:rPr><w:sz w:val="32"/></w:rPr></w:pPr>' +
      '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>MERIDIAN</w:t></w:r></w:p>';
    const layout = lay(between + meridian);
    const lines = linesOf(layout);
    const betweenLine = lines[0]!;
    const meridianLine = lines[1]!;

    const runH = 10 * 1.15;
    const runBaseline = 10 * 0.9;
    const markH = 16 * 1.15;
    const markBaseline = 16 * 0.9;

    expect(betweenLine.spans[0]!.text).toBe('between');
    expect(meridianLine.spans[0]!.text).toBe('MERIDIAN');

    // MERIDIAN owns the tall mark — height and ascent come from the mark, not the prior para.
    expect(meridianLine.box.height).toBeCloseTo(markH, 5);
    expect(meridianLine.baseline).toBeCloseTo(markBaseline, 5);
    expect(meridianLine.leading).toBeCloseTo(markBaseline - runBaseline, 5);
    // Paint pads `leading` above the run band; without this, height alone still clumps.
    expect(meridianLine.leading).toBeGreaterThan(runH * 0.2);
    expect(meridianLine.baseline).toBeGreaterThan(runBaseline + 1);

    // "between" is a separate paragraph: its own auto line box, no mark-driven leading.
    expect(betweenLine.box.height).toBeCloseTo(runH * (460 / 240), 5);
    expect(betweenLine.leading).toBeCloseTo(betweenLine.box.height - runH, 5);

    // Gap between the two line tops equals between's full box (mark height stays on MERIDIAN).
    expect(meridianLine.box.y - betweenLine.box.y).toBeCloseTo(betweenLine.box.height, 5);
    // Space ABOVE MERIDIAN's glyphs (= its leading) is the visible gap under "between".
    // A height-only fix left leading at 0, so this gap collapsed and the words clumped.
    const betweenBottom = betweenLine.box.y + betweenLine.box.height;
    const meridianGlyphTop = meridianLine.box.y + meridianLine.leading;
    expect(meridianGlyphTop - betweenBottom).toBeCloseTo(meridianLine.leading, 5);
    expect(meridianGlyphTop - betweenBottom).toBeGreaterThan(4);
  });

  test('only the last wrapped line inherits the tall mark', () => {
    const words = Array.from({ length: 40 }, (_, index) => `w${index}`).join(' ');
    const lines = linesOf(
      lay(
        '<w:p><w:pPr><w:rPr><w:sz w:val="32"/></w:rPr></w:pPr>' +
          `<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${words}</w:t></w:r></w:p>` +
          '<w:sectPr><w:pgSz w:w="3000" w:h="9000"/>' +
          '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200"/></w:sectPr>'
      )
    );
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines.slice(0, -1)) {
      expect(line.box.height).toBeCloseTo(10 * 1.15, 5);
      expect(line.leading).toBeCloseTo(0, 5);
    }
    const last = lines[lines.length - 1]!;
    expect(last.box.height).toBeCloseTo(16 * 1.15, 5);
    expect(last.leading).toBeCloseTo(16 * 0.9 - 10 * 0.9, 5);
  });

  test('an empty paragraph still uses the mark size for its placeholder line', () => {
    const lines = linesOf(lay('<w:p><w:pPr><w:rPr><w:sz w:val="32"/></w:rPr></w:pPr></w:p>'));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.box.height).toBeCloseTo(16 * 1.15, 5);
    // Empty line: the mark IS the glyph band, so mark growth adds no extra leading.
    expect(lines[0]!.leading).toBeCloseTo(0, 5);
  });

  test('paint pads mark leading above the party-name glyphs', () => {
    // IDE browser MCP was unavailable for the live 5190 check; pin the paint sink instead.
    // Height-only mark growth left paddingTop at 0 while the line box was 18.4pt tall.
    const layout = lay(
      '<w:p><w:pPr><w:rPr><w:sz w:val="32"/></w:rPr></w:pPr>' +
        '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>MERIDIAN</w:t></w:r></w:p>'
    );
    const line = linesOf(layout)[0]!;
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1 });
    const run = [...container.querySelectorAll<HTMLElement>('.layout-run-text')].find((el) =>
      (el.textContent ?? '').includes('MERIDIAN')
    );
    expect(run).toBeDefined();
    expect(parseFloat(run!.style.paddingTop)).toBeCloseTo(line.leading, 5);
    expect(parseFloat(run!.style.paddingTop)).toBeCloseTo(16 * 0.9 - 10 * 0.9, 5);
    expect(parseFloat(run!.style.paddingTop)).toBeGreaterThan(4);
  });
});
