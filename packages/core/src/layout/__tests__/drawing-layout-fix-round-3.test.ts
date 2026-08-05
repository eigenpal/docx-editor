// Fix round 3/5 — HF variant integration, resource lifecycle, pending→ready differential (task 6).

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
  type DrawingProjection,
} from '../../store/package/drawing-projection.ts';
import type {
  ImageResourceLookup,
  ImageResourceState,
} from '../../store/package/image-resources.ts';
import { mockReadyImageResource } from '../../store/__tests__/drawing-ready-fixture.ts';
import type { InlineDrawingLayoutContext, InlineDrawingRecord } from '../drawing-layout.ts';
import { createInlineDrawingLayoutBundle } from '../inline-drawing-source.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createHeadlessImageDecodePort } from '../../editor/browser-image-decode-port.ts';
import { createFurnitureSource } from '../../editor/surface-pages.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  enumerateDocumentSections,
  geometryOfSection,
  layoutSemanticDocument,
  type SemanticLayout,
} from '../index.ts';
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
const cache = createParagraphLayoutCache();

const READY = mockReadyImageResource({
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  pixelWidth: 10,
  pixelHeight: 10,
});

const EXTERNAL: ImageResourceState = Object.freeze({
  kind: 'external',
  relationshipId: 'rLink',
  sinkSafe: false,
});

const MISSING: ImageResourceState = Object.freeze({
  kind: 'missing',
  relationshipId: 'rMissing',
});

const UNRENDERABLE: ImageResourceState = Object.freeze({
  kind: 'unrenderable',
  partName: null,
  mime: 'unknown',
  reason: 'unsupported-format',
});

const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

function inlineDrawingInner(
  options: {
    readonly embed?: string;
    readonly link?: string;
    readonly extent?: string;
    readonly name?: string;
  } = {}
): string {
  const embed = options.embed ? ` r:embed="${options.embed}"` : '';
  const link = options.link ? ` r:link="${options.link}"` : '';
  const blip = embed || link ? `<a:blip${embed}${link}/>` : '<a:blip r:embed="rIdImg"/>';
  const extent = options.extent ?? 'cx="914400" cy="457200"';
  const name = options.name ?? 'pic';
  return (
    '<w:drawing>' +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent ${extent}/>` +
    `<wp:docPr id="1" name="${name}"/>` +
    '<wp:cNvGraphicFramePr/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}">` +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill>${blip}</pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    '</a:graphicData></a:graphic></wp:inline></w:drawing>'
  );
}

