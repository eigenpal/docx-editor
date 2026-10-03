// Floating shapes and text-box stories through the automation host (issue #1070).
//
// A text box is a story of its own: its paragraphs, text, search and edits go through the same
// operations as any body, reached through `getShapes` and `getShapeBody`. The anchoring paragraph
// keeps its own text, and an edit inside the box saves to both its DrawingML and VML copies.

import { describe, expect, test } from 'bun:test';
import {
  docx,
  errorAt,
  handleAt,
  handlesAt,
  open,
  paragraphTexts,
  refusal,
  roots,
  savedMainXml,
  spansAt,
  storyText,
} from './support/protocol.ts';
import type { AutomationHandle, AutomationHost } from '../protocol.ts';
import type { AutomationOperation } from '../operations.ts';

const DRAWING_NS =
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml"';

function anchor(id: number, name: string, graphic: string): string {
  return (
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" ' +
    'behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="2743200" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    `<wp:wrapSquare wrapText="bothSides"/><wp:docPr id="${id}" name="${name}"/>` +
    `<wp:cNvGraphicFramePr/><a:graphic>${graphic}</a:graphic></wp:anchor>`
  );
}

function textbox(
  id: number,
  text: string,
  { requires = 'wps', flag = ' txBox="1"' }: { requires?: string; flag?: string } = {}
): string {
  const story = `<w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:txbxContent>`;
  const graphic =
    '<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
    `<wps:wsp><wps:cNvSpPr${flag}/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2743200" ` +
    'cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    `<wps:txbx>${story}</wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData>`;
  return (
    `<w:r><mc:AlternateContent ${DRAWING_NS} xmlns:x99="urn:example:unsupported">` +
    `<mc:Choice Requires="${requires}"><w:drawing>` +
    `${anchor(id, `Text Box ${id}`, graphic)}</w:drawing></mc:Choice><mc:Fallback><w:pict>` +
    `<v:shape id="Text Box ${id}" type="#_x0000_t202" style="width:3in;height:36pt"><v:textbox>` +
    `${story}</v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r>`
  );
}

function rectangle(id: number): string {
  const graphic =
    '<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
    '<wps:wsp><wps:cNvSpPr/><wps:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    '</wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData>';
  return `<w:r><w:drawing ${DRAWING_NS}>${anchor(id, `Rectangle ${id}`, graphic)}</w:drawing></w:r>`;
}

function host(): AutomationHost {
  return open(
    docx(
      `<w:p><w:r><w:t>Cover</w:t></w:r>${textbox(1, 'Client: Acme Holdings')}</w:p>` +
        `<w:p><w:r><w:t>Terms</w:t></w:r>${rectangle(2)}${textbox(3, 'Ref 7')}</w:p>`
    )
  );
}

function shapesOf(
  target: AutomationHost,
  span: { body: AutomationHandle } | { paragraph: AutomationHandle }
) {
  return handlesAt(target.execute({ operations: [{ op: 'getShapes', span }] }), 0);
}

function decide(
  op: 'acceptAllRevisions' | 'rejectAllRevisions',
  body: AutomationHandle
): AutomationOperation {
  return op === 'acceptAllRevisions' ? { op, body } : { op, body };
}

function shapeRead(target: AutomationHost, shape: AutomationHandle) {
  const response = target.execute({ operations: [{ op: 'getShape', shape }] });
  const result = response.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'shape') throw new Error('no shape read');
  return result.value.shape;
}

