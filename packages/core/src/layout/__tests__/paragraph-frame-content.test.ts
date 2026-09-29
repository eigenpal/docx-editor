import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/index.ts';
import { indexInlineDrawingProjectionsInPart } from '../../store/package/drawing-projection.ts';
import {
  createFixedMeasurer,
  layoutSemanticDocument,
  createLayoutSession,
} from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';
import type { ParagraphFragmentRecord } from '../semantic-records.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const frame =
  'w:h="2000" w:hRule="exact" w:x="200" w:y="400" w:hAnchor="page" w:vAnchor="page" w:wrap="notBeside"';
function read(body: string, root = 'document') {
  const parsed = readOoxmlPart(
    `<w:${root} xmlns:w="${W}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${root === 'document' ? `<w:body>${body}</w:body>` : body}</w:${root}>`,
    { name: `/word/${root}.xml`, contentType: 'application/xml' }
  );
  if (!parsed.ok) throw Error(parsed.reason);
  return parsed.part;
}
const p = (text: string, props = '', extra = '') =>
  `<w:p><w:pPr><w:spacing w:line="200" w:lineRule="exact" w:before="0" w:after="0"/>${props}</w:pPr><w:r><w:t>${text}</w:t>${extra}</w:r></w:p>`;
const options = {
  measurer: createFixedMeasurer(6, 10),
  geometry: { width: 200, height: 250, margin: { top: 10, right: 10, bottom: 10, left: 10 } },
};
const paras = (layout: ReturnType<typeof layoutSemanticDocument>) =>
  layout.pages
    .flatMap((p) => p.fragments)
    .filter((f): f is ParagraphFragmentRecord => f.kind === 'paragraph');

test('partial direct frame properties inherit anchors and group with equivalent direct properties', () => {
  const styleCascade = buildStyleCascadeTable(
    read(
      `<w:style w:type="paragraph" w:styleId="Frame"><w:pPr><w:framePr ${frame} w:w="1000"/></w:pPr></w:style>`,
      'styles'
    ).root
  );
  const part = read(
    p('first', `<w:framePr ${frame} w:w="1600"/>`) +
      p('second', '<w:pStyle w:val="Frame"/><w:framePr w:w="1600"/>') +
      p('body')
  );
  const before = serializeOoxmlPart(part);
  const [first, second] = paras(layoutSemanticDocument(part, 0, { ...options, styleCascade }));
  expect(first!.positionedFrame!.groupId).toBe(second!.positionedFrame!.groupId);
  expect(first!.positionedFrame!.box.width).toBe(80);
  expect(second!.lines[0]!.box.y).toBe(first!.lines[0]!.box.y + 10);
  expect(serializeOoxmlPart(part)).toBe(before);
});

for (const width of ['', ' w:w="2400"']) {
  test(`inline pictures remain inside the shared frame with ${width ? 'fixed' : 'automatic'} width`, () => {
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache();
    for (const [revision, imageWidth] of [40, 60, 30].entries()) {
      const picture = `<w:pict><v:shape id="picture" style="width:${imageWidth}pt;height:150pt"><v:imagedata r:id="rId1"/></v:shape></w:pict>`;
      const props = `<w:framePr ${frame.replace('w:y="400"', 'w:y="200"')}${width}/><w:jc w:val="center"/>`;
      const part = read(
        p('heading', props) +
          p('', props + '<w:spacing w:line="240" w:lineRule="auto"/>', picture) +
          p('body')
      );
      const before = serializeOoxmlPart(part);
      const atoms = indexInlineDrawingProjectionsInPart(part);
      const inlineDrawingLayout: InlineDrawingLayoutContext = {
        ownerPartName: part.name,
        projectionForAtom: (id) => atoms.get(id) ?? null,
        project: (node) => atoms.get(node.id) ?? null,
        resourceOf: () => ({
          kind: 'ready',
          partName: '/word/media/image.png',
          contentId: 'image',
          resourceKey: 'image',
          mime: 'image/png',
          pixelWidth: 60,
          pixelHeight: 30,
          dpiX: 72,
          dpiY: 72,
        }),
      };
      const args = { ...options, inlineDrawingLayout };
      const layout = layoutSemanticDocument(part, revision, { ...args, session, cache });
      expect(layout.pages).toEqual(layoutSemanticDocument(part, revision, args).pages);
      const [heading, image, body] = paras(layout);
      const box = heading!.positionedFrame!.box;
      expect(image!.positionedFrame!.groupId).toBe(heading!.positionedFrame!.groupId);
      const drawing = image!.lines.flatMap((line) => line.drawings ?? [])[0]!;
      expect(drawing.height).toBe(150);
      expect(drawing.paintBounds.y + drawing.paintBounds.height).toBeLessThanOrEqual(
        box.y + box.height
      );
      expect(drawing.hitBounds.y + drawing.hitBounds.height).toBeLessThanOrEqual(
        box.y + box.height
      );
      expect(drawing.x).toBeCloseTo(box.x + (box.width - imageWidth) / 2, 3);
      expect(drawing.y).toBeGreaterThanOrEqual(heading!.lines[0]!.box.y + 10);
      expect(body!.lines[0]!.box.y).toBeGreaterThanOrEqual(box.y + box.height);
      expect(serializeOoxmlPart(part)).toBe(before);
    }
  });
}
