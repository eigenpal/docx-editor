// Fix round 2/5 — MC namespace scope, page/cell clip, HF integration, per-paragraph cache (task 6).

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  readOoxmlPart,
  WML_NAMESPACE_URI,
  canonicalOoxmlFingerprint,
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
  clipInlineDrawingRecordToRegion,
  type InlineDrawingLayoutContext,
} from '../drawing-layout.ts';
import { computeDrawingGeometry } from '../drawing-geometry.ts';
import {
  createInlineDrawingLayoutBundle,
  paragraphDrawingLayoutTokenFromContext,
} from '../inline-drawing-source.ts';
import { paragraphLayoutKey } from '../layout-cache.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { piecesOfParagraph } from '../field-projection.ts';
import { createHeadlessImageDecodePort } from '../../editor/browser-image-decode-port.ts';
import { createFurnitureSource } from '../../editor/surface-pages.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  enumerateDocumentSections,
  layoutSemanticDocument,
} from '../index.ts';
import { geometryOfSection } from '../section-properties.ts';
import { linesOf, type PageGeometry } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const measurer = createFixedMeasurer(6, 14);
const OWNER = '/word/document.xml';
const HF_OWNER = '/word/header1.xml';

const READY = mockReadyImageResource({
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  pixelWidth: 10,
  pixelHeight: 10,
});

const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;

function inlineDrawingInner(extent = 'cx="914400" cy="457200"'): string {
  return (
    '<w:drawing>' +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent ${extent}/>` +
    '<wp:docPr id="1" name="pic"/><wp:cNvGraphicFramePr/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}">` +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId14"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
    '</a:graphicData></a:graphic></wp:inline></w:drawing>'
  );
}

function documentXml(body: string): string {
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}" xmlns:mc="${MC}" xmlns:w14="${W14}">` +
    `<w:body>${body}</w:body></w:document>`
  );
}

