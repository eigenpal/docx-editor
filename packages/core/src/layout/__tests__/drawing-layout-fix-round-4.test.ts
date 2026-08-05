// Fix round 4/5 — baseline reposition, drawing-only wrap, table cache, hit identity,
// image-only caret, pending→ready differential, HF geometry (task 6).

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  readOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { resolveHeaderFooterPartsBySection } from '../../store/package/hf-references.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import type {
  ImageResourceLookup,
  ImageResourceState,
} from '../../store/package/image-resources.ts';
import { mockReadyImageResource } from '../../store/__tests__/drawing-ready-fixture.ts';
import {
  drawingTokenForTableBlock,
  paragraphDrawingLayoutTokenFromContext,
} from '../inline-drawing-source.ts';
import { paragraphLayoutKey } from '../layout-cache.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { createHeadlessImageDecodePort } from '../../editor/browser-image-decode-port.ts';
import { createFurnitureSource } from '../../editor/surface-pages.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  enumerateDocumentSections,
  layoutSemanticDocument,
  type SemanticLayout,
} from '../index.ts';
import type { InlineDrawingLayoutContext, InlineDrawingRecord } from '../drawing-layout.ts';
import { createInlineDrawingLayoutBundle } from '../inline-drawing-source.ts';
import { geometryOfSection } from '../section-properties.ts';
import { hitTestPage } from '../semantic-hit-test.ts';
import { caretAt } from '../semantic-interaction.ts';
import { linesOf } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const measurer = createFixedMeasurer(6, 14);
const OWNER = '/word/document.xml';
const NARROW = 80;

const READY = mockReadyImageResource({
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  pixelWidth: 10,
  pixelHeight: 10,
});

const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
const runSz = (text: string, halfPoints: number) =>
  `<w:r><w:rPr><w:sz w:val="${halfPoints}"/></w:rPr><w:t>${text}</w:t></w:r>`;
const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

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

function drawingBottom(line: { readonly baseline: number }, drawing: InlineDrawingRecord): number {
  return drawing.y + drawing.height;
}

describe('fix round 4 — inline baseline semantics', () => {
  test('drawing before text: bottom aligns to final text baseline', () => {
    const part = loadBody(
      `<w:p><w:r>${inlineDrawingInner({ extent: 'cx="914400" cy="228600"' })}</w:r>${runSz('BIG', 44)}</w:p>`
    );
    const layout = lay(part, indexedContext(part));
    const line = linesOf(layout)[0]!;
    const drawing = line.drawings![0]!;
    expect(drawingBottom(line, drawing)).toBeCloseTo(line.baseline, 3);
    expect(drawing.paintBounds.y + drawing.paintBounds.height).toBeLessThanOrEqual(
      line.box.y + line.baseline + 0.01
    );
    expect(drawing.hitBounds.height).toBeGreaterThan(0);
  });

  test('text before drawing: bottom still aligns after mixed placement', () => {
    const part = loadBody(
      `<w:p>${runSz('A', 22)}<w:r>${inlineDrawingInner()}</w:r>${run('B')}</w:p>`
    );
    const layout = lay(part, indexedContext(part));
    const line = linesOf(layout)[0]!;
    const drawing = line.drawings![0]!;
    expect(drawingBottom(line, drawing)).toBeCloseTo(line.baseline, 3);
  });

  test('mixed font sizes reposition earlier drawing when baseline rises', () => {
    const part = loadBody(
      `<w:p><w:r>${inlineDrawingInner({ extent: 'cx="914400" cy="228600"' })}</w:r>${runSz('small', 18)}${runSz('TALL', 52)}</w:p>`
    );
    const layout = lay(part, indexedContext(part));
    const line = linesOf(layout)[0]!;
    const drawing = line.drawings![0]!;
    expect(drawingBottom(line, drawing)).toBeCloseTo(line.baseline, 3);
    expect(line.box.height).toBeGreaterThan(14);
  });

  test('image-only line baseline and drawing geometry stay coherent', () => {
    const part = loadBody(`<w:p><w:r>${inlineDrawingInner()}</w:r></w:p>`);
    const layout = lay(part, indexedContext(part));
    const line = linesOf(layout)[0]!;
    expect(line.spans).toEqual([]);
    const drawing = line.drawings![0]!;
    expect(drawingBottom(line, drawing)).toBeCloseTo(line.baseline, 3);
    expect(line.box.height).toBeGreaterThanOrEqual(drawing.y + drawing.height);
  });
});