describe('shapes and text-box stories', () => {
  test('a body lists its floating shapes with id, name and type', () => {
    const target = host();
    const { body } = roots(target);
    const shapes = shapesOf(target, { body });
    expect(shapes.map((shape) => shapeRead(target, shape))).toEqual([
      { id: 1, name: 'Text Box 1', type: 'TextBox' },
      { id: 2, name: 'Rectangle 2', type: 'GeometricShape' },
      { id: 3, name: 'Text Box 3', type: 'TextBox' },
    ]);
  });

  test('a paragraph lists only the shapes it anchors', () => {
    const target = host();
    const { body } = roots(target);
    const paragraphs = handlesAt(
      target.execute({ operations: [{ op: 'getParagraphs', body }] }),
      0
    );
    expect(
      shapesOf(target, { paragraph: paragraphs[0]! }).map((s) => shapeRead(target, s).id)
    ).toEqual([1]);
    expect(
      shapesOf(target, { paragraph: paragraphs[1]! }).map((s) => shapeRead(target, s).id)
    ).toEqual([2, 3]);
  });

  test('a text box body reads, searches and edits its own story', () => {
    const target = host();
    const { body } = roots(target);
    const [box] = shapesOf(target, { body });
    const boxBody = handleAt(
      target.execute({ operations: [{ op: 'getShapeBody', shape: box! }] }),
      0
    );
    expect(paragraphTexts(target, boxBody)).toEqual(['Client: Acme Holdings']);
    expect(storyText(target, boxBody)).toBe('Client: Acme Holdings');
    // The main body search stays in the main story, and the box answers its own.
    expect(
      spansAt(target.execute({ operations: [{ op: 'search', scope: { body }, text: 'Acme' }] }), 0)
    ).toHaveLength(0);
    const [match] = spansAt(
      target.execute({
        operations: [{ op: 'search', scope: { body: boxBody }, text: 'Acme Holdings' }],
      }),
      0
    );
    const replaced = target.execute({
      operations: [{ op: 'replaceSpan', span: match!, text: 'Beta Logistics' }],
    });
    expect(replaced.results[0]?.status).toBe('ok');
    expect(storyText(target, boxBody)).toBe('Client: Beta Logistics');
    const xml = savedMainXml(target);
    expect(xml.match(/Beta Logistics/g)).toHaveLength(2);
    expect(xml).not.toContain('Acme');
  });

  test('a shape without text has no body', () => {
    const target = host();
    const { body } = roots(target);
    const [, rectangleShape] = shapesOf(target, { body });
    expect(
      errorAt(target.execute({ operations: [{ op: 'getShapeBody', shape: rectangleShape! }] }), 0)
    ).toBe('unsupported-content');
  });

  test('a geometric shape with text is not a text box but has a body', () => {
    const target = open(docx(`<w:p>${textbox(4, 'Label', { flag: '' })}</w:p>`));
    const { body } = roots(target);
    const [shape] = shapesOf(target, { body });
    expect(shapeRead(target, shape!)).toEqual({
      id: 4,
      name: 'Text Box 4',
      type: 'GeometricShape',
    });
    const story = handleAt(
      target.execute({ operations: [{ op: 'getShapeBody', shape: shape! }] }),
      0
    );
    expect(storyText(target, story)).toBe('Label');
  });

  test('a shape id takes the whole unsigned 32-bit range', () => {
    const target = open(docx(`<w:p>${textbox(4294967295, 'Wide')}</w:p>`));
    const { body } = roots(target);
    const [shape] = shapesOf(target, { body });
    expect(shapeRead(target, shape!).id).toBe(4294967295);
  });

  test('a box whose DrawingML branch is not selected is not listed', () => {
    // `Requires` names a namespace this engine does not support, so the VML fallback is painted.
    const target = open(docx(`<w:p>${textbox(6, 'Legacy', { requires: 'x99' })}</w:p>`));
    const { body } = roots(target);
    expect(shapesOf(target, { body })).toHaveLength(0);
  });

  test('a paragraph in a text box resolves to the text box story', () => {
    const target = host();
    const { body } = roots(target);
    const [box] = shapesOf(target, { body });
    const boxBody = handleAt(
      target.execute({ operations: [{ op: 'getShapeBody', shape: box! }] }),
      0
    );
    const [paragraph] = handlesAt(
      target.execute({ operations: [{ op: 'getParagraphs', body: boxBody }] }),
      0
    );
    // A paragraph handle edits its own story: the box changes, the anchoring paragraph does not.
    const inserted = target.execute({
      operations: [
        { op: 'insertParagraph', anchor: { paragraph: paragraph! }, where: 'after', text: 'Two' },
      ],
    });
    expect(inserted.results[0]?.status).toBe('ok');
    expect(paragraphTexts(target, boxBody)).toEqual(['Client: Acme Holdings', 'Two']);
    expect(paragraphTexts(target, body)).toEqual(['Cover', 'Terms']);
  });

  test('a search match never spans a floating shape', () => {
    const target = open(
      docx(`<w:p><w:r><w:t>ab</w:t></w:r>${textbox(1, 'x')}<w:r><w:t>cd</w:t></w:r></w:p>`)
    );
    const { body } = roots(target);
    const find = (text: string) =>
      spansAt(target.execute({ operations: [{ op: 'search', scope: { body }, text }] }), 0);
    // A match across the anchor would select the shape, and a replace would delete it.
    expect(find('abcd')).toHaveLength(0);
    expect(find('ab')).toHaveLength(1);
    expect(find('cd')).toHaveLength(1);
    expect(paragraphTexts(target, body)).toEqual(['abcd']);
  });

  test('a text box lists and decides its own tracked changes', () => {
    for (const op of ['acceptAllRevisions', 'rejectAllRevisions'] as const) {
      const target = host();
      const { body } = roots(target);
      const [box] = shapesOf(target, { body });
      const boxBody = handleAt(
        target.execute({ operations: [{ op: 'getShapeBody', shape: box! }] }),
        0
      );
      target.execute({
        operations: [{ op: 'setChangeTrackingMode', mode: 'TrackMineOnly', author: 'Reviewer' }],
      });
      const [match] = spansAt(
        target.execute({ operations: [{ op: 'search', scope: { body: boxBody }, text: 'Acme' }] }),
        0
      );
      expect(
        target.execute({ operations: [{ op: 'replaceSpan', span: match!, text: 'Beta' }] })
          .results[0]?.status
      ).toBe('ok');
      const revisions = (story: AutomationHandle) =>
        handlesAt(target.execute({ operations: [{ op: 'getRevisions', body: story }] }), 0);
      expect(revisions(body)).toHaveLength(0);
      expect(revisions(boxBody).length).toBeGreaterThan(0);
      expect(target.execute({ operations: [decide(op, boxBody)] }).results[0]?.status).toBe('ok');
      expect(revisions(boxBody)).toHaveLength(0);
      expect(storyText(target, boxBody)).toBe(
        op === 'acceptAllRevisions' ? 'Client: Beta Holdings' : 'Client: Acme Holdings'
      );
    }
  });

  test('the owner story decides its own changes and leaves its text boxes alone', () => {
    const insertion = (id: number, text: string) =>
      `<w:ins w:id="${id}" w:author="A" w:date="2024-01-01T00:00:00Z"><w:r><w:t>${text}</w:t></w:r></w:ins>`;
    for (const op of ['acceptAllRevisions', 'rejectAllRevisions'] as const) {
      const target = open(docx(`<w:p>${insertion(1, 'Lead')}${textbox(2, 'Boxed')}</w:p>`));
      const { body } = roots(target);
      const [box] = shapesOf(target, { body });
      const boxBody = handleAt(
        target.execute({ operations: [{ op: 'getShapeBody', shape: box! }] }),
        0
      );
      // The box's own story holds a tracked insertion of its own.
      const [boxParagraph] = handlesAt(
        target.execute({ operations: [{ op: 'getParagraphs', body: boxBody }] }),
        0
      );
      target.execute({
        operations: [{ op: 'setChangeTrackingMode', mode: 'TrackMineOnly', author: 'Reviewer' }],
      });
      target.execute({
        operations: [
          {
            op: 'insertParagraph',
            anchor: { paragraph: boxParagraph! },
            where: 'after',
            text: 'More',
          },
        ],
      });
      target.execute({ operations: [{ op: 'setChangeTrackingMode', mode: 'Off' }] });
      const count = (story: AutomationHandle) =>
        handlesAt(target.execute({ operations: [{ op: 'getRevisions', body: story }] }), 0).length;
      expect(count(body)).toBe(1);
      const boxBefore = count(boxBody);
      expect(boxBefore).toBeGreaterThan(0);
      expect(target.execute({ operations: [decide(op, body)] }).results[0]?.status).toBe('ok');
      expect(count(body)).toBe(0);
      expect(count(boxBody)).toBe(boxBefore);
      expect(paragraphTexts(target, boxBody)).toEqual(['Boxed', 'More']);
    }
  });

  test('duplicate shape ids make the story’s shapes unaddressable', () => {
    const target = open(docx(`<w:p>${textbox(5, 'one')}</w:p><w:p>${textbox(5, 'two')}</w:p>`));
    const { body } = roots(target);
    expect(refusal(target.execute({ operations: [{ op: 'getShapes', span: { body } }] }))).toBe(
      'ambiguous-document'
    );
  });
});