function load(xml: string, name = OWNER): OoxmlPart {
  const result = readOoxmlPart(xml, {
    name,
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

function deferredLookup(onSettle: () => void): {
  lookup: ImageResourceLookup;
  settle: () => void;
  settledCount: number;
} {
  let settledCount = 0;
  let resolveDeferred: ((state: ImageResourceState) => void) | null = null;
  const lookup: ImageResourceLookup = {
    resolveEmbedded: async () => READY,
    resolveLinked: () => Object.freeze({ kind: 'external', relationshipId: 'r', sinkSafe: false }),
    resolveForProjection: () =>
      new Promise((resolve) => {
        resolveDeferred = resolve;
      }),
    liveReferenceCount: () => 0,
    dispose: () => {},
  };
  return {
    lookup,
    settledCount: () => settledCount,
    settle: () => {
      settledCount += 1;
      resolveDeferred?.(READY);
      onSettle();
    },
  };
}

describe('fix round 2 — MC namespace scope from part root', () => {
  test('document-root xmlns: supported Choice lays out, unsupported stays inert, tree unchanged', () => {
    const mcBody =
      '<w:p>' +
      run('A') +
      '<w:r>' +
      `<mc:AlternateContent>` +
      `<mc:Choice Requires="w14">${inlineDrawingInner()}</mc:Choice>` +
      `<mc:Fallback><w:pict/></mc:Fallback>` +
      '</mc:AlternateContent></w:r>' +
      run('B') +
      '</w:p>';
    const supportedPart = load(documentXml(mcBody));
    const beforeFp = canonicalOoxmlFingerprint(supportedPart);
    const ctx = indexedContext(supportedPart);
    const paragraph = supportedPart.root.children[0]!.children[0]!;
    expect(
      piecesOfParagraph(
        paragraph,
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ctx
      ).some((piece) => piece.inlineDrawing)
    ).toBe(true);
    const layout = layoutSemanticDocument(supportedPart, 1, { measurer, inlineDrawingLayout: ctx });
    expect(linesOf(layout)[0]!.drawings).toHaveLength(1);
    expect(canonicalOoxmlFingerprint(supportedPart)).toBe(beforeFp);

    const unsupportedPart = load(
      documentXml(
        '<w:p><w:r>' +
          `<mc:AlternateContent>` +
          `<mc:Choice Requires="w14">${inlineDrawingInner()}</mc:Choice>` +
          '</mc:AlternateContent></w:r></w:p>'
      ).replace(`xmlns:w14="${W14}"`, 'xmlns:w14="urn:not-supported"')
    );
    const unsupportedCtx = indexedContext(unsupportedPart);
    const unsupportedLayout = layoutSemanticDocument(unsupportedPart, 1, {
      measurer,
      inlineDrawingLayout: unsupportedCtx,
    });
    expect(linesOf(unsupportedLayout)[0]!.drawings ?? []).toEqual([]);
    expect(linesOf(unsupportedLayout)[0]!.range.end).toBe(1);
  });
});

describe('fix round 2 — page and cell clipping', () => {
  test('tall drawing clips paint/hit to page content box while authored extent stays', () => {
    const part = load(
      documentXml(`<w:p><w:r>${inlineDrawingInner('cx="914400" cy="3657600"')}</w:r></w:p>`)
    );
    const SMALL: PageGeometry = {
      width: 120,
      height: 60,
      margin: { top: 5, right: 5, bottom: 5, left: 5 },
    };
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      geometry: SMALL,
      inlineDrawingLayout: indexedContext(part),
    });
    expect(layout.pages.length).toBeLessThan(20);
    expect(layout.pages.length).toBeGreaterThanOrEqual(1);
    const drawing = linesOf(layout)[0]!.drawings![0]!;
    expect(drawing.height).toBeGreaterThan(layout.pages[0]!.contentBox.height);
    expect(drawing.paintBounds.height).toBeLessThanOrEqual(
      layout.pages[0]!.contentBox.height + 0.01
    );
    expect(drawing.hitBounds.height).toBe(drawing.paintBounds.height);
  });

  test('wide first-line drawing clips horizontally to content width', () => {
    const part = load(
      documentXml(`<w:p><w:r>${inlineDrawingInner('cx="7315200" cy="457200"')}</w:r></w:p>`)
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      geometry: { width: 100, height: 400, margin: { top: 10, right: 10, bottom: 10, left: 10 } },
      inlineDrawingLayout: indexedContext(part),
    });
    const drawing = linesOf(layout)[0]!.drawings![0]!;
    expect(drawing.width).toBeGreaterThan(80);
    expect(drawing.paintBounds.width).toBeLessThanOrEqual(80 + 0.01);
  });

  test('clipInlineDrawingRecordToRegion preserves authored width/height fields', () => {
    const geometry = computeDrawingGeometry({
      extentWidth: 200,
      extentHeight: 300,
      anchorX: 0,
      anchorY: 0,
      effectExtentEmu: { top: 0, right: 0, bottom: 0, left: 0 },
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      transform: { rotationDegrees: 0, flipHorizontal: false, flipVertical: false },
      presetGeometry: 'rect',
    });
    const clipped = clipInlineDrawingRecordToRegion(
      {
        kind: 'inlineDrawing',
        drawingNodeId: 'd1',
        paragraphId: 'p1',
        ownerPartName: OWNER,
        start: 0,
        x: 0,
        y: 0,
        width: 200,
        height: 300,
        distL: 0,
        distR: 0,
        distT: 0,
        distB: 0,
        advanceStart: 0,
        advanceEnd: 200,
        baselineOffset: 11,
        paintBounds: { x: 0, y: 0, width: 200, height: 300 },
        hitBounds: { x: 0, y: 0, width: 200, height: 300 },
        geometry,
        resource: READY,
        accessibility: { hidden: false, decorative: false, label: null },
      },
      { x: 0, y: 0, width: 50, height: 40 }
    );
    expect(clipped.width).toBe(200);
    expect(clipped.height).toBe(300);
    expect(clipped.paintBounds.width).toBe(50);
    expect(clipped.paintBounds.height).toBe(40);
  });
});

