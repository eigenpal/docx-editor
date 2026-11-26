// The text descent on a line that holds an inline object.
//
// An inline object (`wp:inline`, CT_Inline, ECMA-376 20.4.2.8) affects its line "like a
// character glyph of similar size": it sits on the baseline. The text on the line keeps its
// descent below that baseline, wherever the object is on the line. An object alone on its line
// has no text below it, unless its run is underlined (`w:u`, CT_Underline, 17.3.2.40).

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { indexInlineDrawingProjectionsInPart } from '../../store/package/drawing-projection.ts';
import type { OoxmlPart } from '@docx-editor.dev/core/store';
import {
  buildStyleCascadeTable,
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
  type LayoutSession,
  type SemanticLayout,
} from '../index.ts';
import { linesOf, type LineRecord } from '../semantic-records.ts';
import { caretAt } from '../semantic-interaction.ts';
import { selectionRects } from '../selection-rects.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const DML = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS = `xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${DML}" xmlns:pic="${PIC}" xmlns:r="${REL}"`;

// The default 10pt text has a line of 140/11 pt with its baseline at 80% of it.
const measurer = createFixedMeasurer(6, 14);
const LINE = 140 / 11;
const ASCENT = LINE * 0.8;
const DESCENT = LINE - ASCENT;
const resource = Object.freeze({
  kind: 'ready' as const,
  partName: '/word/media/example.png',
  contentId: 'example',
  resourceKey: 'example',
  mime: 'image/png',
  pixelWidth: 80,
  pixelHeight: 40,
  dpiX: 96,
  dpiY: 96,
});