describe('fix round 4 — text after drawing wraps on drawing advance', () => {
  const narrow = {
    width: NARROW,
    height: 800,
    margin: { top: 10, right: 10, bottom: 10, left: 10 },
  };

  test('text after drawing wraps when drawing advance fills line (exact boundary)', () => {
    // 72pt image + text must not fit on 60pt content width (80 - margins)
    const part = loadBody(`<w:p><w:r>${inlineDrawingInner()}</w:r>${run('XY')}</w:p>`);
    const layout = lay(part, indexedContext(part), narrow);
    expect(linesOf(layout).length).toBeGreaterThan(1);
    const first = linesOf(layout)[0]!;
    expect(first.drawings).toHaveLength(1);
    expect(first.spans).toEqual([]);
    expect(linesOf(layout)[1]!.spans.length).toBeGreaterThan(0);
  });

  test('text fits on same line when just under boundary with distL/distR', () => {
    const part = loadBody(
      `<w:p><w:r>${inlineDrawingInner({ inlineAttrs: 'distT="0" distB="0" distL="12700" distR="12700"', extent: 'cx="152400" cy="152400"' })}</w:r>${run('A')}</w:p>`
    );
    const layout = lay(part, indexedContext(part), narrow);
    expect(linesOf(layout).length).toBe(1);
    const line = linesOf(layout)[0]!;
    expect(line.drawings).toHaveLength(1);
    expect(line.spans.length).toBeGreaterThan(0);
    const drawing = line.drawings![0]!;
    expect(drawing.advanceEnd - drawing.advanceStart).toBeGreaterThan(drawing.width);
  });

  test('just-over boundary with distL/distR wraps trailing text', () => {
    const part = loadBody(
      `<w:p><w:r>${inlineDrawingInner({ inlineAttrs: 'distT="0" distB="0" distL="12700" distR="12700"' })}</w:r>${run('WIDE')}</w:p>`
    );
    const layout = lay(part, indexedContext(part), narrow);
    expect(linesOf(layout).length).toBeGreaterThan(1);
  });
});