describe('fix round 2 — header/footer package integration', () => {
  function headerPackage(headerBody: string, body = `<w:p>${run('Body')}</w:p>`): Uint8Array {
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
          `<w:sectPr><w:headerReference w:type="default" r:id="rIdH1"/></w:sectPr>` +
          '</w:body></w:document>'
      ),
    });
  }

  test('inline drawing in default header via section furniture does not shift body geometry', () => {
    const bytes = headerPackage(`<w:p>${run('H')}<w:r>${inlineDrawingInner()}</w:r></w:p>`);
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
    const furniture = {
      titlePage: false,
      evenAndOddHeaders: false,
      headers: new Map([
        [
          'default' as const,
          layoutHeaderFooterStory(
            headerPart,
            width,
            measurer,
            'test',
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            hfCtx,
            (paragraph) => paragraphDrawingLayoutTokenFromContext(paragraph as never, hfCtx)
          ),
        ],
      ]),
      footers: new Map(),
    };
    const bodyOnly = layoutSemanticDocument(doc, 1, {
      measurer,
      inlineDrawingLayout: indexedContext(doc),
    });
    const withHf = layoutSemanticDocument(doc, 2, {
      measurer,
      inlineDrawingLayout: indexedContext(doc),
      sectionFurniture: [furniture],
      furniture,
    });
    expect(bodyOnly.pages[0]!.fragments).toEqual(withHf.pages[0]!.fragments);
    const headerLine = withHf.pages[0]!.header!.fragments[0]!.lines[0]!;
    expect(headerLine.drawings).toHaveLength(1);
    expect(headerLine.drawings![0]!.ownerPartName).toBe(headerPart.name);
  });
});

describe('fix round 2 — dynamic HF resource memo', () => {
  test('furniture memo invalidates when per-part drawing resource token changes', () => {
    const headerXml = `<w:hdr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:p>${run('H')}<w:r>${inlineDrawingInner()}</w:r></w:p></w:hdr>`;
    const headerPartFixed = readOoxmlPart(headerXml, {
      name: HF_OWNER,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
    });
    if (!headerPartFixed.ok) throw new Error(headerPartFixed.reason);
    const part = headerPartFixed.part;
    let resourceGeneration = 0;
    const ctx: InlineDrawingLayoutContext = Object.freeze({
      ownerPartName: HF_OWNER,
      projectionForAtom: (id) => indexInlineDrawingProjectionsInPart(part).get(id) ?? null,
      project: (node) =>
        projectDrawing(node, {
          ownerPartName: HF_OWNER,
          limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
        }),
      resourceOf: () =>
        resourceGeneration === 0
          ? Object.freeze({ kind: 'pending' as const, resourceKey: 'k' })
          : READY,
    });
    const session = {
      part: () => load(documentXml(`<w:p>${run('B')}</w:p>`)),
      currentPackage: () =>
        ({
          relationships: new Map(),
          externalTargets: [],
          parts: new Map([[HF_OWNER, part]]),
          mainDocumentPart: OWNER,
        }) as never,
      packageRevision: () => 1,
      headerFooterPartsBySection: () => [
        {
          headers: new Map([['default', part]]),
          footers: new Map(),
          titlePage: false,
          evenAndOddHeaders: false,
        },
      ],
    } as never;
    const source = createFurnitureSource({
      session,
      measurer,
      producer: 'prod',
      cache: undefined,
      inlineDrawingLayoutForPart: () => ctx,
      drawingLayoutTokenForPart: () => `tok:${resourceGeneration}`,
      drawingTokenForParagraphForPart: (_partName, paragraph) =>
        paragraphDrawingLayoutTokenFromContext(paragraph as never, ctx),
    });
    const first = source.sectionFurniture()[0]!.headers.get('default')!;
    resourceGeneration = 1;
    const second = source.sectionFurniture()[0]!.headers.get('default')!;
    expect(second).not.toBe(first);
  });
});

