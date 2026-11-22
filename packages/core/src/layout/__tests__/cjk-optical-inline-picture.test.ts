import { expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { indexInlineDrawingProjectionsInPart } from '../../store/package/drawing-projection.ts';
import type { OoxmlPart } from '@docx-editor.dev/core/store';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { NO_THEME_FONTS } from '../run-style.ts';
import { linesOf, type TextMeasurer } from '../semantic-records.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';

// Full-width advances, with blank sides on the full stop and the comma.
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const DML = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS = `xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${DML}" xmlns:pic="${PIC}" xmlns:r="${REL}"`;
const measurer: TextMeasurer = {
  measure: (text, style) =>
    [...text].length * style.fontSizePt + text.length * style.characterSpacingPt,
  inkBounds: (text, style) =>
    text === '。' || text === '，'
      ? { left: 0.14 * style.fontSizePt, right: 0.36 * style.fontSizePt }
      : { left: 0.05 * style.fontSizePt, right: 0.95 * style.fontSizePt },
  lineMetrics: () => ({ height: 16, baseline: 12 }),
  hasResolvedFont: () => true,
};
const resource = Object.freeze({
  kind: 'ready' as const,
  partName: '/word/media/example.png',
  contentId: 'example',
  resourceKey: 'example',
  mime: 'image/png',
  pixelWidth: 12,
  pixelHeight: 10,
  dpiX: 96,
  dpiY: 96,
});
const picture =
  '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
  '<wp:extent cx="152400" cy="127000"/><wp:docPr id="1" name="p"/><wp:cNvGraphicFramePr/>' +
  `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="p"/>` +
  '<pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="example"/></pic:blipFill><pic:spPr>' +
  '<a:xfrm><a:off x="0" y="0"/><a:ext cx="152400" cy="127000"/></a:xfrm><a:prstGeom prst="rect">' +
  '<a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';

function part(name: string, xml: string): OoxmlPart {
  const parsed = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!parsed.ok) throw Error(parsed.reason);
  return parsed.part;
}
const styles = part(
  '/word/styles.xml',
  `<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="Test CJK"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
);
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

/** The first line of 12pt `甲。乙，`, a 12pt picture, and ideographs, at a text measure of `width`. */
function firstLine(width: number, mode?: 15, body?: string, extraSettings = '') {
  const compat = mode
    ? `<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="${mode}"/></w:compat>`
    : '';
  const settings = part(
    '/word/settings.xml',
    `<w:settings ${NS}><w:characterSpacingControl w:val="compressPunctuation"/>${extraSettings}${compat}</w:settings>`
  );
  const doc = part(
    '/word/document.xml',
    `<w:document ${NS}><w:body><w:p><w:pPr><w:jc w:val="both"/></w:pPr>${body ?? run('甲。乙，') + picture + run('丙丁戊己庚辛壬癸')}</w:p></w:body></w:document>`
  );
  const projections = indexInlineDrawingProjectionsInPart(doc);
  const inlineDrawingLayout: InlineDrawingLayoutContext = {
    ownerPartName: doc.name,
    projectionForAtom: (id) => projections.get(id) ?? null,
    project: (node) => projections.get(node.id) ?? null,
    resourceOf: () => resource,
  };
  const layout = layoutSemanticDocument(doc, 0, {
    measurer,
    styleCascade: buildStyleCascadeTable(
      styles.root,
      { ...NO_THEME_FONTS, eastAsianFontTableFaces: ['test cjk'] },
      settings.root
    ),
    geometry: {
      width: width + 20,
      height: 2000,
      margin: { top: 10, bottom: 10, left: 10, right: 10 },
    },
    inlineDrawingLayout,
    ...(mode ? { compatibilityMode: mode } : {}),
  });
  const line = linesOf(layout)[0]!;
  return { text: line.spans.map((span) => span.text).join(''), line };
}

test('punctuation before an inline picture compresses, and the picture moves with it', () => {
  // 8pt short: the line fits only when the full stop and the comma give their blank sides.
  const { text, line } = firstLine(64, 15);
  expect(text).toBe('甲。乙，丙');
  const drawing = line.drawings![0]!;
  const comma = line.spans.find((span) => span.text.endsWith('，'))!;
  const after = line.spans.find((span) => span.text.startsWith('丙'))!;
  expect(drawing.advanceEnd - drawing.advanceStart).toBeCloseTo(12, 8);
  expect(drawing.advanceStart).toBeCloseTo(comma.box.x + comma.box.width, 8);
  expect(drawing.paintBounds.x).toBeCloseTo(drawing.advanceStart, 8);
  expect(drawing.advanceStart).toBeLessThan(48);
  expect(after.box.x).toBeCloseTo(drawing.advanceEnd, 8);
  expect(after.box.x + after.box.width).toBeCloseTo(64, 8);
});

test('without a declared mode the picture line takes an ideograph within half its advance', () => {
  expect(firstLine(64).text).toBe('甲。乙，');
  expect(firstLine(66).text).toBe('甲。乙，丙');
  expect(firstLine(65.9).text).toBe('甲。乙，');
});

/** Each picture's advance, and the x where the text after it starts. */
function placed(line: ReturnType<typeof firstLine>['line']) {
  return line.drawings!.map((drawing) => {
    const before = line.spans.filter((span) => span.range.end <= drawing.start).at(-1);
    const after = line.spans.find((span) => span.range.start > drawing.start);
    return {
      width: drawing.advanceEnd - drawing.advanceStart,
      start:
        drawing.advanceStart - (before ? before.box.x + before.box.width : drawing.advanceStart),
      end: (after?.box.x ?? drawing.advanceEnd) - drawing.advanceEnd,
    };
  });
}

test('pictures between the text and the next glyph, or between seams, keep their advances', () => {
  const tail = run('丁戊己庚辛壬癸');
  // A picture just before the glyph that joins the line.
  const last = firstLine(76, 15, run('甲。乙，丙') + picture + tail);
  expect(last.text).toBe('甲。乙，丙丁');
  expect(placed(last.line)).toEqual([{ width: 12, start: 0, end: 0 }]);
  // Two pictures, each after a compressed mark.
  const two = firstLine(76, 15, run('甲。') + picture + run('乙，') + picture + run('丙') + tail);
  expect(two.text).toBe('甲。乙，丙');
  expect(placed(two.line)).toEqual([
    { width: 12, start: 0, end: 0 },
    { width: 12, start: 0, end: 0 },
  ]);
  for (const { line } of [last, two]) {
    const end = line.spans.at(-1)!;
    expect(end.box.x + end.box.width).toBeCloseTo(76, 8);
  }
});

test('a picture before the first text keeps its place while the text fits', () => {
  const { text, line } = firstLine(64, 15, picture + run('甲。乙，丙丁戊己庚辛壬癸'));
  expect(text).toBe('甲。乙，丙');
  expect(line.drawings![0]!.advanceStart).toBe(0);
  expect(line.spans[0]!.box.x).toBeCloseTo(12, 8);
});

test('a picture paragraph follows the mixed-line rules, so punctuation kerning off wraps it', () => {
  expect(firstLine(64, 15, undefined, '<w:noPunctuationKerning/>').text).toBe('甲。乙，');
});
