// Task 10 fix round 1 — paint URL port, HF layers, transform/clip, hyperlinks, i18n.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import { mockReadyImageResource } from '../../store/__tests__/drawing-ready-fixture.ts';
import { mintValidatedImageBytes } from '../../store/package/validated-image-bytes.ts';
import type { ValidatedImageBytesHandle } from '../../store/package/image-resources.ts';
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
  type AnchoredDrawingRecord,
  type InlineDrawingRecord,
} from '../../layout/drawing-layout.ts';
import {
  computeDrawingGeometry,
  computeXfrmPageMapping,
  sourceExtentFrame,
} from '../../layout/drawing-geometry.ts';
import { EMU_PER_POINT } from '../../layout/drawing-layout.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { layoutHeaderFooterStory } from '../../layout/hf-layout.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';
import { createBrowserPaintImageUrlPort } from '../../editor/browser-paint-image-url-port.ts';
import { drawingLinkByIdFromLayout } from '../../editor/drawing-link-index.ts';
import {
  DEFAULT_DRAWING_PAINT_STRINGS,
  drawingPaintStringsFromTranslate,
  paintDrawingRecord,
} from '../semantic-paint-drawings.ts';

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

const READY_PNG = mockReadyImageResource({ bytes: PNG_BYTES });

function inlinePictureXml(
  options: {
    readonly extent?: string;
    readonly rot?: string;
    readonly flipH?: boolean;
    readonly flipV?: boolean;
    readonly crop?: string;
    readonly preset?: string;
    readonly lum?: string;
    readonly grayscale?: boolean;
    readonly hlink?: string;
  } = {}
): string {
  const extent = options.extent ?? 'cx="914400" cy="457200"';
  const rot = options.rot ? ` rot="${options.rot}"` : '';
  const flipH = options.flipH ? ' flipH="1"' : '';
  const flipV = options.flipV ? ' flipV="1"' : '';
  const srcRect = options.crop ?? '';
  const preset = options.preset ?? 'rect';
  const lum = options.lum ?? '';
  const grayscale = options.grayscale ? '<a:grayscl/>' : '';
  const hlink = options.hlink ? `<a:hlinkClick xmlns:r="${R}" r:id="${options.hlink}"/>` : '';
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    '<w:body><w:p><w:r><w:drawing>' +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent ${extent}/>` +
    '<wp:docPr id="1" name="Picture 1"/>' +
    '<wp:cNvGraphicFramePr/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}">` +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    `<pic:blipFill><a:blip r:embed="rId14">${grayscale}${lum}</a:blip><a:srcRect ${srcRect}/>` +
    `<a:stretch/></pic:blipFill>` +
    `<pic:spPr><a:xfrm${rot}${flipH}${flipV}><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm>` +
    `<a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>${hlink}</pic:spPr>` +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>'
  );
}

