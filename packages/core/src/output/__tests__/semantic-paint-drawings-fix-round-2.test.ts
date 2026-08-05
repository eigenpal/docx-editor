// Task 10 fix round 2 — TOCTOU handle, xfrm paint matrix, HF page layer, openExternal sink, i18n.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { sha256FontBytes } from '../../layout/font-resource.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../../store/package/image-resources.ts';
import {
  registerValidatedImageBytes,
  clearValidatedImageBytesRegistry,
  mintValidatedImageBytes,
} from '../../store/package/validated-image-bytes.ts';
import {
  WML_NAMESPACE_URI,
  readOoxmlPart,
  type OoxmlDrawingNode,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import {
  buildAnchoredDrawingRecord,
  buildInlineDrawingRecord,
  emuToPoints,
  type InlineDrawingRecord,
} from '../../layout/drawing-layout.ts';
import {
  computeDrawingGeometry,
  cssTransformForDrawingImage,
  sourceExtentFrame,
} from '../../layout/drawing-geometry.ts';
import { EMU_PER_POINT } from '../../layout/drawing-layout.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { layoutHeaderFooterStory } from '../../layout/hf-layout.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';
import { createBrowserPaintImageUrlPort } from '../../editor/browser-paint-image-url-port.ts';
import { createSurfaceNavigation } from '../../editor/surface-navigation.ts';
import {
  DEFAULT_DRAWING_PAINT_STRINGS,
  drawingPaintStringsCacheToken,
  drawingPaintStringsFromTranslate,
  paintDrawingRecord,
} from '../semantic-paint-drawings.ts';
import { createInlineDrawingLayoutBundle } from '../../layout/inline-drawing-source.ts';
import { createHeadlessImageDecodePort } from '../../editor/browser-image-decode-port.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const OWNER = '/word/document.xml';

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function readyResource(bytes: Uint8Array): ImageResourceState {
  const contentId = sha256FontBytes(bytes);
  const key = `${OWNER}\0/word/media/image1.png\0${contentId}`;
  return Object.freeze({
    kind: 'ready',
    partName: '/word/media/image1.png',
    contentId,
    resourceKey: key,
    validatedHandle: registerValidatedImageBytes(key, contentId, bytes),
    mime: 'image/png',
    pixelWidth: 1,
    pixelHeight: 1,
    dpiX: 96,
    dpiY: 96,
  });
}

function readyPng(): ImageResourceState {
  return readyResource(new Uint8Array(PNG_BYTES));
}

function parseMatrix(transform: string): readonly [number, number, number, number, number, number] {
  const match = /matrix\(([^)]+)\)/.exec(transform);
  expect(match).not.toBeNull();
  const parts = match![1]!.split(',').map((part) => Number.parseFloat(part.trim()));
  expect(parts).toHaveLength(6);
  return parts as [number, number, number, number, number, number];
}

function inlinePictureXml(
  options: {
    readonly extent?: string;
    readonly rot?: string;
    readonly flipH?: boolean;
    readonly flipV?: boolean;
    readonly crop?: string;
  } = {}
): string {
  const extent = options.extent ?? 'cx="914400" cy="457200"';
  const rot = options.rot ? ` rot="${options.rot}"` : '';
  const flipH = options.flipH ? ' flipH="1"' : '';
  const flipV = options.flipV ? ' flipV="1"' : '';
  const srcRect = options.crop ?? '';
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    '<w:body><w:p><w:r><w:drawing>' +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent ${extent}/>` +
    '<wp:docPr id="1" name="Picture 1"/>' +
    '<wp:cNvGraphicFramePr/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}">` +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    `<pic:blipFill><a:blip r:embed="rId14"/><a:srcRect ${srcRect}/>` +
    `<a:stretch/></pic:blipFill>` +
    `<pic:spPr><a:xfrm${rot}${flipH}${flipV}><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm>` +
    `<a:prstGeom prst="rect"/></pic:spPr>` +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>'
  );
}

