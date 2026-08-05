// Drawing paint DOM contract (typed-drawings-and-images task 10).

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import type {
  ImageResourceState,
  ValidatedImageBytesHandle,
} from '../../store/package/image-resources.ts';
import { mockReadyImageResource } from '../../store/__tests__/drawing-ready-fixture.ts';
import {
  WML_NAMESPACE_URI,
  readOoxmlPart,
  type OoxmlDrawingNode,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import {
  buildInlineDrawingRecord,
  emuToPoints,
  type InlineDrawingRecord,
} from '../../layout/drawing-layout.ts';
import { computeDrawingGeometry } from '../../layout/drawing-geometry.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';
import {
  DEFAULT_DRAWING_PAINT_STRINGS,
  paintDrawingRecord,
  type PaintImageUrlPort,
} from '../semantic-paint-drawings.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const OWNER = '/word/document.xml';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const READY_PNG = mockReadyImageResource({
  bytes: PNG_BYTES,
  pixelWidth: 400,
  pixelHeight: 200,
});

function fakeUrlPort(): {
  readonly port: PaintImageUrlPort;
  readonly created: Map<string, string>;
  readonly revoked: string[];
} {
  const created = new Map<string, string>();
  const revoked: string[] = [];
  const port: PaintImageUrlPort = {
    create(handle, mime) {
      const url = `blob:fake/${mime}/${handle.resourceKey}`;
      created.set(handle.resourceKey, url);
      return url;
    },
    revoke(url) {
      revoked.push(url);
    },
  };
  return { port, created, revoked };
}

function inlinePictureXml(
  options: {
    readonly extent?: string;
    readonly descr?: string;
    readonly title?: string;
    readonly hidden?: boolean;
    readonly crop?: string;
    readonly rot?: string;
    readonly flipH?: boolean;
    readonly flipV?: boolean;
    readonly lum?: string;
    readonly grayscale?: boolean;
    readonly preset?: string;
  } = {}
): string {
  const extent = options.extent ?? 'cx="914400" cy="457200"';
  const hidden = options.hidden ? ' hidden="1"' : '';
  const descr = options.descr !== undefined ? ` descr="${options.descr}"` : '';
  const title = options.title !== undefined ? ` title="${options.title}"` : '';
  const srcRect = options.crop ?? '';
  const rot = options.rot ? ` rot="${options.rot}"` : '';
  const flipH = options.flipH ? ' flipH="1"' : '';
  const flipV = options.flipV ? ' flipV="1"' : '';
  const lum = options.lum ?? '';
  const grayscale = options.grayscale ? '<a:grayscl/>' : '';
  const preset = options.preset ?? 'rect';
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    '<w:body><w:p><w:r><w:drawing>' +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent ${extent}/>` +
    `<wp:docPr id="1" name="Picture 1"${descr}${title}${hidden}/>` +
    '<wp:cNvGraphicFramePr/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}">` +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    `<pic:blipFill><a:blip r:embed="rId14">${grayscale}${lum}</a:blip><a:srcRect ${srcRect}/>` +
    `<a:stretch/></pic:blipFill>` +
    `<pic:spPr><a:xfrm${rot}${flipH}${flipV}><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm>` +
    `<a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom></pic:spPr>` +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>'
  );
}