let pictureId = 0;
/** A run that holds an inline picture 60pt wide and `height` points tall. */
function picture(height: number, rPr = ''): string {
  pictureId += 1;
  const cx = 60 * 12700;
  const cy = height * 12700;
  return (
    `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${pictureId}" name="p"/><wp:cNvGraphicFramePr/>` +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${pictureId}" name="p"/>` +
    '<pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="example"/></pic:blipFill><pic:spPr>' +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/>` +
    '</a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
  );
}

/** An inline picture too wide to share a line with another picture. */
const wide = (height: number) => picture(height).replace(/cx="762000"/g, 'cx="5715000"');

const text = (value: string) => `<w:r><w:t xml:space="preserve">${value}</w:t></w:r>`;
const paragraph = (content: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${content}</w:p>`;

function load(body: string): OoxmlPart {
  const parsed = readOoxmlPart(`<w:document ${NS}><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!parsed.ok) throw Error(parsed.reason);
  return parsed.part;
}

function drawingLayout(owner: OoxmlPart): InlineDrawingLayoutContext {
  const projections = indexInlineDrawingProjectionsInPart(owner);
  return {
    ownerPartName: owner.name,
    projectionForAtom: (id) => projections.get(id) ?? null,
    project: (node) => projections.get(node.id) ?? null,
    resourceOf: () => resource,
  };
}

function lay(part: OoxmlPart, revision = 1, session?: LayoutSession): SemanticLayout {
  return layoutSemanticDocument(part, revision, {
    measurer,
    geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    inlineDrawingLayout: drawingLayout(part),
    ...(session ? { session } : {}),
  });
}

/** The first line of a body that holds `content` in one paragraph. */
function firstLine(content: string, pPr = ''): LineRecord {
  return linesOf(lay(load(paragraph(content, pPr))))[0]!;
}

describe('a taller inline object after text keeps the text descent', () => {
  test('the object as the last item of the line', () => {
    const line = firstLine(text('In ') + picture(30));
    expect(line.baseline).toBeCloseTo(30, 6);
    expect(line.box.height).toBeCloseTo(30 + DESCENT, 6);
    // The object stays on the baseline.
    const drawing = line.drawings![0]!;
    expect(drawing.y + drawing.height).toBeCloseTo(line.baseline, 6);
  });

  test('the same line height wherever the object is on the line', () => {
    const last = firstLine(text('In ') + picture(30));
    const first = firstLine(picture(30) + text(' after'));
    const middle = firstLine(text('In ') + picture(30) + text(' after'));
    expect(first.box.height).toBeCloseTo(last.box.height, 6);
    expect(middle.box.height).toBeCloseTo(last.box.height, 6);
    expect(first.baseline).toBeCloseTo(last.baseline, 6);
  });

  test('an object between the text ascent and the text line height', () => {
    // 12pt is above the text ascent and below the text line height.
    const line = firstLine(text('In ') + picture(12));
    expect(line.baseline).toBeCloseTo(12, 6);
    expect(line.box.height).toBeCloseTo(12 + DESCENT, 6);
  });

  test('a raised or lowered object gives the same line before and after the text', () => {
    for (const position of ['12', '-12']) {
      const rPr = `<w:position w:val="${position}"/>`;
      const last = firstLine(text('In ') + picture(30, rPr));
      const first = firstLine(picture(30, rPr) + text('In '));
      expect(last.box.height).toBeCloseTo(first.box.height, 6);
      expect(last.baseline).toBeCloseTo(first.baseline, 6);
    }
  });

  test('spacing below single gives the same line before and after the text', () => {
    const pPr = '<w:spacing w:line="200" w:lineRule="auto"/>';
    const last = firstLine(text('In ') + picture(30), pPr);
    const first = firstLine(picture(30) + text('In '), pPr);
    expect(last.box.height).toBeCloseTo(first.box.height, 6);
    expect(last.box.height).toBeCloseTo(30 + DESCENT - LINE / 6, 6);
  });

  test('several objects after the text', () => {
    const line = firstLine(text('In ') + picture(20) + picture(30));
    expect(line.box.height).toBeCloseTo(30 + DESCENT, 6);
  });

  test('minimum line spacing keeps the descent', () => {
    const line = firstLine(
      text('In ') + picture(30),
      '<w:spacing w:line="240" w:lineRule="atLeast"/>'
    );
    expect(line.box.height).toBeCloseTo(30 + DESCENT, 6);
  });

  test('a multiple adds its share of the text band below the descent', () => {
    const line = firstLine(
      text('In ') + picture(30),
      '<w:spacing w:line="360" w:lineRule="auto"/>'
    );
    expect(line.box.height).toBeCloseTo(30 + DESCENT + LINE * 0.5, 6);
  });
});

describe('lines that hold no text descent', () => {
  test('an object alone on its line', () => {
    const line = firstLine(picture(30));
    expect(line.box.height).toBeCloseTo(30, 6);
  });

  test('several objects alone on their line, in any order', () => {
    // A short first object opens the line with the text box of its run. That box is not text.
    for (const content of [
      picture(6) + picture(30),
      picture(30) + picture(6),
      picture(12) + picture(30),
    ])
      expect(firstLine(content).box.height).toBeCloseTo(30, 6);
    expect(firstLine(text('  ') + picture(6) + picture(30)).box.height).toBeCloseTo(30, 6);
  });

  test('an object that wraps to its own line after text', () => {
    const lines = linesOf(lay(load(paragraph(text('In the text ') + wide(30)))));
    expect(lines).toHaveLength(2);
    expect(lines[1]!.box.height).toBeCloseTo(30, 6);
  });

  test('an object after whitespace only', () => {
    expect(firstLine(text('   ') + picture(30)).box.height).toBeCloseTo(30, 6);
  });

  test('an object shorter than the text ascent', () => {
    const line = firstLine(text('In ') + picture(6));
    expect(line.box.height).toBeCloseTo(LINE, 6);
    expect(line.baseline).toBeCloseTo(ASCENT, 6);
  });

  test('exact line spacing keeps the authored height', () => {
    const line = firstLine(
      text('In ') + picture(30),
      '<w:spacing w:line="280" w:lineRule="exact"/>'
    );
    expect(line.box.height).toBeCloseTo(14, 6);
  });
});

describe('an underlined inline object keeps the descent of its run', () => {
  test('an underlined object alone on its line', () => {
    const line = firstLine(picture(30, '<w:u w:val="single"/>'));
    expect(line.baseline).toBeCloseTo(30, 6);
    expect(line.box.height).toBeCloseTo(30 + DESCENT, 6);
  });

  test('the descent follows the font size of the run', () => {
    const line = firstLine(picture(40, '<w:sz w:val="44"/><w:u w:val="double"/>'));
    expect(line.box.height).toBeCloseTo(40 + 2.2 * DESCENT, 6);
  });

  test('an underlined object and a plain object, in any order', () => {
    const underlined = picture(6, '<w:u w:val="single"/>');
    expect(firstLine(underlined + picture(30)).box.height).toBeCloseTo(30 + DESCENT, 6);
    expect(firstLine(picture(30) + underlined).box.height).toBeCloseTo(30 + DESCENT, 6);
  });

  test('the underline descent ends with its line', () => {
    // The 450pt object wraps to a second line: no underlined object is on that line.
    const lines = linesOf(lay(load(paragraph(picture(30, '<w:u w:val="single"/>') + wide(30)))));
    expect(lines).toHaveLength(2);
    expect(lines[0]!.box.height).toBeCloseTo(30 + DESCENT, 6);
    expect(lines[1]!.box.height).toBeCloseTo(30, 6);
  });

  test('an object in a hyperlink with an underlined character style', () => {
    const styles = readOoxmlPart(
      `<w:styles xmlns:w="${WML_NAMESPACE_URI}"><w:style w:type="character" w:styleId="Link">` +
        '<w:name w:val="Hyperlink"/><w:rPr><w:u w:val="single"/></w:rPr></w:style></w:styles>',
      { name: '/word/styles.xml', contentType: 'application/xml' }
    );
    if (!styles.ok) throw Error(styles.reason);
    const heightOf = (rPr: string): number => {
      const part = load(paragraph(`<w:hyperlink w:anchor="top">${picture(30, rPr)}</w:hyperlink>`));
      const layout = layoutSemanticDocument(part, 1, {
        measurer,
        geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
        inlineDrawingLayout: drawingLayout(part),
        styleCascade: buildStyleCascadeTable(styles.part.root),
      });
      return linesOf(layout)[0]!.box.height;
    };
    // The same line without the style has no descent.
    const descent = heightOf('<w:rStyle w:val="Link"/>') - heightOf('');
    expect(descent).toBeGreaterThan(1);
    expect(heightOf('<w:rStyle w:val="Link"/><w:u w:val="none"/>')).toBeCloseTo(heightOf(''), 6);
  });

  test('an underline switched off holds no descent', () => {
    expect(firstLine(picture(30, '<w:u w:val="none"/>')).box.height).toBeCloseTo(30, 6);
  });

  test('an underline on the paragraph mark alone holds no descent', () => {
    const line = firstLine(picture(30), '<w:rPr><w:u w:val="single"/></w:rPr>');
    expect(line.box.height).toBeCloseTo(30, 6);
  });
});

describe('editing on a line that ends with an inline object', () => {
  const body = (word: string) =>
    paragraph(text('Before')) + paragraph(text(word) + picture(30)) + paragraph(text('After'));

  test('the caret after the object spans the line, and the next line follows it', () => {
    const layout = lay(load(body('In ')));
    const [, line, next] = linesOf(layout);
    const paragraphId = line!.range.paragraphId;
    const end = caretAt(layout, { paragraphId, offset: line!.range.end }, measurer)!;
    expect(end.lineId).toBe(line!.id);
    expect(end.y).toBeGreaterThanOrEqual(line!.box.y - 1e-6);
    expect(end.y + end.height).toBeLessThanOrEqual(line!.box.y + line!.box.height + 1e-6);
    // The caret stands after the object, not before it.
    const drawing = line!.drawings![0]!;
    expect(end.x).toBeGreaterThanOrEqual(drawing.advanceEnd - 1e-6);
    // The caret in the text stands on the shared baseline.
    const start = caretAt(layout, { paragraphId, offset: line!.range.start }, measurer)!;
    expect(start.y + start.height).toBeCloseTo(line!.box.y + line!.baseline + DESCENT, 6);
    expect(next!.box.y).toBeCloseTo(line!.box.y + line!.box.height, 6);
  });

  test('the selection of the line stays inside the line box', () => {
    const layout = lay(load(body('In ')));
    const line = linesOf(layout)[1]!;
    const paragraphId = line.range.paragraphId;
    const order = linesOf(layout).map((entry) => entry.range.paragraphId);
    const rects = selectionRects(
      layout,
      {
        anchor: { paragraphId, offset: line.range.start },
        head: { paragraphId, offset: line.range.end },
      },
      order,
      measurer
    );
    expect(rects.length).toBeGreaterThan(0);
    for (const rect of rects) {
      expect(rect.y).toBeGreaterThanOrEqual(line.box.y - 1e-6);
      expect(rect.y + rect.height).toBeLessThanOrEqual(line.box.y + line.box.height + 1e-6);
    }
  });

  const shapeOf = (layout: SemanticLayout): string =>
    JSON.stringify(
      linesOf(layout).map((line) => ({
        box: line.box,
        baseline: line.baseline,
        spans: line.spans.map((span) => [span.text, span.box]),
        drawings: (line.drawings ?? []).map((drawing) => [drawing.x, drawing.y, drawing.height]),
      }))
    );

  test('typing beside the object gives the layout of a full pass', () => {
    const session = createLayoutSession();
    lay(load(body('In ')), 1, session);
    for (const [revision, word] of [
      [2, 'Inside '],
      [3, ''],
      [4, 'In '],
    ] as const) {
      const edited = load(body(word));
      expect(shapeOf(lay(edited, revision, session))).toBe(shapeOf(lay(edited, revision)));
    }
    // Text typed after the object keeps the line height: the descent is already there.
    const after = load(
      paragraph(text('Before')) +
        paragraph(text('In ') + picture(30) + text(' x')) +
        paragraph(text('After'))
    );
    const typed = lay(after, 5, session);
    expect(shapeOf(typed)).toBe(shapeOf(lay(after, 5)));
    expect(linesOf(typed)[1]!.box.height).toBeCloseTo(30 + DESCENT, 6);
  });
});