function hfPartXml(kind: 'hdr' | 'ftr', marker: string): string {
  return (
    `<w:${kind} xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    `<w:p>${run(marker)}<w:r>${inlineDrawingInner({ name: marker })}</w:r></w:p>` +
    `</w:${kind}>`
  );
}

function loadBody(xml: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>${xml}</w:body></w:document>`,
    {
      name: OWNER,
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function variantPackage(): Uint8Array {
  const sectPr =
    '<w:sectPr>' +
    '<w:titlePg/>' +
    '<w:headerReference w:type="default" r:id="rIdHDef"/>' +
    '<w:headerReference w:type="first" r:id="rIdHFirst"/>' +
    '<w:headerReference w:type="even" r:id="rIdHEven"/>' +
    '<w:footerReference w:type="default" r:id="rIdFDef"/>' +
    '<w:pgSz w:w="6000" w:h="2000"/>' +
    '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200" w:header="100" w:footer="100"/>' +
    '</w:sectPr>';
  const body = `<w:p>${run('Body-one')}</w:p>${pageBreak}<w:p>${run('Body-two')}</w:p>${pageBreak}<w:p>${run('Body-three')}</w:p>${sectPr}`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
        '<Override PartName="/word/header-default.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/header-first.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/header-even.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/footer-default.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        '<Relationship Id="rIdHDef" Type="' +
        R +
        '/header" Target="header-default.xml"/>' +
        '<Relationship Id="rIdHFirst" Type="' +
        R +
        '/header" Target="header-first.xml"/>' +
        '<Relationship Id="rIdHEven" Type="' +
        R +
        '/header" Target="header-even.xml"/>' +
        '<Relationship Id="rIdFDef" Type="' +
        R +
        '/footer" Target="footer-default.xml"/>' +
        '<Relationship Id="rIdSettings" Type="' +
        R +
        '/settings" Target="settings.xml"/>' +
        '</Relationships>'
    ),
    'word/settings.xml': strToU8(
      `<w:settings xmlns:w="${WML_NAMESPACE_URI}"><w:evenAndOddHeaders/></w:settings>`
    ),
    'word/header-default.xml': strToU8(hfPartXml('hdr', 'HDR-DEF')),
    'word/header-first.xml': strToU8(hfPartXml('hdr', 'HDR-FIRST')),
    'word/header-even.xml': strToU8(hfPartXml('hdr', 'HDR-EVEN')),
    'word/footer-default.xml': strToU8(hfPartXml('ftr', 'FTR-DEF')),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function drawingOfRecord(line: {
  readonly drawings?: readonly InlineDrawingRecord[];
}): InlineDrawingRecord {
  const drawing = line.drawings?.[0];
  if (!drawing) throw new Error('missing drawing');
  return drawing;
}

function drawingShapeOf(layout: SemanticLayout): string {
  return JSON.stringify(
    layout.pages.map((page) => ({
      body: page.fragments.flatMap((fragment) =>
        fragment.kind === 'paragraph'
          ? fragment.lines.flatMap((line) =>
              (line.drawings ?? []).map((drawing) => ({
                x: drawing.x,
                y: drawing.y,
                width: drawing.width,
                height: drawing.height,
                paintBounds: drawing.paintBounds,
                hitBounds: drawing.hitBounds,
                advanceStart: drawing.advanceStart,
                advanceEnd: drawing.advanceEnd,
                resource: drawing.resource,
              }))
            )
          : fragment.kind === 'table'
            ? fragment.rows.flatMap((row) =>
                row.cells.flatMap((cell) =>
                  cell.blocks.flatMap((block) =>
                    block.lines.flatMap((line) =>
                      (line.drawings ?? []).map((drawing) => ({
                        x: drawing.x,
                        y: drawing.y,
                        width: drawing.width,
                        height: drawing.height,
                        paintBounds: drawing.paintBounds,
                        hitBounds: drawing.hitBounds,
                        advanceStart: drawing.advanceStart,
                        advanceEnd: drawing.advanceEnd,
                        resource: drawing.resource,
                      }))
                    )
                  )
                )
              )
            : []
      ),
      header: page.header
        ? {
            variant: page.header.variant,
            partName: page.header.partName,
            drawings: page.header.fragments.flatMap((fragment) =>
              fragment.kind === 'paragraph'
                ? fragment.lines.flatMap((line) =>
                    (line.drawings ?? []).map((drawing) => ({
                      ownerPartName: drawing.ownerPartName,
                      resource: drawing.resource,
                    }))
                  )
                : []
            ),
          }
        : null,
      footer: page.footer
        ? {
            variant: page.footer.variant,
            partName: page.footer.partName,
            drawings: page.footer.fragments.flatMap((fragment) =>
              fragment.kind === 'paragraph'
                ? fragment.lines.flatMap((line) =>
                    (line.drawings ?? []).map((drawing) => ({
                      ownerPartName: drawing.ownerPartName,
                      resource: drawing.resource,
                    }))
                  )
                : []
            ),
          }
        : null,
    }))
  );
}

function mockSession(
  part: OoxmlPart,
  pkg: ReturnType<typeof readOoxmlPackage> extends { ok: true; package: infer P } ? P : never
) {
  let revision = 1;
  return {
    part: () => part,
    currentPackage: () => pkg,
    packageRevision: () => revision,
    bumpRevision: () => {
      revision += 1;
    },
    headerFooterPartsBySection: () => resolveHeaderFooterPartsBySection(pkg),
  };
}

function layoutWithBundle(options: {
  readonly part: OoxmlPart;
  readonly pkg: ReturnType<typeof readOoxmlPackage> extends { ok: true; package: infer P }
    ? P
    : never;
  readonly session: ReturnType<typeof mockSession>;
  readonly revision: number;
  readonly layoutSession?: ReturnType<typeof createLayoutSession>;
  readonly lookup?: ImageResourceLookup;
  readonly onResourcesChanged?: () => void;
}): {
  layout: SemanticLayout;
  bundle: ReturnType<typeof createInlineDrawingLayoutBundle>;
  furniture: ReturnType<typeof createFurnitureSource>;
} {
  const bundle = createInlineDrawingLayoutBundle({
    session: options.session as never,
    decodePort: createHeadlessImageDecodePort(),
    onResourcesChanged: options.onResourcesChanged ?? (() => {}),
    ...(options.lookup ? { resourceLookup: options.lookup } : {}),
  });
  const furniture = createFurnitureSource({
    session: options.session as never,
    measurer,
    producer: 'test',
    cache,
    inlineDrawingLayoutForPart: (partName) => bundle.contextForPart(partName),
    drawingLayoutTokenForPart: (partName) => bundle.cacheTokenForPart(partName),
    drawingTokenForParagraphForPart: (partName, paragraph) =>
      bundle.drawingTokenForParagraph(paragraph, partName),
  });
  const layout = layoutSemanticDocument(options.part, options.revision, {
    measurer,
    cache,
    ...(options.layoutSession ? { session: options.layoutSession } : {}),
    inlineDrawingLayout: bundle.bodyContext,
    drawingTokenForParagraph: (paragraph) => bundle.drawingTokenForParagraph(paragraph, OWNER),
    sectionFurniture: furniture.sectionFurniture(),
    furniture: furniture.furniture(),
  });
  return { layout, bundle, furniture };
}

function staticLookup(states: {
  readonly resolveForProjection?: () => Promise<ImageResourceState>;
  readonly resolveLinked?: () => ImageResourceState;
}): ImageResourceLookup {
  return {
    resolveEmbedded: async () => READY,
    resolveLinked: () => states.resolveLinked?.() ?? EXTERNAL,
    resolveForProjection: () => states.resolveForProjection?.() ?? Promise.resolve(READY),
    liveReferenceCount: () => 0,
    dispose: () => {},
  };
}

function bodyTextOf(layout: SemanticLayout): readonly string[] {
  return layout.pages.map((page) =>
    page.fragments
      .flatMap((fragment) =>
        fragment.kind === 'paragraph'
          ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text))
          : []
      )
      .join('')
  );
}

describe('fix round 3 — HF variant package integration', () => {
  test('default, first, even headers and default footer attach drawings on correct pages without shifting body', () => {
    const loaded = readOoxmlPackage(variantPackage());
    if (!loaded.ok) throw new Error(loaded.reason);
    const pkg = loaded.package;
    const doc = pkg.parts.get(pkg.mainDocumentPart)!;
    const session = mockSession(doc, pkg);
    const { layout, furniture } = layoutWithBundle({
      part: doc,
      pkg,
      session,
      revision: 1,
      lookup: staticLookup({ resolveForProjection: async () => READY }),
    });

    expect(layout.pages.length).toBeGreaterThanOrEqual(3);
    expect(layout.pages[0]!.header?.variant).toBe('first');
    expect(layout.pages[1]!.header?.variant).toBe('even');
    expect(layout.pages[2]!.header?.variant).toBe('default');
    expect(layout.pages[0]!.footer).toBeUndefined();
    expect(layout.pages[2]!.footer?.variant).toBe('default');

    const firstDrawing = drawingOfRecord(layout.pages[0]!.header!.fragments[0]!.lines[0]!);
    const evenDrawing = drawingOfRecord(layout.pages[1]!.header!.fragments[0]!.lines[0]!);
    const defaultDrawing = drawingOfRecord(layout.pages[2]!.header!.fragments[0]!.lines[0]!);
    const footerDrawing = drawingOfRecord(layout.pages[2]!.footer!.fragments[0]!.lines[0]!);

    expect(firstDrawing.ownerPartName).toBe('/word/header-first.xml');
    expect(evenDrawing.ownerPartName).toBe('/word/header-even.xml');
    expect(defaultDrawing.ownerPartName).toBe('/word/header-default.xml');
    expect(footerDrawing.ownerPartName).toBe('/word/footer-default.xml');
    expect(firstDrawing.resource.kind).toBe('pending');
    expect(evenDrawing.resource.kind).toBe('pending');
    expect(footerDrawing.resource.kind).toBe('pending');

    const bodyOnly = layoutSemanticDocument(doc, 2, {
      measurer,
      cache,
      sectionFurniture: furniture.sectionFurniture(),
      furniture: furniture.furniture(),
    });
    expect(bodyTextOf(layout)).toEqual(bodyTextOf(bodyOnly));
  });
});

describe('fix round 3 — resource lifecycle through bundle + layout', () => {
  async function layoutDrawingResource(options: {
    readonly part: OoxmlPart;
    readonly lookup: ImageResourceLookup;
    readonly warm?: boolean;
  }): Promise<InlineDrawingRecord> {
    const pkg = {
      relationships: new Map(),
      externalTargets: [],
      parts: new Map([[OWNER, options.part]]),
      mainDocumentPart: OWNER,
    } as never;
    const session = mockSession(options.part, pkg);
    const bundle = createInlineDrawingLayoutBundle({
      session: session as never,
      decodePort: createHeadlessImageDecodePort(),
      onResourcesChanged: () => {},
      resourceLookup: options.lookup,
    });
    if (options.warm) {
      const projection = indexInlineDrawingProjectionsInPart(options.part).values().next()
        .value as DrawingProjection;
      bundle.bodyContext.resourceOf(projection);
      await new Promise((r) => setTimeout(r, 0));
    }
    const layout = layoutSemanticDocument(options.part, 1, {
      measurer,
      cache,
      inlineDrawingLayout: bundle.bodyContext,
      drawingTokenForParagraph: (paragraph) => bundle.drawingTokenForParagraph(paragraph, OWNER),
    });
    bundle.dispose();
    return linesOf(layout)[0]!.drawings![0]!;
  }

  test('ready embedded reserves authored geometry and publishes ready after cache warm', async () => {
    const part = loadBody(`<w:p>${run('Q')}<w:r>${inlineDrawingInner()}</w:r></w:p>`);
    const drawing = await layoutDrawingResource({
      part,
      warm: true,
      lookup: staticLookup({ resolveForProjection: async () => READY }),
    });
    expect(drawing.width).toBeCloseTo(72, 3);
    expect(drawing.height).toBeCloseTo(36, 3);
    expect(drawing.resource).toEqual(READY);
  });

  test('linked external/missing resolve synchronously with identical geometry', async () => {
    for (const [label, state] of [
      ['external', EXTERNAL],
      ['missing', MISSING],
    ] as const) {
      const part = loadBody(
        `<w:p>${run('Q')}<w:r>${inlineDrawingInner({ link: 'rIdLink' })}</w:r></w:p>`
      );
      const drawing = await layoutDrawingResource({
        part,
        lookup: staticLookup({ resolveLinked: () => state }),
      });
      expect(drawing.width).toBeCloseTo(72, 3);
      expect(drawing.height).toBeCloseTo(36, 3);
      expect(drawing.resource).toEqual(state);
    }
  });

  test('unrenderable embedded publishes after async resolve with identical geometry', async () => {
    const part = loadBody(`<w:p>${run('Q')}<w:r>${inlineDrawingInner()}</w:r></w:p>`);
    const drawing = await layoutDrawingResource({
      part,
      warm: true,
      lookup: staticLookup({ resolveForProjection: async () => UNRENDERABLE }),
    });
    expect(drawing.resource).toEqual(UNRENDERABLE);
    expect(drawing.width).toBeCloseTo(72, 3);
  });

  test('pending embedded reserves geometry before settle', async () => {
    const part = loadBody(`<w:p>${run('Q')}<w:r>${inlineDrawingInner()}</w:r></w:p>`);
    let resolveDeferred: ((state: ImageResourceState) => void) | null = null;
    const drawing = await layoutDrawingResource({
      part,
      lookup: {
        resolveEmbedded: async () => READY,
        resolveLinked: () => EXTERNAL,
        resolveForProjection: () =>
          new Promise((resolve) => {
            resolveDeferred = resolve;
          }),
        liveReferenceCount: () => 0,
        dispose: () => {},
      },
    });
    expect(drawing.resource.kind).toBe('pending');
    expect(drawing.height).toBeCloseTo(36, 3);
    resolveDeferred?.(READY);
    await new Promise((r) => setTimeout(r, 0));
  });

  test('pending settles with exactly one onResourcesChanged callback and one resource transition', async () => {
    const part = loadBody(`<w:p>${run('Q')}<w:r>${inlineDrawingInner()}</w:r></w:p>`);
    const pkg = {
      relationships: new Map(),
      externalTargets: [],
      parts: new Map([[OWNER, part]]),
      mainDocumentPart: OWNER,
    } as never;
    const session = mockSession(part, pkg);
    let callbacks = 0;
    let resolveDeferred: ((state: ImageResourceState) => void) | null = null;
    const lookup: ImageResourceLookup = {
      resolveEmbedded: async () => READY,
      resolveLinked: () => EXTERNAL,
      resolveForProjection: () =>
        new Promise((resolve) => {
          resolveDeferred = resolve;
        }),
      liveReferenceCount: () => 0,
      dispose: () => {},
    };
    const bundle = createInlineDrawingLayoutBundle({
      session: session as never,
      decodePort: createHeadlessImageDecodePort(),
      onResourcesChanged: () => {
        callbacks += 1;
      },
      resourceLookup: lookup,
    });
    const before = bundle.bodyContext.resourceOf(
      indexInlineDrawingProjectionsInPart(part).values().next().value as DrawingProjection
    );
    expect(before.kind).toBe('pending');
    resolveDeferred?.(READY);
    await new Promise((r) => setTimeout(r, 0));
    expect(callbacks).toBe(1);
    const after = bundle.bodyContext.resourceOf(
      indexInlineDrawingProjectionsInPart(part).values().next().value as DrawingProjection
    );
    expect(after.kind).toBe('ready');
    expect(after).toEqual(READY);
    bundle.dispose();
  });

  test('stale generation: dispose before settle publishes no callback or resource mutation', async () => {
    const part = loadBody(`<w:p>${run('Q')}<w:r>${inlineDrawingInner()}</w:r></w:p>`);
    const pkg = {
      relationships: new Map(),
      externalTargets: [],
      parts: new Map([[OWNER, part]]),
      mainDocumentPart: OWNER,
    } as never;
    const session = mockSession(part, pkg);
    let callbacks = 0;
    let resolveDeferred: ((state: ImageResourceState) => void) | null = null;
    const lookup: ImageResourceLookup = {
      resolveEmbedded: async () => READY,
      resolveLinked: () => EXTERNAL,
      resolveForProjection: () =>
        new Promise((resolve) => {
          resolveDeferred = resolve;
        }),
      liveReferenceCount: () => 0,
      dispose: () => {},
    };
    const bundle = createInlineDrawingLayoutBundle({
      session: session as never,
      decodePort: createHeadlessImageDecodePort(),
      onResourcesChanged: () => {
        callbacks += 1;
      },
      resourceLookup: lookup,
    });
    const projection = indexInlineDrawingProjectionsInPart(part).values().next()
      .value as DrawingProjection;
    expect(bundle.bodyContext.resourceOf(projection).kind).toBe('pending');
    bundle.dispose();
    resolveDeferred?.(READY);
    await new Promise((r) => setTimeout(r, 0));
    expect(callbacks).toBe(0);
  });

  test('stale generation: package reset before settle publishes no callback', async () => {
    const part = loadBody(`<w:p>${run('Q')}<w:r>${inlineDrawingInner()}</w:r></w:p>`);
    const pkg = {
      relationships: new Map(),
      externalTargets: [],
      parts: new Map([[OWNER, part]]),
      mainDocumentPart: OWNER,
    } as never;
    const session = mockSession(part, pkg);
    let callbacks = 0;
    let resolveDeferred: ((state: ImageResourceState) => void) | null = null;
    const lookup: ImageResourceLookup = {
      resolveEmbedded: async () => READY,
      resolveLinked: () => EXTERNAL,
      resolveForProjection: () =>
        new Promise((resolve) => {
          resolveDeferred = resolve;
        }),
      liveReferenceCount: () => 0,
      dispose: () => {},
    };
    const bundle = createInlineDrawingLayoutBundle({
      session: session as never,
      decodePort: createHeadlessImageDecodePort(),
      onResourcesChanged: () => {
        callbacks += 1;
      },
      resourceLookup: lookup,
    });
    bundle.bodyContext.resourceOf(
      indexInlineDrawingProjectionsInPart(part).values().next().value as DrawingProjection
    );
    session.bumpRevision();
    bundle.sync(session as never);
    resolveDeferred?.(READY);
    await new Promise((r) => setTimeout(r, 0));
    expect(callbacks).toBe(0);
  });
});

describe('fix round 3 — pending→ready differential layout', () => {
  test('incremental relayout after ready matches clean full layout; unrelated pages stay stable', async () => {
    const part = loadBody(
      `<w:p>${run('A')}<w:r>${inlineDrawingInner()}</w:r></w:p>` + `<w:p>${run('plain')}</w:p>`
    );
    const pkg = {
      relationships: new Map(),
      externalTargets: [],
      parts: new Map([[OWNER, part]]),
      mainDocumentPart: OWNER,
    } as never;
    const session = mockSession(part, pkg);
    const layoutSession = createLayoutSession();
    const readyLookup = staticLookup({ resolveForProjection: async () => READY });

    const clean = layoutWithBundle({
      part,
      pkg,
      session,
      revision: 1,
      layoutSession: createLayoutSession(),
      lookup: readyLookup,
    }).layout;

    let resolveDeferred: ((state: ImageResourceState) => void) | null = null;
    const pendingLookup: ImageResourceLookup = {
      resolveEmbedded: async () => READY,
      resolveLinked: () => EXTERNAL,
      resolveForProjection: () =>
        new Promise((resolve) => {
          resolveDeferred = resolve;
        }),
      liveReferenceCount: () => 0,
      dispose: () => {},
    };
    const pendingPass = layoutWithBundle({
      part,
      pkg,
      session,
      revision: 2,
      layoutSession,
      lookup: pendingLookup,
    });
    expect(pendingPass.layout.pages[0]!.fragments[1]).toBeDefined();
    resolveDeferred?.(READY);
    await new Promise((r) => setTimeout(r, 0));

    const incremental = layoutWithBundle({
      part,
      pkg,
      session,
      revision: 3,
      layoutSession,
      lookup: staticLookup({ resolveForProjection: async () => READY }),
    }).layout;

    expect(drawingShapeOf(incremental)).toBe(drawingShapeOf(clean));
    expect(incremental.pages[1]).toBe(pendingPass.layout.pages[1]);
  });

  test('no-change pass preserves page identity when drawing tokens unchanged', () => {
    const layoutSession = createLayoutSession();
    const part = loadBody(`<w:p>${run('plain')}</w:p>`);
    const pkg = {
      relationships: new Map(),
      externalTargets: [],
      parts: new Map([[OWNER, part]]),
      mainDocumentPart: OWNER,
    } as never;
    const session = mockSession(part, pkg);
    const lookup = staticLookup({});
    const first = layoutWithBundle({
      part,
      pkg,
      session,
      revision: 1,
      layoutSession,
      lookup,
    }).layout;
    const second = layoutWithBundle({
      part,
      pkg,
      session,
      revision: 2,
      layoutSession,
      lookup,
    }).layout;
    expect(second.pages[0]).toBe(first.pages[0]);
  });
});

describe('fix round 3 — table vAlign center and bottom shift drawings once', () => {
  function tableWithVAlign(vAlign: 'center' | 'bottom') {
    return loadBody(
      '<w:tbl><w:tr><w:trPr><w:trHeight w:val="3600" w:hRule="atLeast"/></w:trPr>' +
        `<w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/><w:vAlign w:val="${vAlign}"/></w:tcPr>` +
        `<w:p>${run('T')}<w:r>${inlineDrawingInner()}</w:r></w:p></w:tc></w:tr></w:tbl>`
    );
  }

  function topAlignedLayout(vAlign: 'center' | 'bottom') {
    const part = tableWithVAlign(vAlign);
    const ctx: InlineDrawingLayoutContext = {
      ownerPartName: OWNER,
      projectionForAtom: (id) => indexInlineDrawingProjectionsInPart(part).get(id) ?? null,
      project: (node) =>
        indexInlineDrawingProjectionsInPart(part).get(node.id) ??
        projectDrawing(node, { ownerPartName: OWNER, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
      resourceOf: () => READY,
    };
    return layoutSemanticDocument(part, 1, { measurer, inlineDrawingLayout: ctx });
  }

  test('center and bottom vAlign shift paint/hit/advance together without double shift', () => {
    for (const vAlign of ['center', 'bottom'] as const) {
      const aligned = topAlignedLayout(vAlign);
      const top = layoutSemanticDocument(tableWithVAlign('top'), 1, {
        measurer,
        inlineDrawingLayout: {
          ownerPartName: OWNER,
          projectionForAtom: (id) =>
            indexInlineDrawingProjectionsInPart(tableWithVAlign('top')).get(id) ?? null,
          project: (node) =>
            projectDrawing(node, {
              ownerPartName: OWNER,
              limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
            }),
          resourceOf: () => READY,
        },
      });
      const alignedTable = aligned.pages[0]!.fragments.find((f) => f.kind === 'table')!;
      const topTable = top.pages[0]!.fragments.find((f) => f.kind === 'table')!;
      const alignedLine = alignedTable.rows[0]!.cells[0]!.blocks[0]!.lines[0]!;
      const topLine = topTable.rows[0]!.cells[0]!.blocks[0]!.lines[0]!;
      const alignedDrawing = alignedLine.drawings![0]!;
      const topDrawing = topLine.drawings![0]!;
      const dyLine = alignedLine.box.y - topLine.box.y;
      const dyDrawing = alignedDrawing.y - topDrawing.y;
      expect(dyDrawing).toBeCloseTo(dyLine, 3);
      expect(alignedDrawing.paintBounds.y - topDrawing.paintBounds.y).toBeCloseTo(dyLine, 3);
      expect(alignedDrawing.hitBounds.y - topDrawing.hitBounds.y).toBeCloseTo(dyLine, 3);
      expect(alignedDrawing.advanceStart - topDrawing.advanceStart).toBeCloseTo(0, 3);
      expect(alignedDrawing.advanceEnd - topDrawing.advanceEnd).toBeCloseTo(0, 3);
      if (vAlign === 'bottom') {
        expect(dyLine).toBeGreaterThan(dyLine > 0 ? 1 : 0);
        expect(alignedDrawing.y).toBeGreaterThan(topDrawing.y);
      }
    }
  });
});