describe('fix round 2 — resource state integration', () => {
  test('pending reserves extent, one async settle, then ready without geometry loop', async () => {
    let invalidateCount = 0;
    const deferred = deferredLookup(() => {
      invalidateCount += 1;
    });
    const part = load(documentXml(`<w:p>${run('Q')}<w:r>${inlineDrawingInner()}</w:r></w:p>`));
    const bundle = createInlineDrawingLayoutBundle({
      session: {
        part: () => part,
        currentPackage: () =>
          ({
            relationships: new Map(),
            externalTargets: [],
            parts: new Map([[OWNER, part]]),
            mainDocumentPart: OWNER,
          }) as never,
        packageRevision: () => 1,
      } as never,
      decodePort: createHeadlessImageDecodePort(),
      onResourcesChanged: () => {},
      resourceLookup: deferred.lookup,
    });
    const pendingLayout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: bundle.bodyContext,
      drawingTokenForParagraph: (p) => bundle.drawingTokenForParagraph(p, OWNER),
    });
    const pendingDrawing = linesOf(pendingLayout)[0]!.drawings![0]!;
    expect(pendingDrawing.resource.kind).toBe('pending');
    expect(pendingDrawing.height).toBeGreaterThan(0);
    deferred.settle();
    await new Promise((r) => setTimeout(r, 0));
    const readyLayout = layoutSemanticDocument(part, 2, {
      measurer,
      inlineDrawingLayout: bundle.bodyContext,
      drawingTokenForParagraph: (p) => bundle.drawingTokenForParagraph(p, OWNER),
    });
    expect(linesOf(readyLayout)[0]!.drawings![0]!.resource.kind).toBe('ready');
    expect(readyLayout.pages.length).toBe(pendingLayout.pages.length);
    expect(deferred.settledCount()).toBe(1);
    bundle.dispose();
  });

  test('disposed bundle generation cannot publish after dispose', async () => {
    const deferred = deferredLookup(() => {});
    const part = load(documentXml(`<w:p><w:r>${inlineDrawingInner()}</w:r></w:p>`));
    const bundle = createInlineDrawingLayoutBundle({
      session: {
        part: () => part,
        currentPackage: () =>
          ({
            relationships: new Map(),
            externalTargets: [],
            parts: new Map([[OWNER, part]]),
            mainDocumentPart: OWNER,
          }) as never,
        packageRevision: () => 1,
      } as never,
      decodePort: createHeadlessImageDecodePort(),
      onResourcesChanged: () => {},
      resourceLookup: deferred.lookup,
    });
    bundle.dispose();
    deferred.settle();
    await new Promise((r) => setTimeout(r, 0));
    expect(deferred.settledCount()).toBe(1);
  });
});

