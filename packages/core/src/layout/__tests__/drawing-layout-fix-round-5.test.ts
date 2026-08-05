// Fix round 5/5 — paragraph text reconstruction, post-reposition line box, size-sensitive
// baseline, nested-table resource tokens, selection clamp/ops (task 6).

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
import type {
  ImageResourceLookup,
  ImageResourceState,
} from '../../store/package/image-resources.ts';
import {
  createInlineDrawingLayoutBundle,
  drawingTokenForTableBlock,
  paragraphDrawingLayoutTokenFromContext,
} from '../inline-drawing-source.ts';
import { paragraphLayoutKey } from '../layout-cache.ts';
import { createHeadlessImageDecodePort } from '../../editor/browser-image-decode-port.ts';
import { clampedToDocument, selectedTextIn } from '../../editor/surface-selection-ops.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
  paragraphTextFromLayout,
  type SemanticLayout,
} from '../index.ts';
import type { InlineDrawingLayoutContext, InlineDrawingRecord } from '../drawing-layout.ts';
import { linesOf } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const OWNER = '/word/document.xml';
const ATOM = '\uFFFC';

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

/** Size-sensitive: baseline and height scale with w:sz so later larger runs raise the line. */
const measurer = createFixedMeasurer(6, 14);

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

function indexedContext(
  part: OoxmlPart,
  owner = OWNER,
  resource: () => ImageResourceState = () => READY
): InlineDrawingLayoutContext {
  const atomProjections = indexInlineDrawingProjectionsInPart(part);
  return Object.freeze({
    ownerPartName: owner,
    projectionForAtom: (atomId) => atomProjections.get(atomId) ?? null,
    project: (node) =>
      atomProjections.get(node.id) ??
      projectDrawing(node, { ownerPartName: owner, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: resource,
  });
}

function lay(
  part: OoxmlPart,
  ctx: InlineDrawingLayoutContext,
  geometry?: {
    width: number;
    height: number;
    margin: { top: number; right: number; bottom: number; left: number };
  }
) {
  return layoutSemanticDocument(part, 1, {
    measurer,
    ...(geometry ? { geometry } : {}),
    inlineDrawingLayout: ctx,
  });
}

function paragraphIdOf(layout: SemanticLayout): string {
  return linesOf(layout)[0]!.range.paragraphId;
}

function drawingBottom(drawing: InlineDrawingRecord): number {
  return drawing.y + drawing.height;
}

describe('fix round 5 — paragraphTextFromLayout includes atomic drawings', () => {
  test('image-only paragraph reconstructs one object-replacement character', () => {
    const part = loadBody(`<w:p><w:r>${inlineDrawingInner()}</w:r></w:p>`);
    const layout = lay(part, indexedContext(part));
    const pid = paragraphIdOf(layout);
    expect(paragraphTextFromLayout(layout, pid)).toBe(ATOM);
    expect(paragraphTextFromLayout(layout, pid).length).toBe(1);
  });

  test('text+drawing+text preserves middle atomic unit at offset 1', () => {
    const part = loadBody(`<w:p>${run('A')}<w:r>${inlineDrawingInner()}</w:r>${run('B')}</w:p>`);
    const layout = lay(part, indexedContext(part));
    const pid = paragraphIdOf(layout);
    expect(paragraphTextFromLayout(layout, pid)).toBe(`A${ATOM}B`);
    expect(paragraphTextFromLayout(layout, pid).length).toBe(3);
  });

  test('trailing drawing preserves terminal atomic unit', () => {
    const part = loadBody(`<w:p>${run('A')}<w:r>${inlineDrawingInner()}</w:r></w:p>`);
    const layout = lay(part, indexedContext(part));
    const pid = paragraphIdOf(layout);
    expect(paragraphTextFromLayout(layout, pid)).toBe(`A${ATOM}`);
    expect(paragraphTextFromLayout(layout, pid).length).toBe(2);
  });
});

describe('fix round 5 — selection clamp and ops preserve drawing offsets', () => {
  test('clampedToDocument keeps offset 1 for text+drawing+text select-all head', () => {
    const part = loadBody(`<w:p>${run('A')}<w:r>${inlineDrawingInner()}</w:r>${run('B')}</w:p>`);
    const layout = lay(part, indexedContext(part));
    const pid = paragraphIdOf(layout);
    const clamped = clampedToDocument(layout, [pid], {
      anchor: { paragraphId: pid, offset: 0 },
      head: { paragraphId: pid, offset: 99 },
    });
    expect(clamped.head.offset).toBe(3);
    expect(clamped.anchor.offset).toBe(0);
  });

  test('clampedToDocument clamps image-only select-all to length 1', () => {
    const part = loadBody(`<w:p><w:r>${inlineDrawingInner()}</w:r></w:p>`);
    const layout = lay(part, indexedContext(part));
    const pid = paragraphIdOf(layout);
    const clamped = clampedToDocument(layout, [pid], {
      anchor: { paragraphId: pid, offset: 0 },
      head: { paragraphId: pid, offset: 5 },
    });
    expect(clamped.head.offset).toBe(1);
  });

  test('selectedTextIn spans drawing atom in mixed paragraph', () => {
    const part = loadBody(`<w:p>${run('A')}<w:r>${inlineDrawingInner()}</w:r>${run('B')}</w:p>`);
    const layout = lay(part, indexedContext(part));
    const pid = paragraphIdOf(layout);
    const text = selectedTextIn(
      layout,
      { paragraphId: pid, offset: 0 },
      { paragraphId: pid, offset: 3 }
    );
    expect(text).toBe(`A${ATOM}B`);
  });

  test('selectedTextIn includes trailing drawing through paragraph end', () => {
    const part = loadBody(`<w:p>${run('A')}<w:r>${inlineDrawingInner()}</w:r></w:p>`);
    const layout = lay(part, indexedContext(part));
    const pid = paragraphIdOf(layout);
    const text = selectedTextIn(
      layout,
      { paragraphId: pid, offset: 1 },
      { paragraphId: pid, offset: 2 }
    );
    expect(text).toBe(ATOM);
  });
});

describe('fix round 5 — post-reposition line box includes drawing distB', () => {
  test('drawing.y + height + distB fits within line.box.height after baseline raise', () => {
    const part = loadBody(
      `<w:p><w:r>${inlineDrawingInner({
        extent: 'cx="914400" cy="228600"',
        inlineAttrs: 'distT="12700" distB="25400" distL="0" distR="0"',
      })}</w:r>${runSz('small', 18)}${runSz('TALL', 52)}</w:p>`
    );
    const layout = lay(part, indexedContext(part));
    const line = linesOf(layout)[0]!;
    const drawing = line.drawings![0]!;
    expect(drawingBottom(drawing)).toBeCloseTo(line.baseline, 3);
    expect(drawing.y + drawing.height + drawing.distB).toBeLessThanOrEqual(line.box.height + 0.01);
  });

  test('next line y does not overlap prior line drawing extent', () => {
    const part = loadBody(
      `<w:p><w:r>${inlineDrawingInner({
        extent: 'cx="914400" cy="914400"',
        inlineAttrs: 'distT="0" distB="12700" distL="0" distR="0"',
      })}</w:r>${run('wrap')}</w:p>` + `<w:p>${run('next')}</w:p>`
    );
    const layout = lay(part, indexedContext(part));
    const lines = linesOf(layout);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const first = lines[0]!;
    const second = lines[1]!;
    expect(second.box.y).toBeGreaterThanOrEqual(first.box.y + first.box.height - 0.01);
  });

  test('distT/distB honored when later run raises baseline and repositions drawing', () => {
    const part = loadBody(
      `<w:p><w:r>${inlineDrawingInner({
        extent: 'cx="914400" cy="228600"',
        inlineAttrs: 'distT="12700" distB="25400" distL="0" distR="0"',
      })}</w:r>${runSz('small', 18)}${runSz('TALL', 52)}</w:p>`
    );
    const layout = lay(part, indexedContext(part));
    const drawing = linesOf(layout)[0]!.drawings![0]!;
    expect(drawing.distT).toBeGreaterThan(0);
    expect(drawing.distB).toBeGreaterThan(0);
    expect(drawing.y).toBeGreaterThanOrEqual(drawing.distT - 0.01);
  });
});

describe('fix round 5 — size-sensitive measurer raises baseline and moves drawing', () => {
  test('later larger run raises baseline and repositions preexisting drawing upward', () => {
    const drawingRun = `<w:r>${inlineDrawingInner({ extent: 'cx="914400" cy="228600"' })}</w:r>`;
    const withTall = loadBody(`<w:p>${drawingRun}${runSz('small', 18)}${runSz('TALL', 52)}</w:p>`);
    const smallOnly = loadBody(`<w:p>${drawingRun}${runSz('small', 18)}</w:p>`);
    const tallLayout = lay(withTall, indexedContext(withTall));
    const smallLayout = lay(smallOnly, indexedContext(smallOnly));
    const tallLine = linesOf(tallLayout)[0]!;
    const smallLine = linesOf(smallLayout)[0]!;
    const tallDrawing = tallLine.drawings![0]!;
    const smallDrawing = smallLine.drawings![0]!;
    expect(tallLine.baseline).toBeGreaterThan(smallLine.baseline);
    expect(tallDrawing.y).toBeGreaterThan(smallDrawing.y);
    expect(drawingBottom(tallDrawing)).toBeCloseTo(tallLine.baseline, 3);
    expect(tallDrawing.y + tallDrawing.height + tallDrawing.distB).toBeLessThanOrEqual(
      tallLine.box.height + 0.01
    );
  });
});

describe('fix round 5 — nested table recursive drawing resource token', () => {
  function nestedTableBody(): string {
    return (
      '<w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>' +
      '<w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="2500" w:type="dxa"/></w:tcPr>' +
      `<w:p>${run('N')}<w:r>${inlineDrawingInner()}</w:r></w:p>` +
      '</w:tc></w:tr></w:tbl></w:tc></w:tr></w:tbl>' +
      `<w:p>${run('after')}</w:p>`
    );
  }

  test('drawingTokenForTableBlock includes nested cell paragraph tokens', () => {
    const part = loadBody(nestedTableBody());
    const table = part.root.children[0]!.children[0]!;
    const ctxPending = indexedContext(part, OWNER, () =>
      Object.freeze({ kind: 'pending', resourceKey: 'k-nested' })
    );
    const ctxReady = indexedContext(part, OWNER, () => READY);
    const keyPending = paragraphLayoutKey({
      paragraph: table,
      properties: [],
      width: 400,
      producer: 'p',
      drawingToken: drawingTokenForTableBlock(table, (p) =>
        paragraphDrawingLayoutTokenFromContext(p as never, ctxPending)
      ),
    });
    const keyReady = paragraphLayoutKey({
      paragraph: table,
      properties: [],
      width: 400,
      producer: 'p',
      drawingToken: drawingTokenForTableBlock(table, (p) =>
        paragraphDrawingLayoutTokenFromContext(p as never, ctxReady)
      ),
    });
    expect(keyPending).not.toBe(keyReady);
    expect(keyPending.length).toBeGreaterThan(0);
  });

  test('pending→ready nested table drawing invalidates layout and no-change pass is stable', async () => {
    const part = loadBody(nestedTableBody());
    const layoutSession = createLayoutSession();
    let resolveDeferred: ((state: ImageResourceState) => void) | null = null;
    const lookup: ImageResourceLookup = {
      resolveEmbedded: async () => READY,
      resolveLinked: () =>
        Object.freeze({ kind: 'external', relationshipId: 'r', sinkSafe: false }),
      resolveForProjection: () =>
        new Promise((resolve) => {
          resolveDeferred = resolve;
        }),
      liveReferenceCount: () => 0,
      dispose: () => {},
    };
    const session = {
      part: () => part,
      currentPackage: () =>
        ({
          relationships: new Map(),
          externalTargets: [],
          parts: new Map([[OWNER, part]]),
          mainDocumentPart: OWNER,
        }) as never,
      packageRevision: () => 1,
    } as never;
    const bundle = createInlineDrawingLayoutBundle({
      session,
      decodePort: createHeadlessImageDecodePort(),
      onResourcesChanged: () => {},
      resourceLookup: lookup,
    });

    const pendingLayout = layoutSemanticDocument(part, 1, {
      measurer,
      session: layoutSession,
      inlineDrawingLayout: bundle.bodyContext,
      drawingTokenForParagraph: (p) => bundle.drawingTokenForParagraph(p, OWNER),
    });
    const nestedPending = pendingLayout.pages[0]!.fragments.some(
      (f) =>
        f.kind === 'table' &&
        f.rows.some((row) =>
          row.cells.some((cell) =>
            cell.blocks.some(
              (block) =>
                block.kind === 'table' &&
                block.rows.some((nr) =>
                  nr.cells.some((nc) =>
                    nc.blocks.some(
                      (bp) =>
                        bp.kind === 'paragraph' &&
                        bp.lines.some((ln) => ln.drawings?.[0]?.resource.kind === 'pending')
                    )
                  )
                )
            )
          )
        )
    );
    expect(nestedPending).toBe(true);

    resolveDeferred?.(READY);
    await new Promise((r) => setTimeout(r, 0));

    const afterReady = layoutSemanticDocument(part, 2, {
      measurer,
      session: layoutSession,
      inlineDrawingLayout: bundle.bodyContext,
      drawingTokenForParagraph: (p) => bundle.drawingTokenForParagraph(p, OWNER),
    });
    expect(afterReady.pages[0]).not.toBe(pendingLayout.pages[0]);

    const noChange = layoutSemanticDocument(part, 3, {
      measurer,
      session: layoutSession,
      inlineDrawingLayout: bundle.bodyContext,
      drawingTokenForParagraph: (p) => bundle.drawingTokenForParagraph(p, OWNER),
    });
    expect(noChange.pages[0]).toBe(afterReady.pages[0]);
    bundle.dispose();
  });
});
