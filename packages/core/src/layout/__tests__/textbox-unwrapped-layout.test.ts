// Unwrapped text boxes (`wps:bodyPr wrap="none"`): each paragraph stays on one line, the box
// takes the width of its widest line plus the insets, and placement resolves at that width.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import {
  createFixedMeasurer,
  layoutSemanticDocument,
  type AnchoredDrawingRecord,
  type SemanticLayout,
} from '../index.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';
import { paragraphFragmentsOfBlocks } from '../semantic-record-queries.ts';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const NS = `xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}"`;

const measurer = createFixedMeasurer(6, 14);
// The fixed measurer's 6pt advance, scaled from 11pt to the 10pt default run size.
const CHAR = 60 / 11;
const EMU_PER_PT = 12_700;
const PAGE_WIDTH = 612;
const MARGIN = 72;
const NO_WRAP = '<wps:bodyPr wrap="none"><a:spAutoFit/></wps:bodyPr>';
const OFFSET_H = `<wp:positionH relativeFrom="page"><wp:posOffset>${250 * EMU_PER_PT}</wp:posOffset></wp:positionH>`;

const para = (text: string, jc?: string) =>
  `<w:p>${jc ? `<w:pPr><w:jc w:val="${jc}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

/** An anchored, wrap-none text box 10pt wide unless `widthPt` says otherwise. */
function textbox(
  content: string,
  options: {
    readonly bodyPr?: string;
    readonly widthPt?: number;
    readonly positionH?: string;
    readonly fill?: string;
  } = {}
): string {
  const cx = (options.widthPt ?? 10) * EMU_PER_PT;
  const cy = 50 * EMU_PER_PT;
  const fill = options.fill ? `<a:solidFill><a:srgbClr val="${options.fill}"/></a:solidFill>` : '';
  return (
    '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0"' +
    ' relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    (options.positionH ?? OFFSET_H) +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${100 * EMU_PER_PT}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
    '<wp:docPr id="1" name="TB"/>' +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp>` +
    `<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}</wps:spPr>` +
    `<wps:txbx><w:txbxContent>${content}</w:txbxContent></wps:txbx>` +
    (options.bodyPr ?? NO_WRAP) +
    '</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'
  );
}

function documentPart(drawing: string): OoxmlPart {
  const doc = readOoxmlPart(
    `<w:document ${NS}><w:body><w:p>${drawing}<w:r><w:t>Anchor</w:t></w:r></w:p>` +
      `<w:sectPr><w:pgSz w:w="${PAGE_WIDTH * 20}" w:h="15840"/>` +
      `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>` +
      '</w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!doc.ok) throw new Error(doc.reason);
  return doc.part;
}

function drawingLayoutFor(part: OoxmlPart): InlineDrawingLayoutContext {
  const atomProjections = indexInlineDrawingProjectionsInPart(part);
  return {
    ownerPartName: part.name,
    projectionForAtom: (atomId) => atomProjections.get(atomId) ?? null,
    project: (node) =>
      atomProjections.get(node.id) ??
      projectDrawing(node, { ownerPartName: part.name, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () =>
      Object.freeze({
        kind: 'unrenderable' as const,
        partName: null,
        mime: 'unknown' as const,
        reason: 'unsupported-format' as const,
      }),
  };
}

function layoutBody(drawing: string): SemanticLayout {
  const part = documentPart(drawing);
  return layoutSemanticDocument(part, 1, {
    measurer,
    producer: 'test',
    inlineDrawingLayout: drawingLayoutFor(part),
  });
}

function boxRecord(drawing: string): AnchoredDrawingRecord {
  const record = layoutBody(drawing).pages[0]!.anchoredDrawings?.[0];
  if (!record?.textboxStory) throw new Error('no textbox story on record');
  return record;
}

function storyLines(record: AnchoredDrawingRecord) {
  return paragraphFragmentsOfBlocks(record.textboxStory!.fragments, true).flatMap(
    (fragment) => fragment.lines
  );
}

const lineText = (line: ReturnType<typeof storyLines>[number]) =>
  line.spans.map((span) => span.text).join('');

describe('unwrapped text box text', () => {
  test('each paragraph stays on one line and the box takes the widest line', () => {
    const record = boxRecord(textbox(para('label text') + para('second label line')));
    const story = record.textboxStory!;
    expect(storyLines(record).map(lineText)).toEqual(['label text', 'second label line']);
    // 17 characters; default 7.2pt insets on both sides.
    expect(story.contentWidth).toBeCloseTo(17 * CHAR, 1);
    expect(story.contentOffset.x).toBeCloseTo(7.2, 3);
    expect(story.extentWidth).toBeCloseTo(17 * CHAR + 14.4, 1);
    expect(record.width).toBeCloseTo(17 * CHAR + 14.4, 1);
    // An offset position keeps the left edge where the extent put it.
    expect(record.x + MARGIN).toBeCloseTo(250, 3);
    expect(story.fallbackReason).toBeUndefined();
  });

  test('paragraph alignment places shorter lines inside the widest line', () => {
    const record = boxRecord(
      textbox(para('abcdefghij', 'center') + para('abcd', 'center') + para('ab', 'right'))
    );
    const [wide, centered, right] = storyLines(record);
    expect(wide!.contentX).toBeCloseTo(0, 1);
    expect(centered!.contentX).toBeCloseTo((6 * CHAR) / 2, 1);
    expect(right!.contentX).toBeCloseTo(8 * CHAR, 1);
  });

  test('a box wider than its text shrinks to the text', () => {
    const record = boxRecord(
      textbox(para('ab', 'center'), {
        widthPt: 144,
        bodyPr: '<wps:bodyPr wrap="none" lIns="0" rIns="0"><a:noAutofit/></wps:bodyPr>',
      })
    );
    expect(record.textboxStory!.contentWidth).toBeCloseTo(2 * CHAR, 1);
    expect(record.width).toBeCloseTo(2 * CHAR, 1);
    expect(storyLines(record)[0]!.contentX).toBeCloseTo(0, 1);
    // The extent height stays authoritative.
    expect(record.height).toBe(50);
  });

  test('a centered position centers the sized box', () => {
    const record = boxRecord(
      textbox(para('centered label'), {
        positionH: '<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>',
      })
    );
    expect(record.width).toBeCloseTo(14 * CHAR + 14.4, 1);
    expect(record.x + MARGIN + record.width / 2).toBeCloseTo(PAGE_WIDTH / 2, 1);
  });

  test('a right position keeps the sized box on the right edge', () => {
    const record = boxRecord(
      textbox(para('right label'), {
        positionH: '<wp:positionH relativeFrom="page"><wp:align>right</wp:align></wp:positionH>',
      })
    );
    expect(record.x + MARGIN + record.width).toBeCloseTo(PAGE_WIDTH, 1);
  });

  test('wrapped text keeps breaking at the extent', () => {
    const record = boxRecord(
      textbox(para('label text'), {
        bodyPr: '<wps:bodyPr wrap="square"><a:spAutoFit/></wps:bodyPr>',
      })
    );
    expect(storyLines(record).length).toBeGreaterThan(1);
    expect(record.textboxStory!.extentWidth).toBeUndefined();
    expect(record.width).toBeCloseTo(10, 3);
  });

  test('the painted fill and content follow the sized box', () => {
    const container = document.createElement('div');
    paintSemanticLayout(
      container,
      layoutBody(
        textbox(para('painted label'), {
          fill: 'FFEE00',
          bodyPr:
            '<wps:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0"><a:spAutoFit/></wps:bodyPr>',
        })
      ),
      { scale: 1 }
    );
    const fill = container.querySelector<HTMLElement>('.docx-drawing-textbox-box');
    const content = container.querySelector<HTMLElement>('.docx-drawing-textbox-content');
    expect(parseFloat(fill!.style.width)).toBeCloseTo(13 * CHAR, 1);
    expect(parseFloat(content!.style.width)).toBeCloseTo(13 * CHAR, 1);
    expect(content!.textContent).toBe('painted label');
  });
});