function load(xml: string, name = OWNER): OoxmlPart {
  const result = readOoxmlPart(xml, {
    name,
    contentType: name.includes('header')
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'
      : name.includes('footer')
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function drawingOf(part: OoxmlPart): OoxmlDrawingNode {
  const stack: import('../../store/package/ooxml-tree.ts').OoxmlElement[] = [part.root];
  while (stack.length > 0) {
    const node = stack.shift()!;
    if (node.kind === 'drawing') return node;
    for (const child of node.children) {
      if (child.kind !== 'textValue') stack.push(child);
    }
  }
  throw new Error('missing drawing');
}

function readyInline(options: Parameters<typeof inlinePictureXml>[0] = {}): InlineDrawingRecord {
  const projection = projectDrawing(drawingOf(load(inlinePictureXml(options))), {
    ownerPartName: OWNER,
    limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
  })!;
  const height = emuToPoints(projection.extentEmu.cy);
  return buildInlineDrawingRecord({
    input: {
      drawingNodeId: projection.drawingNodeId,
      ownerPartName: OWNER,
      projection,
      resource: readyPng(),
    },
    paragraphId: 'p1',
    start: 0,
    slotX: 0,
    y: 0,
    baseline: height,
    contentLeft: 0,
    contentRight: 600,
  });
}

describe('fix round 2 — validated-byte TOCTOU', () => {
  test('mint rejects stale contentId after package mutation between resolve and paint', () => {
    clearValidatedImageBytesRegistry();
    const original = new Uint8Array(PNG_BYTES);
    const resource = readyResource(original);
    const port = createBrowserPaintImageUrlPort({
      mintValidatedBytes: (handle, expected) => mintValidatedImageBytes(handle, expected),
    })!;
    const url = port.create(resource.validatedHandle, 'image/png');
    expect(url).toMatch(/^blob:/);

    original[0] = 0xff;
    expect(mintValidatedImageBytes(resource.validatedHandle, resource.contentId)).not.toBeNull();
    expect(
      mintValidatedImageBytes(
        resource.validatedHandle,
        sha256FontBytes(new Uint8Array([0xff, ...PNG_BYTES.slice(1)]))
      )
    ).toBeNull();

    const mutatedBytes = new Uint8Array(PNG_BYTES);
    mutatedBytes[mutatedBytes.length - 1] ^= 0xff;
    const staleHandle = resource.validatedHandle;
    expect(mintValidatedImageBytes(staleHandle, sha256FontBytes(mutatedBytes))).toBeNull();
    port.revoke(url);
  });

  test('bundle mintValidatedBytes refuses handle/contentId mismatch after live swap', async () => {
    clearValidatedImageBytesRegistry();
    const part = load(inlinePictureXml());
    const bytes = new Uint8Array(PNG_BYTES);
    const contentId = sha256FontBytes(bytes);
    const resourceKey = `${OWNER}\0/word/media/image1.png\0${contentId}`;
    const ready = Object.freeze({
      kind: 'ready' as const,
      partName: '/word/media/image1.png',
      contentId,
      resourceKey,
      validatedHandle: registerValidatedImageBytes(resourceKey, contentId, bytes),
      mime: 'image/png' as const,
      pixelWidth: 1,
      pixelHeight: 1,
      dpiX: 96,
      dpiY: 96,
    });
    const bundle = createInlineDrawingLayoutBundle({
      session: {
        part: () => part,
        currentPackage: () =>
          ({
            relationships: new Map(),
            externalTargets: [],
            parts: new Map([[OWNER, part]]),
            mainDocumentPart: OWNER,
            partBytes: new Map([['/word/media/image1.png', bytes]]),
          }) as never,
        packageRevision: () => 1,
      } as never,
      decodePort: createHeadlessImageDecodePort(),
      onResourcesChanged: () => {},
      resourceLookup: {
        resolveEmbedded: async () => ready,
        resolveLinked: () => Object.freeze({ kind: 'missing' as const, relationshipId: 'x' }),
        resolveForProjection: async () => ready,
        liveReferenceCount: () => 0,
        dispose: () => {},
      },
    });
    const atom = indexInlineDrawingProjectionsInPart(part).values().next().value!;
    expect(bundle.bodyContext.resourceOf(atom).kind).toBe('pending');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const settled = bundle.bodyContext.resourceOf(atom);
    expect(settled.kind).toBe('ready');
    if (settled.kind !== 'ready') throw new Error('expected ready');
    expect(bundle.mintValidatedBytes(settled.validatedHandle, settled.contentId)).not.toBeNull();
    bytes[0] ^= 0xff;
    expect(bundle.mintValidatedBytes(settled.validatedHandle, settled.contentId)).not.toBeNull();
    expect(bundle.mintValidatedBytes(settled.validatedHandle, sha256FontBytes(bytes))).toBeNull();
    bundle.dispose();
  });
});

describe('fix round 2 — Task 8 pixel affine transform', () => {
  test('90° non-square emits a non-trivial matrix on the image element', () => {
    const drawing = readyInline({ rot: '5400000' });
    const element = paintDrawingRecord(
      document,
      drawing,
      {
        scale: 1,
        strings: DEFAULT_DRAWING_PAINT_STRINGS,
        imageUrlPort: {
          create: (handle) =>
            createBrowserPaintImageUrlPort({
              mintValidatedBytes: (h, id) => mintValidatedImageBytes(h, id),
            })!.create(handle, 'image/png'),
          revoke: () => {},
        },
      },
      {
        urlForReady: (handle, mime) =>
          createBrowserPaintImageUrlPort({
            mintValidatedBytes: (h, id) => mintValidatedImageBytes(h, id),
          })!.create(handle, mime),
        reconcile: () => {},
        revokeAll: () => {},
      }
    )!;
    const stage = element.querySelector('.docx-drawing-transform-stage') as HTMLElement;
    expect(stage.style.transform).toMatch(/^matrix\(/);
    const [a, b, c, d] = parseMatrix(stage.style.transform);
    expect(Math.abs(b)).toBeGreaterThanOrEqual(0.5);
    expect(Math.abs(c)).toBeGreaterThanOrEqual(0.5);
    expect(Math.abs(a)).toBeLessThan(0.01);
    expect(Math.abs(d)).toBeLessThan(0.01);
    expect(element.style.clipPath).toMatch(/^polygon\(/);
  });

  test('45° rotation matrix is not axis-aligned scale-only', () => {
    const transform = Object.freeze({
      rotationDegrees: 45,
      flipHorizontal: false,
      flipVertical: false,
      offsetEmu: Object.freeze({ x: 0, y: 0 }),
      extentEmu: Object.freeze({ cx: 40 * EMU_PER_POINT, cy: 20 * EMU_PER_POINT }),
    });
    const frame = sourceExtentFrame(transform, 40, 20);
    const matrix = cssTransformForDrawingImage({
      transform,
      contentWidth: frame.width,
      contentHeight: frame.height,
    });
    expect(matrix).toMatch(/^matrix\(/);
    const [a, b, c, d] = parseMatrix(matrix!);
    expect(Math.abs(b)).toBeGreaterThan(0.05);
    expect(Math.abs(c)).toBeGreaterThan(0.05);
  });

  test('flip+crop keeps clip on wrapper and matrix on transform stage', () => {
    const drawing = readyInline({
      flipH: true,
      crop: 'l="25000" t="0" r="25000" b="0"',
    });
    const element = paintDrawingRecord(
      document,
      drawing,
      {
        scale: 1,
        strings: DEFAULT_DRAWING_PAINT_STRINGS,
        imageUrlPort: { create: () => 'blob:test', revoke: () => {} },
      },
      { urlForReady: () => 'blob:test', reconcile: () => {}, revokeAll: () => {} }
    )!;
    expect(element.style.clipPath).toMatch(/^polygon\(/);
    const stage = element.querySelector('.docx-drawing-transform-stage') as HTMLElement;
    const img = element.querySelector('img') as HTMLImageElement;
    expect(stage.style.transform).toMatch(/^matrix\(/);
    expect(img.style.transform).toBe('');
    expect(img.style.width).toBe('200%');
  });
});

describe('fix round 2 — HF page-relative paint layer', () => {
  function anchorCore(
    options: {
      readonly behindDoc?: boolean;
      readonly posOffsetY?: number;
      readonly positionV?: string;
    } = {}
  ): string {
    const posV =
      options.positionV ??
      `<wp:positionV relativeFrom="page"><wp:posOffset>${options.posOffsetY ?? 0}</wp:posOffset></wp:positionV>`;
    return (
      `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="${options.behindDoc ? '1' : '0'}" locked="0" layoutInCell="1" allowOverlap="1">` +
      '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
      `${posV}` +
      `<wp:extent cx="914400" cy="457200"/><wp:wrapNone/><wp:docPr id="2" descr="Watermark"/>` +
      `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      '</pic:pic></a:graphicData></a:graphic></wp:anchor>'
    );
  }

  function layoutContext(part: OoxmlPart, owner: string) {
    const atomProjections = indexInlineDrawingProjectionsInPart(part);
    return {
      ownerPartName: owner,
      projectionForAtom: (atomId: string) => atomProjections.get(atomId) ?? null,
      project: (node: OoxmlDrawingNode) =>
        projectDrawing(node, { ownerPartName: owner, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
      resourceOf: () => readyPng(),
    };
  }

  test('tall page-relative header watermark paints outside clipped HF story box', () => {
    const headerPart = load(
      `<w:hdr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
        `<w:p><w:r><w:t>HF</w:t></w:r><w:r><w:drawing>${anchorCore({ behindDoc: true, posOffsetY: 0 })}</w:drawing></w:r></w:p></w:hdr>`,
      '/word/header1.xml'
    );
    const headerStory = layoutHeaderFooterStory(
      headerPart,
      468,
      createFixedMeasurer(6, 14),
      'prod',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      layoutContext(headerPart, '/word/header1.xml'),
      undefined,
      undefined,
      {
        pageNumber: 1,
        pageWidth: 612,
        pageHeight: 792,
        marginLeft: 72,
        marginRight: 72,
        marginTop: 72,
        marginBottom: 72,
      }
    );
    const bodyPart = load(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p><w:r><w:t>body</w:t></w:r></w:p></w:body></w:document>`
    );
    const layout = layoutSemanticDocument(bodyPart, 1, {
      measurer: createFixedMeasurer(6, 14),
      inlineDrawingLayout: layoutContext(bodyPart, OWNER),
      furniture: {
        titlePage: false,
        evenAndOddHeaders: false,
        headers: new Map([['default', headerStory]]),
        footers: new Map(),
      },
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
    expect(layout.pages[0]!.header!.anchoredDrawings?.length).toBeGreaterThan(0);
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, {
      scale: 1,
      imageUrlPort: {
        create: () => 'blob:hf',
        revoke: () => {},
      } as import('../semantic-paint-drawings.ts').PaintImageUrlPort,
    });
    const page = container.querySelector('.docx-page') as HTMLElement;
    const hf = page.querySelector('.docx-hf') as HTMLElement;
    const pageBehind = page.querySelector(
      ':scope > .docx-drawing-layer-behind .docx-drawing-ready'
    ) as HTMLElement | null;
    void pageBehind;
    expect(hf.querySelector('.docx-drawing-ready')).toBeNull();
    expect(parseFloat(hf.style.height)).toBeCloseTo(layout.pages[0]!.header!.box.height, 1);
    const pageLayers = page.querySelectorAll(':scope > .docx-drawing-layer-behind');
    const hfPageLayer = [...pageLayers].find((layer) => layer.querySelector('.docx-drawing-ready'));
    expect(hfPageLayer).not.toBeUndefined();
    const painted = hfPageLayer!.querySelector('.docx-drawing-ready') as HTMLElement;
    expect(Number.parseFloat(painted.style.top)).toBeLessThan(Number.parseFloat(hf.style.top));
  });

  test('page-relative footer anchor preserves inFront layer outside HF box', () => {
    const footerPart = load(
      `<w:ftr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
        `<w:p><w:r><w:drawing>${anchorCore({ behindDoc: false, posOffsetY: 914400 })}</w:drawing></w:r></w:p></w:ftr>`,
      '/word/footer1.xml'
    );
    const footerStory = layoutHeaderFooterStory(
      footerPart,
      468,
      createFixedMeasurer(6, 14),
      'prod',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      layoutContext(footerPart, '/word/footer1.xml'),
      undefined,
      undefined,
      {
        pageNumber: 1,
        pageWidth: 612,
        pageHeight: 792,
        marginLeft: 72,
        marginRight: 72,
        marginTop: 72,
        marginBottom: 72,
      }
    );
    const bodyPart = load(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p><w:r><w:t>body</w:t></w:r></w:p></w:body></w:document>`
    );
    const layout = layoutSemanticDocument(bodyPart, 1, {
      measurer: createFixedMeasurer(6, 14),
      inlineDrawingLayout: layoutContext(bodyPart, OWNER),
      furniture: {
        titlePage: false,
        evenAndOddHeaders: false,
        headers: new Map(),
        footers: new Map([['default', footerStory]]),
      },
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, {
      scale: 1,
      imageUrlPort: { create: () => 'blob:ft', revoke: () => {} },
    });
    const page = container.querySelector('.docx-page') as HTMLElement;
    const hf = page.querySelector('.docx-hf') as HTMLElement;
    const front = page.querySelector(
      ':scope > .docx-drawing-layer-front .docx-drawing-ready'
    ) as HTMLElement;
    expect(front).not.toBeNull();
    expect(hf.querySelector('.docx-drawing-layer-front .docx-drawing-ready')).toBeNull();
    const pageFrontLayers = page.querySelectorAll(':scope > .docx-drawing-layer-front');
    const hfFrontLayer = [...pageFrontLayers].find((layer) =>
      layer.querySelector('.docx-drawing-ready')
    );
    expect(hfFrontLayer).not.toBeUndefined();
  });
});

describe('fix round 2 — openExternal sanitizeHref sink', () => {
  test('re-sanitizes at sink: javascript/control chars refused, https allowed', () => {
    const pagesLayer = document.createElement('div');
    const container = document.createElement('div');
    container.append(pagesLayer);
    document.body.append(container);
    const opened: string[] = [];
    const nav = createSurfaceNavigation({
      pagesLayer,
      container,
      scale: 1,
      layout: () => ({ revision: 0, pages: [] }),
      bookmarks: () => new Map(),
      linkById: () => null,
      setSelection: () => {},
      isCollapsedSelection: () => true,
    });
    const originalOpen = window.open;
    window.open = ((href: string) => {
      opened.push(href);
      return null;
    }) as typeof window.open;

    expect(nav.openExternal('javascript:alert(1)')).toBe(false);
    expect(nav.openExternal('https://example.com/safe')).toBe(true);
    expect(nav.openExternal('java\nscript:alert(1)')).toBe(false);
    expect(opened).toEqual(['https://example.com/safe']);

    nav.destroy();
    container.remove();
    window.open = originalOpen;
  });
});

describe('fix round 2 — drawing i18n cache token', () => {
  test('drawingPaintStringsCacheToken changes for every localized output', () => {
    const en = drawingPaintStringsFromTranslate((key, params) => {
      if (key === 'image.unsupportedFormat') return `Unsupported (${params?.format})`;
      if (key === 'image.pendingResource') return 'Loading image';
      return key;
    });
    const de = drawingPaintStringsFromTranslate((key, params) => {
      if (key === 'image.unsupportedFormat') return `Nicht unterstützt (${params?.format})`;
      if (key === 'image.pendingResource') return 'Bild wird geladen';
      return key;
    });
    expect(drawingPaintStringsCacheToken(en)).not.toBe(drawingPaintStringsCacheToken(de));
  });

  test('non-English pending label appears in painted placeholder', () => {
    const de = drawingPaintStringsFromTranslate((key) => {
      if (key === 'image.pendingResource') return 'Bild wird geladen';
      return key;
    });
    const drawing = buildInlineDrawingRecord({
      input: {
        drawingNodeId: 'd-pending',
        ownerPartName: OWNER,
        projection: projectDrawing(drawingOf(load(inlinePictureXml())), {
          ownerPartName: OWNER,
          limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
        })!,
        resource: Object.freeze({ kind: 'pending', resourceKey: 'pending:key' }),
      },
      paragraphId: 'p1',
      start: 0,
      slotX: 0,
      y: 0,
      baseline: 50,
      contentLeft: 0,
      contentRight: 600,
    });
    const element = paintDrawingRecord(document, drawing, { scale: 1, strings: de }, null)!;
    expect(element.textContent).toBe('Bild wird geladen');
  });
});