function load(xml: string, name = OWNER): OoxmlPart {
  const result = readOoxmlPart(xml, {
    name,
    contentType: name.includes('header')
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'
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
    resolveRelationship: (id) =>
      id === 'rIdSafe'
        ? { target: 'https://example.com/safe', external: true }
        : id === 'rIdBad'
          ? { target: 'javascript:alert(1)', external: true }
          : null,
  })!;
  const height = emuToPoints(projection.extentEmu.cy);
  return buildInlineDrawingRecord({
    input: {
      drawingNodeId: projection.drawingNodeId,
      ownerPartName: OWNER,
      projection,
      resource: READY_PNG,
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

describe('fix round 1 — browser PaintImageUrlPort lifecycle', () => {
  test('mints one blob URL per ready key from snapshotted bytes', () => {
    const snapshot = new Uint8Array(PNG_BYTES);
    const resource = mockReadyImageResource({ bytes: snapshot });
    const port = createBrowserPaintImageUrlPort({
      mintValidatedBytes: (handle, expected) => mintValidatedImageBytes(handle, expected),
    })!;
    const first = port.create(resource.validatedHandle, 'image/png');
    const second = port.create(resource.validatedHandle, 'image/png');
    expect(first).toMatch(/^blob:/);
    expect(second).toMatch(/^blob:/);
    expect(first).not.toBe(second);
    port.revoke(first);
    port.revoke(second);
  });

  test('revoke clears URL and does not expose mutable cache bytes to consumers', () => {
    const snapshot = new Uint8Array(PNG_BYTES);
    const resource = mockReadyImageResource({ bytes: snapshot });
    const port = createBrowserPaintImageUrlPort({
      mintValidatedBytes: (handle, expected) => mintValidatedImageBytes(handle, expected),
    })!;
    const revoked: string[] = [];
    const trackingPort = {
      create: (handle: ValidatedImageBytesHandle, mime: 'image/png' | 'image/jpeg' | 'image/gif') =>
        port.create(handle, mime),
      revoke: (url: string) => {
        revoked.push(url);
        port.revoke(url);
      },
    };
    snapshot[0] = 0;
    const element = paintDrawingRecord(
      document,
      readyInline(),
      { scale: 1, strings: DEFAULT_DRAWING_PAINT_STRINGS, imageUrlPort: trackingPort },
      {
        urlForReady: (handle, mime) => trackingPort.create(handle, mime),
        reconcile: () => {},
        revokeAll: () => {},
      }
    )!;
    const url = element.querySelector('img')!.getAttribute('src');
    expect(url).toMatch(/^blob:/);
    trackingPort.revoke(url!);
    expect(revoked).toContain(url);
  });
});

describe('fix round 1 — transform and clip coordinate correctness', () => {
  test('90° non-square maps bbox through one Task8 xfrm mapping', () => {
    const transform = Object.freeze({
      rotationDegrees: 90,
      flipHorizontal: false,
      flipVertical: false,
      offsetEmu: Object.freeze({ x: 0, y: 0 }),
      extentEmu: Object.freeze({ cx: 40 * EMU_PER_POINT, cy: 20 * EMU_PER_POINT }),
    });
    const frame = sourceExtentFrame(transform, 40, 20);
    const mapping = computeXfrmPageMapping({
      sourceWidth: frame.width,
      sourceHeight: frame.height,
      offsetX: frame.offsetX,
      offsetY: frame.offsetY,
      transform,
      layoutWidth: 40,
      layoutHeight: 20,
      anchorX: 0,
      anchorY: 0,
    });
    expect(mapping.scaleX).toBeCloseTo(2, 1);
    expect(mapping.scaleY).toBeCloseTo(0.5, 1);
    const geometry = computeDrawingGeometry({
      extentWidth: 40,
      extentHeight: 20,
      anchorX: 0,
      anchorY: 0,
      effectExtentEmu: { top: 0, right: 0, bottom: 0, left: 0 },
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      transform,
      presetGeometry: 'rect',
    });
    const element = paintDrawingRecord(
      document,
      Object.freeze({
        ...readyInline({ rot: '5400000' }),
        geometry,
        paintBounds: geometry.paintBounds,
        transform,
      }),
      {
        scale: 1,
        strings: DEFAULT_DRAWING_PAINT_STRINGS,
        imageUrlPort: { create: () => 'blob:test', revoke: () => {} },
      },
      { urlForReady: () => 'blob:test', reconcile: () => {}, revokeAll: () => {} }
    )!;
    expect(element.style.clipPath).toMatch(/^polygon\(/);
    const frameEl = element.querySelector('.docx-drawing-image-frame') as HTMLElement;
    expect(frameEl.style.transform).toBe('');
  });

  test('flip+crop applies clip on wrapper and flip on transform stage only', () => {
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
    expect(stage.style.transform).toMatch(/^matrix\(/);
    const img = element.querySelector('img') as HTMLImageElement;
    expect(img.style.transform).toBe('');
    expect(img.style.width).toBe('200%');
    expect(img.style.left).toBe('-50%');
    expect(img.style.position).toBe('absolute');
  });

  test('transformed ellipse clip lives on outer wrapper bounds', () => {
    const drawing = readyInline({ preset: 'ellipse', rot: '2700000' });
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
    expect(parseFloat(element.style.width)).toBeCloseTo(drawing.paintBounds.width, 3);
    expect(parseFloat(element.style.height)).toBeCloseTo(drawing.paintBounds.height, 3);
  });
});

describe('fix round 1 — header/footer anchored drawing paint layers', () => {
  function anchorCore(behindDoc: boolean): string {
    return (
      `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="${behindDoc ? '1' : '0'}" locked="0" layoutInCell="1" allowOverlap="1">` +
      '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
      '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
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
      resourceOf: () => READY_PNG,
    };
  }

  test('paints HF anchored drawing behind text layer with owner geometry and aria', () => {
    const headerPart = load(
      `<w:hdr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
        `<w:p><w:r><w:t>HF</w:t></w:r><w:r><w:drawing>${anchorCore(true)}</w:drawing></w:r></w:p></w:hdr>`,
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
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, {
      scale: 1,
      imageUrlPort: { create: () => 'blob:hf', revoke: () => {} },
      ariaHidden: false,
    });
    const hf = container.querySelector('[data-docx-hf="header"]') as HTMLElement;
    expect(hf).not.toBeNull();
    const pageBehind = container.querySelector(
      '.docx-page > .docx-drawing-layer-behind .docx-drawing-ready'
    ) as HTMLElement;
    expect(pageBehind).not.toBeNull();
    expect(pageBehind.getAttribute('aria-label')).toBe('Watermark');
    expect(hf.querySelector('.docx-drawing-ready')).toBeNull();
    expect(parseFloat(hf.style.height)).toBeCloseTo(layout.pages[0]!.header!.box.height, 1);
  });

  test('watermark grayscale/lum paints filter without flow-height inflation', () => {
    const drawing = readyInline({
      lum: '<a:lum bright="-40000" contrast="-70000"/>',
      grayscale: true,
    });
    const layout = {
      revision: 1,
      pages: [
        Object.freeze({
          index: 0,
          box: Object.freeze({ x: 0, y: 0, width: 612, height: 792 }),
          contentBox: Object.freeze({ x: 72, y: 72, width: 468, height: 648 }),
          fragments: [
            Object.freeze({
              kind: 'paragraph' as const,
              paragraphId: 'p1',
              fragmentIndex: 0,
              box: Object.freeze({ x: 72, y: 72, width: 468, height: 20 }),
              lines: [
                Object.freeze({
                  id: 'l1',
                  box: Object.freeze({ x: 72, y: 72, width: 468, height: 20 }),
                  range: Object.freeze({ paragraphId: 'p1', start: 0, end: 1 }),
                  spans: [],
                  drawings: [drawing],
                }),
              ],
            }),
          ],
        }),
      ],
    };
    const container = document.createElement('div');
    paintSemanticLayout(
      container,
      layout as import('@docx-editor.dev/core-contract/layout').SemanticLayout,
      {
        scale: 1,
        imageUrlPort: { create: () => 'blob:wm', revoke: () => {} },
      }
    );
    const frame = container.querySelector('.docx-drawing-image-frame') as HTMLElement;
    expect(frame.style.filter).toContain('grayscale(1)');
    expect(container.querySelector('.docx-page-content')!.style.height).not.toBe('0px');
  });
});

describe('fix round 1 — drawing hyperlink projection', () => {
  test('drawingLinkById resolves ready and placeholder links across relayout', () => {
    const safe = Object.freeze({
      ...readyInline(),
      hyperlinkHref: 'https://example.com/safe' as string | null,
    });
    const layout1 = {
      revision: 1,
      pages: [
        Object.freeze({
          index: 0,
          box: Object.freeze({ x: 0, y: 0, width: 600, height: 800 }),
          contentBox: Object.freeze({ x: 0, y: 0, width: 600, height: 700 }),
          fragments: [
            Object.freeze({
              kind: 'paragraph' as const,
              paragraphId: 'p1',
              fragmentIndex: 0,
              box: Object.freeze({ x: 0, y: 0, width: 600, height: 50 }),
              lines: [
                Object.freeze({
                  id: 'l1',
                  box: Object.freeze({ x: 0, y: 0, width: 600, height: 50 }),
                  range: Object.freeze({ paragraphId: 'p1', start: 0, end: 1 }),
                  spans: [],
                  drawings: [safe],
                }),
              ],
            }),
          ],
        }),
      ],
    };
    const link = drawingLinkByIdFromLayout(
      layout1 as import('@docx-editor.dev/core-contract/layout').SemanticLayout,
      safe.drawingNodeId
    );
    expect(link?.href).toBe('https://example.com/safe');
    expect(link?.kind).toBe('external');

    const unsafe = Object.freeze({ ...readyInline(), hyperlinkHref: null as string | null });
    const layout2 = {
      ...layout1,
      revision: 2,
      pages: [
        Object.freeze({
          ...layout1.pages[0]!,
          fragments: [
            Object.freeze({
              ...layout1.pages[0]!.fragments[0]!,
              lines: [
                Object.freeze({
                  ...layout1.pages[0]!.fragments[0]!.lines[0]!,
                  drawings: [unsafe],
                }),
              ],
            }),
          ],
        }),
      ],
    };
    expect(
      drawingLinkByIdFromLayout(
        layout2 as import('@docx-editor.dev/core-contract/layout').SemanticLayout,
        unsafe.drawingNodeId
      )
    ).toBeNull();
  });
});

describe('fix round 1 — production i18n strings', () => {
  test('drawingPaintStringsFromTranslate interpolates format and falls back only without provider', () => {
    const de = drawingPaintStringsFromTranslate((key, params) => {
      if (key === 'image.unsupportedFormat')
        return `Nicht unterstütztes Bildformat (${params?.format})`;
      if (key === 'image.externalResource') return 'Externes Bild nicht geladen';
      return `missing:${key}`;
    });
    const drawing = buildInlineDrawingRecord({
      input: {
        drawingNodeId: 'd-tiff',
        ownerPartName: OWNER,
        projection: projectDrawing(drawingOf(load(inlinePictureXml())), {
          ownerPartName: OWNER,
          limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
        })!,
        resource: Object.freeze({
          kind: 'unrenderable',
          partName: '/word/media/x.tif',
          mime: 'image/tiff',
          reason: 'unsupported-format',
        }),
      },
      paragraphId: 'p1',
      start: 0,
      slotX: 0,
      y: 0,
      baseline: 50,
      contentLeft: 0,
      contentRight: 600,
    });
    const localized = paintDrawingRecord(document, drawing, { scale: 1, strings: de }, null)!;
    expect(localized.textContent).toBe('Nicht unterstütztes Bildformat (TIFF)');
    const english = paintDrawingRecord(
      document,
      drawing,
      { scale: 1, strings: DEFAULT_DRAWING_PAINT_STRINGS },
      null
    )!;
    expect(english.textContent).toBe('Unsupported image format (TIFF)');
  });

  test('locale string change invalidates paint parameters via externalResource token', () => {
    const en = drawingPaintStringsFromTranslate(() => 'Loading image');
    const de = drawingPaintStringsFromTranslate(() => 'Bild wird geladen');
    expect(en.pendingResource).not.toBe(de.pendingResource);
  });
});
