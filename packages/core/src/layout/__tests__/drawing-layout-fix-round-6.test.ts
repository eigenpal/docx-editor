// Fix round 6/6 — post-line-spacing drawing reposition and page-relative caret Y (task 6).

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../../store/package/image-resources.ts';
import { createFixedMeasurer, layoutSemanticDocument, type SemanticLayout } from '../index.ts';
import type { InlineDrawingLayoutContext, InlineDrawingRecord } from '../drawing-layout.ts';
import { caretAt } from '../semantic-interaction.ts';
import { linesOf } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const OWNER = '/word/document.xml';

const measurer = createFixedMeasurer(6, 14);

const READY: ImageResourceState = Object.freeze({
  kind: 'ready',
  partName: '/word/media/image1.png',
  contentId: 'c1',
  resourceKey: 'k-ready',
  mime: 'image/png',
  pixelWidth: 10,
  pixelHeight: 10,
  dpiX: 96,
  dpiY: 96,
});

const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
const runSz = (text: string, halfPoints: number) =>
  `<w:r><w:rPr><w:sz w:val="${halfPoints}"/></w:rPr><w:t>${text}</w:t></w:r>`;

function inlineDrawingInner(
  options: {
    readonly extent?: string;
    readonly inlineAttrs?: string;
  } = {}
): string {
  const extent = options.extent ?? 'cx="914400" cy="457200"';
  const inlineAttrs = options.inlineAttrs ?? 'distT="0" distB="0" distL="0" distR="0"';
  return (
    '<w:drawing>' +
    `<wp:inline ${inlineAttrs}>` +
    `<wp:extent ${extent}/>` +
    '<wp:docPr id="1" name="pic"/>' +
    '<wp:cNvGraphicFramePr/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}">` +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
    '</a:graphicData></a:graphic></wp:inline></w:drawing>'
  );
}

function documentXml(body: string): string {
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    `<w:body>${body}</w:body></w:document>`
  );
}

