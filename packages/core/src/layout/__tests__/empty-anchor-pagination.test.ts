import { describe, expect, test } from 'bun:test';
import { WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import { layoutContext, load, squareAnchorAtLeft } from './anchored-drawing-test-fixtures.ts';

const emu = (pt: number) => String(pt * 12700);
function anchor(y: number, height: number, frame = 'page', width = 550) {
  const xml = squareAnchorAtLeft({ text: '' });
  return xml
    .slice(xml.indexOf('<w:r>'), xml.indexOf('</wp:anchor>') + '</wp:anchor>'.length)
    .concat('</w:drawing></w:r>')
    .replaceAll('1828800', emu(width))
    .replaceAll('914400', emu(height))
    .replace('relativeFrom="column"', 'relativeFrom="margin"')
    .replace(
      '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0',
      `<wp:positionV relativeFrom="${frame}"><wp:posOffset>${emu(y)}`
    );
}
function textbox(y: number, height: number, frame = 'page') {
  return anchor(y, height, frame).replace(
    /<a:graphic>.*<\/a:graphic>/,
    '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
      '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:prstGeom prst="rect"/></wps:spPr>' +
      '<wps:txbx><w:txbxContent><w:p><w:r><w:t>Box content</w:t></w:r></w:p></w:txbxContent></wps:txbx>' +
      '<wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>'
  );
}
const document = (body: string) => `<w:document xmlns:w="${WML_NAMESPACE_URI}"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
 xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
 <w:body>${body}</w:body></w:document>`;
const text = (value: string) => `<w:p><w:r><w:t>${value}</w:t></w:r></w:p>`;
function render(
  body: string,
  session?: ReturnType<typeof createLayoutSession>,
  revision = 1,
  compatibilityMode: number | undefined = 15
) {
  const part = load(document(body));
  return layoutSemanticDocument(part, revision, {
    compatibilityMode,
    measurer: createFixedMeasurer(6, 14),
    inlineDrawingLayout: layoutContext(part),
    session,
  });
}
const body = (title: string) =>
  text(title) +
  `<w:p>${textbox(180, 580)}${textbox(24, 100, 'paragraph')}</w:p>` +
  `<w:p>${textbox(80, 320)}</w:p>`;
const summary = (layout: ReturnType<typeof render>) =>
  layout.pages.map((page) => ({
    paragraphs: paragraphFragmentsOf(page).map((p) => ({
      y: p.box.y,
      text: p.lines.flatMap((l) => l.spans.map((s) => s.text)).join(''),
    })),
    drawings: page.anchoredDrawings?.map((d) => [d.x, d.y, d.width, d.height]) ?? [],
  }));

describe('empty anchor paragraph pagination', () => {
  test('assigns anchor pages before later page bands wrap earlier text', () => {
    const layout = render(body('Heading'));
    expect(layout.pages).toHaveLength(2);
    expect(paragraphFragmentsOf(layout.pages[0]!)[0]!.box.y).toBe(0);
    expect(layout.pages.map((p) => p.anchoredDrawings?.length ?? 0)).toEqual([2, 1]);
    expect(layout.pages[1]!.anchoredDrawings![0]!.y).toBe(8);
    expect(layout.pages[1]!.anchoredDrawings![0]!.textboxStory?.fragments).toHaveLength(1);
  });
  test('legacy modes retain backward wrapping of fixed anchor bands', () => {
    for (const mode of [11, 12, 14, undefined]) {
      const part = load(document(body('Heading')));
      const layout = layoutSemanticDocument(part, 1, {
        measurer: createFixedMeasurer(6, 14),
        inlineDrawingLayout: layoutContext(part),
        compatibilityMode: mode,
      });
      expect(layout.pages[0]!.anchoredDrawings?.length ?? 0).toBe(0);
    }
    expect(render(body('Heading'), undefined, 1, 16).pages[0]!.anchoredDrawings).toHaveLength(2);
  });
  test('retained layout agrees with fresh layout after heading edits', () => {
    const session = createLayoutSession();
    render(body('Heading'), session);
    expect(summary(render(body('Changed heading'), session, 2))).toEqual(
      summary(render(body('Changed heading')))
    );
  });
  test('a paragraph with multiple anchors clears a preceding full-width rectangle', () => {
    const layout = render(
      `<w:p>${anchor(72, 100)}</w:p><w:p>${anchor(300, 100)}${anchor(450, 100)}</w:p>`
    );
    expect(paragraphFragmentsOf(layout.pages[0]!)[1]!.box.y).toBe(100);
  });
  test('paragraph-relative anchors follow inherited rectangular clearance', () => {
    const layout = render(
      `<w:p>${anchor(72, 100)}</w:p><w:p>${anchor(0, 80, 'paragraph')}${anchor(380, 80)}</w:p>`
    );
    const paragraph = paragraphFragmentsOf(layout.pages[0]!)[1]!;
    const following = layout.pages[0]!.anchoredDrawings!.find(
      (drawing) =>
        drawing.anchorParagraphId === paragraph.paragraphId &&
        drawing.height === 80 &&
        drawing.y < 300
    )!;
    expect(paragraph.box.y).toBe(100);
    expect(following.y).toBe(paragraph.box.y);
  });
  test('a plain empty paragraph does not add clearance without an anchor', () => {
    const layout = render(`<w:p>${anchor(72, 100)}</w:p><w:p/>`);
    const first = paragraphFragmentsOf(layout.pages[0]!)[0]!;
    expect(paragraphFragmentsOf(layout.pages[0]!)[1]!.box.y).toBe(first.box.height);
  });
  test('an empty paragraph can stay beside a narrow rectangle', () => {
    const layout = render(`<w:p>${anchor(72, 100, 'page', 100)}</w:p><w:p/>`);
    const first = paragraphFragmentsOf(layout.pages[0]!)[0]!;
    expect(paragraphFragmentsOf(layout.pages[0]!)[1]!.box.y).toBe(first.box.height);
  });
  test('a paragraph mark does not move its own square-wrapped anchor', () => {
    const layout = render(`<w:p>${anchor(0, 100, 'paragraph')}</w:p>`);
    expect(paragraphFragmentsOf(layout.pages[0]!)[0]!.box.y).toBe(0);
    expect(layout.pages[0]!.anchoredDrawings![0]!.y).toBe(0);
  });
});