describe('fix round 4 — table drawing resource invalidates table key', () => {
  test('pending→ready cell drawing changes table block key and breaks incremental unchanged shortcut', async () => {
    const part = loadBody(
      '<w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>' +
        `<w:p>${run('T')}<w:r>${inlineDrawingInner()}</w:r></w:p></w:tc></w:tr></w:tbl>` +
        `<w:p>${run('after')}</w:p>`
    );
    const table = part.root.children[0]!.children[0]!;
    const ctxPending = indexedContext(part, OWNER, () =>
      Object.freeze({ kind: 'pending', resourceKey: 'k' })
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
    expect(
      pendingLayout.pages[0]!.fragments.some(
        (f) =>
          f.kind === 'table' &&
          f.rows[0]!.cells[0]!.blocks[0]!.lines[0]!.drawings?.[0]?.resource.kind === 'pending'
      )
    ).toBe(true);

    resolveDeferred?.(READY);
    await new Promise((r) => setTimeout(r, 0));

    const afterReady = layoutSemanticDocument(part, 2, {
      measurer,
      session: layoutSession,
      inlineDrawingLayout: bundle.bodyContext,
      drawingTokenForParagraph: (p) => bundle.drawingTokenForParagraph(p, OWNER),
    });
    expect(
      afterReady.pages[0]!.fragments.some(
        (f) =>
          f.kind === 'table' &&
          f.rows[0]!.cells[0]!.blocks[0]!.lines[0]!.drawings?.[0]?.resource.kind === 'ready'
      )
    ).toBe(true);
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

describe('fix round 4 — semantic hit exposes drawing identity', () => {
  test('hit inside drawing returns stable drawingNodeId with atomic offset', () => {
    const part = loadBody(`<w:p>${run('A')}<w:r>${inlineDrawingInner()}</w:r>${run('B')}</w:p>`);
    const layout = lay(part, indexedContext(part));
    const line = linesOf(layout)[0]!;
    const drawing = line.drawings![0]!;
    const hit = hitTestPage(layout, 0, {
      x: drawing.hitBounds.x + drawing.hitBounds.width / 2,
      y: line.box.y + drawing.y + drawing.height / 2,
    })!;
    expect(hit.position.offset).toBe(1);
    expect(hit.drawing).toEqual({
      drawingNodeId: drawing.drawingNodeId,
      paragraphId: line.range.paragraphId,
      start: drawing.start,
    });
    expect(hit.onGlyphs).toBe(true);
  });

  test('edge hit at drawing advance exposes drawing identity when inside clip', () => {
    const part = loadBody(`<w:p>${run('A')}<w:r>${inlineDrawingInner()}</w:r>${run('B')}</w:p>`);
    const layout = lay(part, indexedContext(part));
    const line = linesOf(layout)[0]!;
    const drawing = line.drawings![0]!;
    const hit = hitTestPage(layout, 0, {
      x: drawing.advanceStart + 0.5,
      y: line.box.y + drawing.y + drawing.height / 2,
    })!;
    expect(hit.position.offset).toBe(1);
    expect(hit.drawing?.drawingNodeId).toBe(drawing.drawingNodeId);
  });
});

describe('fix round 4 — image-only paragraph caret uses drawing advances', () => {
  test('caret at offset 0 and 1 uses advanceStart/advanceEnd not empty-line fallback', () => {
    const part = loadBody(
      `<w:p><w:r>${inlineDrawingInner({ inlineAttrs: 'distT="0" distB="0" distL="12700" distR="12700"' })}</w:r></w:p>`
    );
    const layout = lay(part, indexedContext(part));
    const line = linesOf(layout)[0]!;
    const drawing = line.drawings![0]!;
    const before = caretAt(layout, { paragraphId: line.range.paragraphId, offset: 0 })!;
    const after = caretAt(layout, { paragraphId: line.range.paragraphId, offset: 1 })!;
    expect(before.x).toBeCloseTo(drawing.advanceStart, 2);
    expect(after.x).toBeCloseTo(drawing.advanceEnd, 2);
    expect(after.x - before.x).toBeCloseTo(drawing.advanceEnd - drawing.advanceStart, 2);
  });
});

describe('fix round 4 — pending→ready differential with persistent bundle', () => {
  function multiPageBody(): string {
    return (
      `<w:p>${run('Lead')}<w:r>${inlineDrawingInner()}</w:r></w:p>` +
      pageBreak +
      `<w:p>${run('Mid')}</w:p>` +
      pageBreak +
      `<w:p>${run('Tail')}</w:p>`
    );
  }

  function drawingShapeOf(layout: SemanticLayout): string {
    return JSON.stringify(
      layout.pages.flatMap((page) =>
        page.fragments.flatMap((fragment) =>
          fragment.kind === 'paragraph'
            ? fragment.lines.flatMap((line) =>
                (line.drawings ?? []).map((d) => ({
                  resource: d.resource.kind,
                  x: d.x,
                  y: d.y,
                  advanceStart: d.advanceStart,
                  advanceEnd: d.advanceEnd,
                }))
              )
            : []
        )
      )
    );
  }

  test('warmed ready clean layout matches incremental after one bundle settles pending→ready', async () => {
    const part = loadBody(multiPageBody());
    const pkg = {
      relationships: new Map(),
      externalTargets: [],
      parts: new Map([[OWNER, part]]),
      mainDocumentPart: OWNER,
    } as never;
    const session = {
      part: () => part,
      currentPackage: () => pkg,
      packageRevision: () => 1,
    } as never;

    const readyLookup = {
      resolveEmbedded: async () => READY,
      resolveLinked: () =>
        Object.freeze({ kind: 'external', relationshipId: 'r', sinkSafe: false }),
      resolveForProjection: async () => READY,
      liveReferenceCount: () => 0,
      dispose: () => {},
    } satisfies ImageResourceLookup;

    const cleanBundle = createInlineDrawingLayoutBundle({
      session,
      decodePort: createHeadlessImageDecodePort(),
      onResourcesChanged: () => {},
      resourceLookup: readyLookup,
    });
    const clean = layoutSemanticDocument(part, 1, {
      measurer,
      session: createLayoutSession(),
      inlineDrawingLayout: cleanBundle.bodyContext,
      drawingTokenForParagraph: (p) => cleanBundle.drawingTokenForParagraph(p, OWNER),
    });
    cleanBundle.dispose();
    expect(clean.pages.length).toBeGreaterThanOrEqual(2);

    let resolveDeferred: ((state: ImageResourceState) => void) | null = null;
    const pendingLookup: ImageResourceLookup = {
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
    const layoutSession = createLayoutSession();
    const bundle = createInlineDrawingLayoutBundle({
      session,
      decodePort: createHeadlessImageDecodePort(),
      onResourcesChanged: () => {},
      resourceLookup: pendingLookup,
    });
    const pendingLayout = layoutSemanticDocument(part, 2, {
      measurer,
      session: layoutSession,
      inlineDrawingLayout: bundle.bodyContext,
      drawingTokenForParagraph: (p) => bundle.drawingTokenForParagraph(p, OWNER),
    });
    expect(
      pendingLayout.pages[0]!.fragments[0]!.kind === 'paragraph' &&
        (pendingLayout.pages[0]!.fragments[0] as { lines: { drawings?: unknown[] }[] }).lines[0]!
          .drawings?.[0] &&
        (
          pendingLayout.pages[0]!.fragments[0] as {
            lines: { drawings: { resource: { kind: string } }[] }[];
          }
        ).lines[0]!.drawings![0]!.resource.kind === 'pending'
    ).toBe(true);

    resolveDeferred?.(READY);
    await new Promise((r) => setTimeout(r, 0));

    const incremental = layoutSemanticDocument(part, 3, {
      measurer,
      session: layoutSession,
      inlineDrawingLayout: bundle.bodyContext,
      drawingTokenForParagraph: (p) => bundle.drawingTokenForParagraph(p, OWNER),
    });
    expect(drawingShapeOf(incremental)).toBe(drawingShapeOf(clean));
    expect(incremental.pages[2]).toBe(pendingLayout.pages[2]);
    bundle.dispose();
  });
});

describe('fix round 4 — HF geometry compares body fragments and pagination', () => {
  function headerPackage(headerBody: string, body: string): Uint8Array {
    return zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rIdH1" Type="${R}/header" Target="header1.xml"/></Relationships>`
      ),
      'word/header1.xml': strToU8(
        `<w:hdr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">${headerBody}</w:hdr>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:r="${R}"><w:body>${body}` +
          `<w:sectPr><w:headerReference w:type="default" r:id="rIdH1"/><w:pgSz w:w="6000" w:h="3000"/><w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200" w:header="100" w:footer="100"/></w:sectPr>` +
          '</w:body></w:document>'
      ),
    });
  }

  function bodyFragmentShape(layout: SemanticLayout) {
    return layout.pages.map((page) => ({
      pageIndex: page.index,
      fragments: page.fragments.map((f) =>
        f.kind === 'paragraph'
          ? {
              kind: 'paragraph' as const,
              box: f.box,
              lines: f.lines.map((line) => ({
                box: line.box,
                baseline: line.baseline,
                spanCount: line.spans.length,
                drawingCount: line.drawings?.length ?? 0,
              })),
            }
          : { kind: 'table' as const, box: f.box }
      ),
    }));
  }

  test('header drawing does not shift body fragment boxes, page assignment, or pagination', () => {
    const body = `<w:p>${run('One')}</w:p>${pageBreak}<w:p>${run('Two')}</w:p>${pageBreak}<w:p>${run('Three')}</w:p>`;
    const bytes = headerPackage(`<w:p>${run('H')}<w:r>${inlineDrawingInner()}</w:r></w:p>`, body);
    const loaded = readOoxmlPackage(bytes);
    if (!loaded.ok) throw new Error(loaded.reason);
    const pkg = loaded.package;
    const doc = pkg.parts.get(pkg.mainDocumentPart)!;
    const hfParts = resolveHeaderFooterPartsBySection(pkg);
    const sections = enumerateDocumentSections(doc);
    const width =
      geometryOfSection(sections[0]!.properties).width -
      geometryOfSection(sections[0]!.properties).margin.left -
      geometryOfSection(sections[0]!.properties).margin.right;
    const headerPart = hfParts[0]!.headers.get('default')!;
    const hfCtx = indexedContext(headerPart, headerPart.name);
    const furniture = createFurnitureSource({
      session: {
        part: () => doc,
        currentPackage: () => pkg,
        packageRevision: () => 1,
        headerFooterPartsBySection: () => hfParts,
      } as never,
      measurer,
      producer: 'test',
      cache: undefined,
      inlineDrawingLayoutForPart: () => hfCtx,
      drawingLayoutTokenForPart: () => 'hf',
      drawingTokenForParagraphForPart: (_p, paragraph) =>
        paragraphDrawingLayoutTokenFromContext(paragraph as never, hfCtx),
    });
    const bodyOnly = layoutSemanticDocument(doc, 1, {
      measurer,
      inlineDrawingLayout: indexedContext(doc),
    });
    const withHf = layoutSemanticDocument(doc, 2, {
      measurer,
      inlineDrawingLayout: indexedContext(doc),
      sectionFurniture: furniture.sectionFurniture(),
      furniture: furniture.furniture(),
    });
    expect(withHf.pages.length).toBeGreaterThanOrEqual(3);
    expect(bodyFragmentShape(bodyOnly)).toEqual(bodyFragmentShape(withHf));
    expect(withHf.pages[0]!.header!.fragments[0]!.lines[0]!.drawings).toHaveLength(1);
  });
});