function loadBody(xml: string): OoxmlPart {
  const result = readOoxmlPart(documentXml(xml), {
    name: OWNER,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function indexedContext(part: OoxmlPart): InlineDrawingLayoutContext {
  const atomProjections = indexInlineDrawingProjectionsInPart(part);
  return Object.freeze({
    ownerPartName: OWNER,
    projectionForAtom: (atomId) => atomProjections.get(atomId) ?? null,
    project: (node) =>
      atomProjections.get(node.id) ??
      projectDrawing(node, { ownerPartName: OWNER, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () => READY,
  });
}

function lay(
  part: OoxmlPart,
  ctx: InlineDrawingLayoutContext,
  options?: {
    readonly width?: number;
    readonly marginTop?: number;
  }
): SemanticLayout {
  return layoutSemanticDocument(part, 1, {
    measurer,
    inlineDrawingLayout: ctx,
    ...(options?.width !== undefined || options?.marginTop !== undefined
      ? {
          geometry: {
            width: options.width ?? 400,
            height: 800,
            margin: {
              top: options.marginTop ?? 72,
              right: 72,
              bottom: 72,
              left: 72,
            },
          },
        }
      : {}),
  });
}

function drawingBottomPageY(drawing: InlineDrawingRecord): number {
  return drawing.y + drawing.height;
}

function lineBaselinePageY(line: {
  readonly box: { readonly y: number };
  readonly baseline: number;
}): number {
  return line.box.y + line.baseline;
}

function drawingRelativeBottom(
  drawing: InlineDrawingRecord,
  line: { readonly box: { readonly y: number } }
): number {
  return drawing.y - line.box.y + drawing.height;
}

describe('fix round 6 — drawings follow line-spacing baseline shifts', () => {
  test('double spacing keeps drawing bottom on final baseline', () => {
    const part = loadBody(
      `<w:p><w:pPr><w:spacing w:line="480" w:lineRule="auto"/></w:pPr>` +
        `<w:r>${inlineDrawingInner({ extent: 'cx="914400" cy="228600"' })}</w:r>` +
        `${run('text')}</w:p>`
    );
    const layout = lay(part, indexedContext(part));
    const line = linesOf(layout)[0]!;
    const drawing = line.drawings![0]!;
    expect(drawingBottomPageY(drawing)).toBeCloseTo(lineBaselinePageY(line), 5);
    expect(line.leading).toBeGreaterThan(0);
  });

  test('exact spacing keeps authored 20pt box with mixed-height drawings on one baseline', () => {
    const part = loadBody(
      `<w:p><w:pPr><w:spacing w:line="400" w:lineRule="exact"/></w:pPr>` +
        `<w:r>${inlineDrawingInner({ extent: 'cx="914400" cy="127000"' })}</w:r>` +
        `<w:r>${inlineDrawingInner({ extent: 'cx="914400" cy="381000"' })}</w:r>` +
        `${run('txt')}</w:p>` +
        `<w:p>${run('next')}</w:p>`
    );
    const layout = lay(part, indexedContext(part));
    const lines = linesOf(layout);
    const line = lines[0]!;
    const [shortDrawing, tallDrawing] = line.drawings!;
    expect(line.box.height).toBeCloseTo(20, 5);
    expect(line.baseline).toBeCloseTo(20, 5);
    expect(drawingBottomPageY(shortDrawing)).toBeCloseTo(lineBaselinePageY(line), 5);
    expect(drawingBottomPageY(tallDrawing)).toBeCloseTo(lineBaselinePageY(line), 5);
    expect(shortDrawing.y).toBeGreaterThan(tallDrawing.y);
    expect(lines[1]!.box.y).toBeCloseTo(line.box.y + 20, 5);
  });

  test('exact spacing does not grow the line box for distB after spacing', () => {
    const part = loadBody(
      `<w:p><w:pPr><w:spacing w:line="400" w:lineRule="exact"/></w:pPr>` +
        `<w:r>${inlineDrawingInner({
          extent: 'cx="914400" cy="228600"',
          inlineAttrs: 'distT="0" distB="12700" distL="0" distR="0"',
        })}</w:r>` +
        `${runSz('TALL', 52)}</w:p>`
    );
    const layout = lay(part, indexedContext(part));
    const line = linesOf(layout)[0]!;
    const drawing = line.drawings![0]!;
    expect(line.box.height).toBeCloseTo(20, 5);
    expect(drawingBottomPageY(drawing)).toBeCloseTo(lineBaselinePageY(line), 5);
  });

  test('atLeast spacing expands line and repositions drawing to final baseline', () => {
    const part = loadBody(
      `<w:p><w:pPr><w:spacing w:line="600" w:lineRule="atLeast"/></w:pPr>` +
        `<w:r>${inlineDrawingInner({ extent: 'cx="914400" cy="228600"' })}</w:r>` +
        `${run('x')}</w:p>`
    );
    const layout = lay(part, indexedContext(part));
    const line = linesOf(layout)[0]!;
    const drawing = line.drawings![0]!;
    expect(line.box.height).toBeGreaterThanOrEqual(30);
    expect(drawingBottomPageY(drawing)).toBeCloseTo(lineBaselinePageY(line), 5);
    expect(line.box.height).toBeCloseTo(drawingRelativeBottom(drawing, line) + drawing.distB, 5);
  });

  test('nonzero-y later line preserves distB without overlapping the next line', () => {
    const part = loadBody(
      `<w:p><w:pPr><w:spacing w:line="480" w:lineRule="auto"/></w:pPr>` +
        `${run('AAAAAAAAAA')}` +
        `<w:r>${inlineDrawingInner({
          extent: 'cx="914400" cy="914400"',
          inlineAttrs: 'distT="0" distB="25400" distL="0" distR="0"',
        })}</w:r></w:p>` +
        `<w:p>${run('next')}</w:p>`
    );
    const layout = lay(part, indexedContext(part), { width: 100, marginTop: 96 });
    const lines = linesOf(layout);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const first = lines.find((line) => (line.drawings?.length ?? 0) > 0)!;
    const following = lines[lines.indexOf(first) + 1]!;
    const drawing = first.drawings![0]!;
    expect(first.box.y).toBeGreaterThan(0);
    expect(drawingBottomPageY(drawing)).toBeCloseTo(lineBaselinePageY(first), 5);
    expect(first.box.height).toBeCloseTo(drawingRelativeBottom(drawing, first) + drawing.distB, 5);
    expect(following.box.y).toBeCloseTo(first.box.y + first.box.height, 5);
  });
});

describe('fix round 6 — drawing caret uses page-relative Y', () => {
  test('caret before and after drawing on a later line matches drawing page Y exactly', () => {
    const part = loadBody(
      `<w:p>${run('AAAAAAAAAA')}<w:r>${inlineDrawingInner({
        extent: 'cx="914400" cy="228600"',
      })}</w:r></w:p>`
    );
    const layout = lay(part, indexedContext(part), { width: 100 });
    const line = linesOf(layout).find((entry) => (entry.drawings?.length ?? 0) > 0)!;
    const drawing = line.drawings![0]!;
    expect(line.box.y).toBeGreaterThan(0);

    const before = caretAt(layout, { paragraphId: line.range.paragraphId, offset: drawing.start })!;
    const after = caretAt(layout, {
      paragraphId: line.range.paragraphId,
      offset: drawing.start + 1,
    })!;

    expect(before.y).toBeCloseTo(drawing.y, 5);
    expect(before.height).toBeCloseTo(drawing.height, 5);
    expect(after.y).toBeCloseTo(drawing.y, 5);
    expect(after.height).toBeCloseTo(drawing.height, 5);
    expect(before.x).toBeCloseTo(drawing.advanceStart, 5);
    expect(after.x).toBeCloseTo(drawing.advanceEnd, 5);
  });

  test('caret on a wrapped line does not double-count line.box.y', () => {
    const part = loadBody(
      `<w:p>${run('AAAAAAAAAA')}<w:r>${inlineDrawingInner({
        extent: 'cx="914400" cy="228600"',
      })}</w:r>${run('Z')}</w:p>`
    );
    const layout = lay(part, indexedContext(part), { width: 100 });
    const line = linesOf(layout).find((entry) => (entry.drawings?.length ?? 0) > 0)!;
    const drawing = line.drawings![0]!;
    expect(line.box.y).toBeGreaterThan(0);

    const caret = caretAt(layout, { paragraphId: line.range.paragraphId, offset: drawing.start })!;
    expect(caret!.y).toBeCloseTo(drawing.y, 5);
    expect(caret!.y).not.toBeCloseTo(line.box.y + drawing.y, 5);
    expect(caret!.height).toBeCloseTo(drawing.height, 5);
  });
});