describe('fix round 2 — per-paragraph incremental keys', () => {
  test('resource transition invalidates only the drawing paragraph key', () => {
    const part = load(
      documentXml(
        `<w:p>${run('A')}<w:r>${inlineDrawingInner()}</w:r></w:p><w:p>${run('plain')}</w:p>`
      )
    );
    const drawingParagraph = part.root.children[0]!.children[0]!;
    const plainParagraph = part.root.children[0]!.children[1]!;
    const ctxPending = indexedContext(part, OWNER, () =>
      Object.freeze({ kind: 'pending', resourceKey: 'k' })
    );
    const ctxReady = indexedContext(part, OWNER, () => READY);
    const keyPending = paragraphLayoutKey({
      paragraph: drawingParagraph,
      properties: [],
      width: 400,
      producer: 'p',
      drawingToken: paragraphDrawingLayoutTokenFromContext(drawingParagraph as never, ctxPending),
    });
    const keyReady = paragraphLayoutKey({
      paragraph: drawingParagraph,
      properties: [],
      width: 400,
      producer: 'p',
      drawingToken: paragraphDrawingLayoutTokenFromContext(drawingParagraph as never, ctxReady),
    });
    const plainKey = paragraphLayoutKey({
      paragraph: plainParagraph,
      properties: [],
      width: 400,
      producer: 'p',
      drawingToken: paragraphDrawingLayoutTokenFromContext(plainParagraph as never, ctxReady),
    });
    expect(keyPending).not.toBe(keyReady);
    expect(plainKey).not.toContain('pending');
  });

  test('unchanged plain paragraph keeps page identity when drawing paragraph relayouts', () => {
    const session = createLayoutSession();
    const part = load(
      documentXml(
        `<w:p>${run('A')}<w:r>${inlineDrawingInner()}</w:r></w:p><w:p>${run('plain')}</w:p>`
      )
    );
    const ctx = indexedContext(part);
    const first = layoutSemanticDocument(part, 1, {
      measurer,
      session,
      inlineDrawingLayout: ctx,
      drawingTokenForParagraph: (p) => paragraphDrawingLayoutTokenFromContext(p as never, ctx),
    });
    const second = layoutSemanticDocument(part, 2, {
      measurer,
      session,
      inlineDrawingLayout: ctx,
      drawingTokenForParagraph: (p) => paragraphDrawingLayoutTokenFromContext(p as never, ctx),
    });
    expect(second.pages[0]).toBe(first.pages[0]);
  });
});

describe('fix round 2 — table vAlign shifts drawings', () => {
  test('center vAlign shifts drawing paint bounds with line boxes', () => {
    const doc = documentXml(
      '<w:tbl><w:tr><w:trPr><w:trHeight w:val="2400" w:hRule="atLeast"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>' +
        `<w:p>${run('T')}<w:r>${inlineDrawingInner()}</w:r></w:p></w:tc></w:tr></w:tbl>`
    );
    const part = load(doc);
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: indexedContext(part),
    });
    const table = layout.pages[0]!.fragments.find((f) => f.kind === 'table')!;
    const cell = table.rows[0]!.cells[0]!;
    const line = cell.blocks[0]!.lines[0]!;
    expect(line.drawings).toHaveLength(1);
    expect(line.drawings![0]!.y).toBeGreaterThan(cell.box.y);
    expect(line.box.y).toBeGreaterThan(cell.box.y);
  });
});

describe('fix round 2 — alignment tails', () => {
  test('right alignment positions drawing tail at content edge', () => {
    const part = load(
      documentXml(
        `<w:p><w:pPr><w:jc w:val="right"/></w:pPr>${run('Z')}<w:r>${inlineDrawingInner()}</w:r></w:p>`
      )
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      geometry: { width: 200, height: 400, margin: { top: 10, right: 10, bottom: 10, left: 10 } },
      inlineDrawingLayout: indexedContext(part),
    });
    const line = linesOf(layout)[0]!;
    const contentRight = layout.pages[0]!.contentBox.x + layout.pages[0]!.contentBox.width;
    expect(line.drawings![0]!.advanceEnd).toBeLessThanOrEqual(contentRight + 0.5);
    expect(line.drawings![0]!.advanceEnd).toBeGreaterThan(
      line.spans[0]!.box.x + line.spans[0]!.box.width
    );
  });

  test('center alignment still offsets drawing with text block', () => {
    const part = load(
      documentXml(
        `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${run('Z')}<w:r>${inlineDrawingInner()}</w:r></w:p>`
      )
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      geometry: { width: 200, height: 400, margin: { top: 10, right: 10, bottom: 10, left: 10 } },
      inlineDrawingLayout: indexedContext(part),
    });
    const line = linesOf(layout)[0]!;
    expect(line.spans[0]!.box.x).toBeGreaterThan(0);
    expect(line.drawings![0]!.advanceStart).toBeGreaterThan(line.spans[0]!.box.x);
  });
});