function load(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, {
    name: OWNER,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
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

function readyRecordFromXml(
  xml: string,
  resource: ImageResourceState = READY_PNG
): InlineDrawingRecord {
  const part = load(xml);
  const projection = projectDrawing(drawingOf(part), {
    ownerPartName: OWNER,
    limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
  })!;
  const width = emuToPoints(projection.extentEmu.cx);
  const height = emuToPoints(projection.extentEmu.cy);
  return buildInlineDrawingRecord({
    input: {
      drawingNodeId: projection.drawingNodeId,
      ownerPartName: OWNER,
      projection,
      resource,
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

function paintRecord(
  drawing: InlineDrawingRecord,
  port: PaintImageUrlPort | undefined
): HTMLElement {
  const { port: urlPort, created } = fakeUrlPort();
  const usePort = port ?? urlPort;
  const registry = {
    urlForReady: (
      handle: ValidatedImageBytesHandle,
      mime: 'image/png' | 'image/jpeg' | 'image/gif'
    ) => usePort.create(handle, mime),
    reconcile: () => {},
    revokeAll: () => {},
  };
  return paintDrawingRecord(
    document,
    drawing,
    {
      scale: 1,
      strings: DEFAULT_DRAWING_PAINT_STRINGS,
      ...(usePort ? { imageUrlPort: usePort } : {}),
    },
    registry,
    Object.freeze({ x: 0, y: 0, width: 600, height: 800 })
  )!;
}

describe('paints validated raster records', () => {
  test('ready PNG receives a host object URL and authored dimensions', () => {
    const { port, created } = fakeUrlPort();
    const drawing = readyRecordFromXml(inlinePictureXml());
    const element = paintRecord(drawing, port);
    expect(element.classList.contains('docx-drawing-ready')).toBe(true);
    const img = element.querySelector('img.docx-drawing-image') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe(created.get(READY_PNG.resourceKey));
    expect(element.style.width).toBe(`${drawing.paintBounds.width}px`);
    expect(element.style.height).toBe(`${drawing.paintBounds.height}px`);
  });

  test('reuses the same object URL for the same resource key', () => {
    const { port, created } = fakeUrlPort();
    const drawing = readyRecordFromXml(inlinePictureXml());
    const first = paintRecord(drawing, port);
    const second = paintRecord(drawing, port);
    const url = created.get(READY_PNG.resourceKey);
    expect(first.querySelector('img')!.getAttribute('src')).toBe(url);
    expect(second.querySelector('img')!.getAttribute('src')).toBe(url);
    expect(created.size).toBe(1);
  });

  test('applies rotation through outer clip and matrix on transform stage', () => {
    const drawing = readyRecordFromXml(
      inlinePictureXml({ rot: '5400000', flipH: true, flipV: true })
    );
    const element = paintRecord(drawing, fakeUrlPort().port);
    expect(element.style.clipPath).toMatch(/^polygon\(/);
    const frame = element.querySelector('.docx-drawing-image-frame') as HTMLElement;
    expect(frame.style.transform).toBe('');
    expect(frame.style.clipPath).toBe('');
    const stage = element.querySelector('.docx-drawing-transform-stage') as HTMLElement;
    expect(stage.style.transform).toMatch(/^matrix\(/);
    const img = element.querySelector('img') as HTMLImageElement;
    expect(img.style.transform).toBe('');
  });

  test('applies srcRect crop through image sizing', () => {
    const drawing = readyRecordFromXml(
      inlinePictureXml({ crop: 'l="25000" t="10000" r="25000" b="10000"' })
    );
    const element = paintRecord(drawing, fakeUrlPort().port);
    const img = element.querySelector('img') as HTMLImageElement;
    expect(img.style.width).toBe('200%');
    expect(img.style.height).toBe('125%');
    expect(img.style.left).toBe('-50%');
    expect(img.style.top).toBe('-12.5%');
    expect(img.style.position).toBe('absolute');
  });

  test('applies ellipse preset clip path on outer wrapper', () => {
    const drawing = readyRecordFromXml(inlinePictureXml({ preset: 'ellipse' }));
    const element = paintRecord(drawing, fakeUrlPort().port);
    expect(element.style.clipPath).toMatch(/^polygon\(/);
    const frame = element.querySelector('.docx-drawing-image-frame') as HTMLElement;
    expect(frame.style.clipPath).toBe('');
  });

  test('applies lum and grayscale as CSS filter', () => {
    const drawing = readyRecordFromXml(
      inlinePictureXml({
        lum: '<a:lum bright="-40000" contrast="-70000"/>',
        grayscale: true,
      })
    );
    const element = paintRecord(drawing, fakeUrlPort().port);
    const frame = element.querySelector('.docx-drawing-image-frame') as HTMLElement;
    expect(frame.style.filter).toContain('grayscale(1)');
    expect(frame.style.filter).toContain('brightness(');
    expect(frame.style.filter).toContain('contrast(');
  });

  test('uses descr for aria-label and never name', () => {
    const drawing = readyRecordFromXml(
      inlinePictureXml({ descr: 'Company logo', title: 'Logo title' })
    );
    const element = paintRecord(drawing, fakeUrlPort().port);
    expect(element.getAttribute('role')).toBe('img');
    expect(element.getAttribute('aria-label')).toBe('Company logo');
  });

  test('falls back to title when descr is absent', () => {
    const drawing = readyRecordFromXml(inlinePictureXml({ title: 'Banner title' }));
    const element = paintRecord(drawing, fakeUrlPort().port);
    expect(element.getAttribute('aria-label')).toBe('Banner title');
  });

  test('decorative drawing is aria-hidden', () => {
    const drawing = readyRecordFromXml(inlinePictureXml());
    const element = paintRecord(drawing, fakeUrlPort().port);
    expect(element.getAttribute('aria-hidden')).toBe('true');
  });

  test('hidden drawing paints nothing', () => {
    const drawing = readyRecordFromXml(inlinePictureXml({ hidden: true }));
    const element = paintDrawingRecord(
      document,
      drawing,
      { scale: 1, strings: DEFAULT_DRAWING_PAINT_STRINGS, imageUrlPort: fakeUrlPort().port },
      null
    );
    expect(element).toBeNull();
  });
});

describe('paints non-fetching refusal cards', () => {
  test('unsupported TIFF never calls the URL port or assigns src', () => {
    const { port, created } = fakeUrlPort();
    const projection = projectDrawing(drawingOf(load(inlinePictureXml())), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    const drawing = buildInlineDrawingRecord({
      input: {
        drawingNodeId: projection.drawingNodeId,
        ownerPartName: OWNER,
        projection,
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
    const element = paintDrawingRecord(
      document,
      drawing,
      { scale: 1, strings: DEFAULT_DRAWING_PAINT_STRINGS, imageUrlPort: port },
      null
    )!;
    expect(element.classList.contains('docx-drawing-placeholder')).toBe(true);
    expect(element.querySelector('img')).toBeNull();
    expect(created.size).toBe(0);
    expect(element.textContent).toBe('Unsupported image format (TIFF)');
    expect(element.innerHTML).not.toContain('tif');
  });

  test('external relationship paints localized card without fetch', () => {
    const drawing = buildInlineDrawingRecord({
      input: {
        drawingNodeId: 'd-ext',
        ownerPartName: OWNER,
        projection: projectDrawing(drawingOf(load(inlinePictureXml())), {
          ownerPartName: OWNER,
          limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
        })!,
        resource: Object.freeze({
          kind: 'external',
          relationshipId: 'rId99',
          sinkSafe: true,
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
    const element = paintDrawingRecord(
      document,
      drawing,
      { scale: 1, strings: DEFAULT_DRAWING_PAINT_STRINGS },
      null
    )!;
    expect(element.textContent).toBe('External image not loaded');
    expect(element.querySelector('img')).toBeNull();
  });

  test('pending resource paints loading placeholder without URL port call', () => {
    const { port, created } = fakeUrlPort();
    const drawing = buildInlineDrawingRecord({
      input: {
        drawingNodeId: 'd-pending',
        ownerPartName: OWNER,
        projection: projectDrawing(drawingOf(load(inlinePictureXml())), {
          ownerPartName: OWNER,
          limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
        })!,
        resource: Object.freeze({ kind: 'pending', resourceKey: 'pending-key' }),
      },
      paragraphId: 'p1',
      start: 0,
      slotX: 0,
      y: 0,
      baseline: 50,
      contentLeft: 0,
      contentRight: 600,
    });
    paintDrawingRecord(
      document,
      drawing,
      { scale: 1, strings: DEFAULT_DRAWING_PAINT_STRINGS, imageUrlPort: port },
      null
    );
    expect(created.size).toBe(0);
  });

  test('non-picture graphic reserves extent with honest label', () => {
    const chartXml =
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:r="${R}">` +
      '<w:body><w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="914400" cy="457200"/><wp:docPr id="2" name="Chart 1"/>' +
      '<wp:cNvGraphicFramePr/>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
      '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>' +
      '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>';
    const part = load(chartXml);
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    const drawing = buildInlineDrawingRecord({
      input: {
        drawingNodeId: projection.drawingNodeId,
        ownerPartName: OWNER,
        projection,
        resource: Object.freeze({
          kind: 'unrenderable',
          partName: null,
          mime: 'unknown',
          reason: 'non-picture-graphic',
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
    const element = paintDrawingRecord(
      document,
      drawing,
      { scale: 1, strings: DEFAULT_DRAWING_PAINT_STRINGS },
      null
    )!;
    expect(element.style.width).toBe(`${drawing.paintBounds.width}px`);
    expect(element.textContent).toBe('Unsupported graphic (graphic)');
  });
});

describe('paintSemanticLayout drawing integration', () => {
  test('inline drawing appears in painted line when layout publishes it', () => {
    const part = load(inlinePictureXml());
    const layout = layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
      inlineDrawingLayout: {
        ownerPartName: OWNER,
        project: (node) =>
          projectDrawing(node, {
            ownerPartName: OWNER,
            limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
          }),
        resourceOf: () => READY_PNG,
      },
    });
    const { port } = fakeUrlPort();
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1, imageUrlPort: port, ariaHidden: false });
    expect(
      container.querySelector('.docx-drawing-ready, .docx-drawing-placeholder')
    ).not.toBeNull();
  });

  test('a repaint reuses the same <img> element, so the decode survives a keystroke', () => {
    const part = load(inlinePictureXml());
    const layout = layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
      inlineDrawingLayout: {
        ownerPartName: OWNER,
        project: (node) =>
          projectDrawing(node, {
            ownerPartName: OWNER,
            limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
          }),
        resourceOf: () => READY_PNG,
      },
    });
    const { port } = fakeUrlPort();
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1, imageUrlPort: port, ariaHidden: false });
    const first = container.querySelector('img.docx-drawing-image');
    expect(first).not.toBeNull();
    const firstSrc = first!.getAttribute('src');
    paintSemanticLayout(container, layout, { scale: 1, imageUrlPort: port, ariaHidden: false });
    const second = container.querySelector('img.docx-drawing-image');
    expect(second).toBe(first as never);
    expect(second!.getAttribute('src')).toBe(firstSrc as never);
  });
});

describe('URL port lifecycle', () => {
  test('revokes URLs when resource keys drop out of layout', () => {
    const { port, revoked } = fakeUrlPort();
    const container = document.createElement('div');
    const drawing = readyRecordFromXml(inlinePictureXml());
    const geometry = computeDrawingGeometry({
      extentWidth: drawing.width,
      extentHeight: drawing.height,
      anchorX: 0,
      anchorY: 0,
      effectExtentEmu: { top: 0, right: 0, bottom: 0, left: 0 },
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      transform: drawing.transform,
      presetGeometry: 'rect',
    });
    void geometry;
    const layout = {
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
              box: Object.freeze({ x: 0, y: 0, width: 600, height: 100 }),
              lines: [
                Object.freeze({
                  id: 'l1',
                  box: Object.freeze({ x: 0, y: 0, width: 600, height: 50 }),
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
    paintSemanticLayout(
      container,
      layout as import('@docx-editor.dev/core-contract/layout').SemanticLayout,
      {
        scale: 1,
        imageUrlPort: port,
      }
    );
    expect(revoked.length).toBe(0);
    paintSemanticLayout(
      container,
      {
        revision: 2,
        pages: [{ ...layout.pages[0]!, fragments: [] }],
      } as import('@docx-editor.dev/core-contract/layout').SemanticLayout,
      { scale: 1, imageUrlPort: port }
    );
    expect(revoked.length).toBe(1);
  });
});
