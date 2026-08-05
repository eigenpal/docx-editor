// Drawing paint dispatch (typed-drawings-and-images task 10).
//
// Trust boundary: every string is file-derived or host-supplied through i18n callbacks.
// DOM is built with createElement/setAttribute/textContent only; styles use validated numbers
// or fixed tokens — never raw authored markup or unescaped file-derived CSS.

import type {
  SupportedImageMime,
  ValidatedImageBytesHandle,
} from '../store/package/image-resources.ts';
import type { AnchoredDrawingRecord, InlineDrawingRecord } from '../layout/drawing-layout.ts';
import type { DrawingPoint } from '../layout/drawing-geometry.ts';
import { cssTransformForDrawingImage } from '../layout/drawing-geometry.ts';
import type {
  LayoutBox,
  ParagraphFragmentRecord,
  TableFragmentRecord,
} from '../layout/semantic-records.ts';
import type { SemanticLayout } from '@docx-editor.dev/core-contract/layout';
import { paintLayerOf } from '../layout/drawing-exclusion.ts';

/** Host port for safe blob URLs — only called for {@link ImageResourceState.kind} `ready`. */
export interface PaintImageUrlPort {
  create(handle: ValidatedImageBytesHandle, mime: SupportedImageMime): string;
  revoke(url: string): void;
}

/** Localized refusal labels; adapters supply i18n-backed implementations. */
export interface DrawingPaintStrings {
  readonly unsupportedFormat: (format: string) => string;
  readonly nonPictureGraphic: (kind: string) => string;
  readonly missingResource: string;
  readonly externalResource: string;
  readonly invalidResource: string;
  readonly contentMismatch: string;
  readonly decodeFailed: string;
  readonly resourceLimit: string;
  readonly pendingResource: string;
}

export interface DrawingPaintContext {
  readonly scale: number;
  readonly strings: DrawingPaintStrings;
  readonly imageUrlPort?: PaintImageUrlPort;
  readonly inertLinks?: boolean;
}

const MIME_FORMAT_LABEL: Readonly<Record<string, string>> = Object.freeze({
  'image/svg+xml': 'SVG',
  'image/tiff': 'TIFF',
  'image/x-emf': 'EMF',
  'image/x-wmf': 'WMF',
  unknown: 'Unknown',
});

interface UrlRegistry {
  readonly urlForReady: (
    handle: ValidatedImageBytesHandle,
    mime: SupportedImageMime
  ) => string | null;
  readonly reconcile: (usedKeys: ReadonlySet<string>) => void;
  readonly revokeAll: () => void;
}

const urlRegistries = new WeakMap<object, UrlRegistry>();

export function drawingUrlRegistryFor(
  container: HTMLElement,
  port: PaintImageUrlPort
): UrlRegistry {
  let registry = urlRegistries.get(container);
  if (registry) return registry;
  const urlsByKey = new Map<string, string>();
  registry = Object.freeze({
    urlForReady(handle: ValidatedImageBytesHandle, mime: SupportedImageMime): string | null {
      const existing = urlsByKey.get(handle.resourceKey);
      if (existing) return existing;
      const url = port.create(handle, mime);
      urlsByKey.set(handle.resourceKey, url);
      return url;
    },
    reconcile(usedKeys: ReadonlySet<string>): void {
      for (const [key, url] of urlsByKey) {
        if (usedKeys.has(key)) continue;
        port.revoke(url);
        urlsByKey.delete(key);
      }
    },
    revokeAll(): void {
      for (const url of urlsByKey.values()) port.revoke(url);
      urlsByKey.clear();
    },
  });
  urlRegistries.set(container, registry);
  return registry;
}

export function detachDrawingUrlRegistry(container: HTMLElement): void {
  const registry = urlRegistries.get(container);
  registry?.revokeAll();
  urlRegistries.delete(container);
}

function finiteStyle(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(value);
}

function cssClipPathFromPolygon(
  polygon: readonly DrawingPoint[],
  bounds: LayoutBox
): string | null {
  if (polygon.length < 3 || bounds.width <= 0 || bounds.height <= 0) return null;
  const parts: string[] = [];
  for (const point of polygon) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const px = ((point.x - bounds.x) / bounds.width) * 100;
    const py = ((point.y - bounds.y) / bounds.height) * 100;
    parts.push(`${finiteStyle(px)}% ${finiteStyle(py)}%`);
  }
  return `polygon(${parts.join(', ')})`;
}

/** Pixel transform — xfrm affine into wp:extent; crop stays inside the transform stage. */
function imagePaintTransformStyle(
  drawing: InlineDrawingRecord | AnchoredDrawingRecord
): string | undefined {
  const content = drawing.geometry.contentBounds;
  return cssTransformForDrawingImage({
    transform: drawing.transform,
    contentWidth: content.width,
    contentHeight: content.height,
  });
}

function filterStyleOf(drawing: InlineDrawingRecord | AnchoredDrawingRecord): string | undefined {
  const { effects } = drawing;
  const parts: string[] = [];
  if (effects.grayscale) parts.push('grayscale(1)');
  if (effects.brightness !== 0 && Number.isFinite(effects.brightness)) {
    const factor = 1 + effects.brightness / 100;
    if (Number.isFinite(factor)) parts.push(`brightness(${finiteStyle(Math.max(0, factor))})`);
  }
  if (effects.contrast !== 0 && Number.isFinite(effects.contrast)) {
    const factor = 1 + effects.contrast / 100;
    if (Number.isFinite(factor)) parts.push(`contrast(${finiteStyle(Math.max(0, factor))})`);
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function cropImageStyles(
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  resource: Extract<InlineDrawingRecord['resource'], { kind: 'ready' }>
): {
  readonly width: string;
  readonly height: string;
  readonly left: string;
  readonly top: string;
} {
  const { crop } = drawing;
  const left = Math.max(0, Math.min(1, crop.left));
  const top = Math.max(0, Math.min(1, crop.top));
  const right = Math.max(0, Math.min(1, crop.right));
  const bottom = Math.max(0, Math.min(1, crop.bottom));
  const visibleW = Math.max(0.000_1, 1 - left - right);
  const visibleH = Math.max(0.000_1, 1 - top - bottom);
  void resource;
  return Object.freeze({
    width: `${finiteStyle((1 / visibleW) * 100)}%`,
    height: `${finiteStyle((1 / visibleH) * 100)}%`,
    left: `${finiteStyle((-left / visibleW) * 100)}%`,
    top: `${finiteStyle((-top / visibleH) * 100)}%`,
  });
}

function refusalLabel(
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  strings: DrawingPaintStrings
): string {
  const { resource } = drawing;
  switch (resource.kind) {
    case 'external':
      return strings.externalResource;
    case 'missing':
      return strings.missingResource;
    case 'pending':
      return strings.pendingResource;
    case 'unrenderable':
      switch (resource.reason) {
        case 'unsupported-format':
          return strings.unsupportedFormat(
            MIME_FORMAT_LABEL[resource.mime] ?? MIME_FORMAT_LABEL.unknown
          );
        case 'non-picture-graphic':
          return strings.nonPictureGraphic(drawing.placeholderGraphicKind ?? 'graphic');
        case 'signature-mismatch':
          return strings.contentMismatch;
        case 'decode-failed':
          return strings.decodeFailed;
        case 'resource-limit':
          return strings.resourceLimit;
        default:
          return strings.invalidResource;
      }
    default:
      return strings.invalidResource;
  }
}

function applyAccessibility(
  element: HTMLElement,
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  interactive: boolean
): void {
  const { accessibility } = drawing;
  if (accessibility.hidden) return;
  element.setAttribute('role', interactive ? 'link' : 'img');
  if (accessibility.label) {
    element.setAttribute('aria-label', accessibility.label);
  } else if (!interactive) {
    element.setAttribute('aria-hidden', 'true');
  }
}

function positionedBox(
  element: HTMLElement,
  box: LayoutBox,
  scale: number,
  origin?: LayoutBox
): void {
  const ox = origin?.x ?? 0;
  const oy = origin?.y ?? 0;
  element.style.position = 'absolute';
  element.style.left = `${(box.x - ox) * scale}px`;
  element.style.top = `${(box.y - oy) * scale}px`;
  element.style.width = `${box.width * scale}px`;
  element.style.height = `${box.height * scale}px`;
  element.style.boxSizing = 'border-box';
  element.style.overflow = 'hidden';
  element.style.pointerEvents = 'auto';
}

function paintPlaceholderCard(
  document: Document,
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  ctx: DrawingPaintContext,
  origin?: LayoutBox
): HTMLElement {
  const outer = document.createElement('div');
  outer.className = 'docx-drawing docx-drawing-placeholder';
  outer.dataset.drawingNodeId = drawing.drawingNodeId;
  positionedBox(outer, drawing.paintBounds, ctx.scale, origin);

  const card = document.createElement('div');
  card.className = 'docx-drawing-placeholder-card';
  const label = document.createElement('span');
  label.className = 'docx-drawing-placeholder-label';
  label.textContent = refusalLabel(drawing, ctx.strings);
  card.append(label);
  outer.append(card);

  if (drawing.hyperlinkHref && !ctx.inertLinks) {
    outer.dataset.docxDrawingLink = drawing.drawingNodeId;
    outer.dataset.docxDrawingLinkKind = 'external';
    outer.dataset.docxDrawingLinkHref = drawing.hyperlinkHref;
    outer.setAttribute('tabindex', '-1');
    applyAccessibility(outer, drawing, true);
  } else {
    applyAccessibility(outer, drawing, false);
  }
  return outer;
}

function paintReadyImage(
  document: Document,
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  ctx: DrawingPaintContext,
  url: string,
  origin?: LayoutBox
): HTMLElement {
  const resource = drawing.resource;
  if (resource.kind !== 'ready') {
    return paintPlaceholderCard(document, drawing, ctx, origin);
  }

  const outer = document.createElement('div');
  outer.className = 'docx-drawing docx-drawing-ready';
  outer.dataset.drawingNodeId = drawing.drawingNodeId;
  positionedBox(outer, drawing.paintBounds, ctx.scale, origin);

  // Preset clip in authoritative paint space — xfrm rotation is already in clipPolygon.
  const clipPath = cssClipPathFromPolygon(drawing.geometry.clipPolygon ?? [], drawing.paintBounds);
  if (clipPath) outer.style.clipPath = clipPath;

  const inner = document.createElement('div');
  inner.className = 'docx-drawing-image-frame';
  inner.style.position = 'absolute';
  const content = drawing.geometry.contentBounds;
  const paint = drawing.paintBounds;
  inner.style.left = `${(content.x - paint.x) * ctx.scale}px`;
  inner.style.top = `${(content.y - paint.y) * ctx.scale}px`;
  inner.style.width = `${content.width * ctx.scale}px`;
  inner.style.height = `${content.height * ctx.scale}px`;

  const filter = filterStyleOf(drawing);
  if (filter) inner.style.filter = filter;

  const transformStage = document.createElement('div');
  transformStage.className = 'docx-drawing-transform-stage';
  transformStage.style.position = 'relative';
  transformStage.style.width = '100%';
  transformStage.style.height = '100%';
  const flipTransform = imagePaintTransformStyle(drawing);
  if (flipTransform) {
    transformStage.style.transform = flipTransform;
    transformStage.style.transformOrigin = '0 0';
  }

  const cropViewport = document.createElement('div');
  cropViewport.className = 'docx-drawing-crop-viewport';
  cropViewport.style.position = 'relative';
  cropViewport.style.width = '100%';
  cropViewport.style.height = '100%';
  cropViewport.style.overflow = 'hidden';

  const img = document.createElement('img');
  img.className = 'docx-drawing-image';
  img.setAttribute('draggable', 'false');
  // SAFE: `src` is a host-minted object URL from PaintImageUrlPort, never file-derived.
  img.setAttribute('src', url);
  img.setAttribute('alt', '');

  const cropStyles = cropImageStyles(drawing, resource);
  img.style.position = 'absolute';
  img.style.width = cropStyles.width;
  img.style.height = cropStyles.height;
  img.style.left = cropStyles.left;
  img.style.top = cropStyles.top;
  img.style.maxWidth = 'none';
  img.style.maxHeight = 'none';

  cropViewport.append(img);
  transformStage.append(cropViewport);
  inner.append(transformStage);
  outer.append(inner);

  if (drawing.hyperlinkHref && !ctx.inertLinks) {
    outer.dataset.docxDrawingLink = drawing.drawingNodeId;
    outer.dataset.docxDrawingLinkKind = 'external';
    outer.dataset.docxDrawingLinkHref = drawing.hyperlinkHref;
    outer.setAttribute('tabindex', '-1');
    applyAccessibility(outer, drawing, true);
  } else {
    applyAccessibility(outer, drawing, false);
  }
  return outer;
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * Paint a typed `wps:wsp` solid-geometry shape as inline SVG. Coordinates stay in the
 * projection's extent-EMU space via the viewBox; the frame div scales them to layout
 * points exactly like the image frame does, so clipped paint bounds crop correctly.
 */
function paintVectorShape(
  document: Document,
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  ctx: DrawingPaintContext,
  origin?: LayoutBox
): HTMLElement {
  const shape = drawing.vectorShape!;
  const outer = document.createElement('div');
  outer.className = 'docx-drawing docx-drawing-shape';
  outer.dataset.drawingNodeId = drawing.drawingNodeId;
  positionedBox(outer, drawing.paintBounds, ctx.scale, origin);

  const content = drawing.geometry.contentBounds;
  const paint = drawing.paintBounds;
  const frame = document.createElement('div');
  frame.className = 'docx-drawing-image-frame';
  frame.style.position = 'absolute';
  frame.style.left = `${(content.x - paint.x) * ctx.scale}px`;
  frame.style.top = `${(content.y - paint.y) * ctx.scale}px`;
  frame.style.width = `${content.width * ctx.scale}px`;
  frame.style.height = `${content.height * ctx.scale}px`;

  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute(
    'viewBox',
    `0 0 ${finiteStyle(Math.max(1, shape.extentEmu.cx))} ${finiteStyle(Math.max(1, shape.extentEmu.cy))}`
  );
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.style.display = 'block';

  const path = document.createElementNS(SVG_NAMESPACE, 'path');
  const d = shape.subpathsEmu
    .map(
      (points) =>
        `M${points.map((point) => `${finiteStyle(point.x)} ${finiteStyle(point.y)}`).join('L')}Z`
    )
    .join('');
  path.setAttribute('d', d);
  // SAFE: hex colors are validated 6-digit sRGB at the projection trust boundary.
  path.setAttribute('fill', shape.fillHex !== null ? `#${shape.fillHex}` : 'none');
  path.setAttribute('fill-rule', 'evenodd');
  if (shape.strokeHex !== null) {
    path.setAttribute('stroke', `#${shape.strokeHex}`);
    path.setAttribute('stroke-width', finiteStyle(Math.max(1, shape.strokeWidthEmu)));
  }
  svg.append(path);
  frame.append(svg);
  outer.append(frame);

  if (drawing.hyperlinkHref && !ctx.inertLinks) {
    outer.dataset.docxDrawingLink = drawing.drawingNodeId;
    outer.dataset.docxDrawingLinkKind = 'external';
    outer.dataset.docxDrawingLinkHref = drawing.hyperlinkHref;
    outer.setAttribute('tabindex', '-1');
    applyAccessibility(outer, drawing, true);
  } else {
    applyAccessibility(outer, drawing, false);
  }
  return outer;
}

export function paintDrawingRecord(
  document: Document,
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  ctx: DrawingPaintContext,
  urlRegistry: UrlRegistry | null,
  origin?: LayoutBox
): HTMLElement | null {
  if (drawing.accessibility.hidden) return null;
  if (drawing.paintBounds.width <= 0 || drawing.paintBounds.height <= 0) return null;

  if (drawing.vectorShape && drawing.vectorShape.subpathsEmu.length > 0) {
    return paintVectorShape(document, drawing, ctx, origin);
  }

  const { resource } = drawing;
  if (resource.kind === 'ready') {
    if (!ctx.imageUrlPort || !urlRegistry) {
      return paintPlaceholderCard(document, drawing, ctx, origin);
    }
    const url = urlRegistry.urlForReady(resource.validatedHandle, resource.mime);
    if (!url) return paintPlaceholderCard(document, drawing, ctx, origin);
    return paintReadyImage(document, drawing, ctx, url, origin);
  }

  if (resource.kind === 'pending') {
    return paintPlaceholderCard(document, drawing, ctx, origin);
  }

  return paintPlaceholderCard(document, drawing, ctx, origin);
}

export function paintInlineDrawingsOnLine(
  document: Document,
  line: Readonly<{ readonly drawings?: readonly InlineDrawingRecord[] }>,
  ctx: DrawingPaintContext,
  urlRegistry: UrlRegistry | null,
  lineOrigin: LayoutBox
): readonly HTMLElement[] {
  const painted: HTMLElement[] = [];
  for (const drawing of line.drawings ?? []) {
    const element = paintDrawingRecord(document, drawing, ctx, urlRegistry, lineOrigin);
    if (element) painted.push(element);
  }
  return Object.freeze(painted);
}

export function paintAnchoredDrawingsLayer(
  document: Document,
  drawings: readonly AnchoredDrawingRecord[],
  layer: 'behind' | 'inFront',
  ctx: DrawingPaintContext,
  urlRegistry: UrlRegistry | null,
  pageOrigin: LayoutBox
): readonly HTMLElement[] {
  const painted: HTMLElement[] = [];
  for (const drawing of drawings) {
    if (paintLayerOf(drawing) !== layer) continue;
    const element = paintDrawingRecord(document, drawing, ctx, urlRegistry, pageOrigin);
    if (element) {
      element.dataset.drawingLayer = layer;
      painted.push(element);
    }
  }
  return Object.freeze(painted);
}

export function collectUsedDrawingResourceKeys(layout: SemanticLayout): ReadonlySet<string> {
  const keys = new Set<string>();
  const visitDrawing = (drawing: InlineDrawingRecord | AnchoredDrawingRecord): void => {
    if (drawing.resource.kind === 'ready') keys.add(drawing.resource.resourceKey);
  };
  const visitLine = (line: { readonly drawings?: readonly InlineDrawingRecord[] }): void => {
    for (const drawing of line.drawings ?? []) visitDrawing(drawing);
  };
  const visitParagraphFragment = (fragment: ParagraphFragmentRecord): void => {
    for (const line of fragment.lines) visitLine(line);
  };
  const visitBlock = (block: ParagraphFragmentRecord | TableFragmentRecord): void => {
    if (block.kind === 'table') {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          for (const inner of cell.blocks) visitBlock(inner);
        }
      }
      return;
    }
    visitParagraphFragment(block);
  };
  for (const page of layout.pages) {
    for (const drawing of page.anchoredDrawings ?? []) visitDrawing(drawing);
    for (const fragment of page.fragments) visitBlock(fragment);
    for (const story of [page.header, page.footer]) {
      if (!story) continue;
      for (const drawing of story.anchoredDrawings ?? []) visitDrawing(drawing);
      for (const fragment of story.fragments) visitBlock(fragment);
    }
  }
  return keys;
}

export function drawingPaintStringsCacheToken(strings: DrawingPaintStrings): string {
  return [
    strings.missingResource,
    strings.externalResource,
    strings.invalidResource,
    strings.contentMismatch,
    strings.decodeFailed,
    strings.resourceLimit,
    strings.pendingResource,
    strings.unsupportedFormat('probe'),
    strings.nonPictureGraphic('probe'),
  ].join('\0');
}

export const DEFAULT_DRAWING_PAINT_STRINGS: DrawingPaintStrings = Object.freeze({
  unsupportedFormat: (format: string) => `Unsupported image format (${format})`,
  nonPictureGraphic: (kind: string) => `Unsupported graphic (${kind})`,
  missingResource: 'Image missing',
  externalResource: 'External image not loaded',
  invalidResource: 'Invalid image',
  contentMismatch: 'Image content does not match its type',
  decodeFailed: 'Image could not be decoded',
  resourceLimit: 'Image exceeds size limits',
  pendingResource: 'Loading image',
});

/** Build localized refusal strings from an i18n `t('image.*')` callback. */
export function drawingPaintStringsFromTranslate(
  t: (key: string, params?: Record<string, string | number>) => string
): DrawingPaintStrings {
  return Object.freeze({
    unsupportedFormat: (format: string) => t('image.unsupportedFormat', { format }),
    nonPictureGraphic: (kind: string) => t('image.nonPictureGraphic', { kind }),
    missingResource: t('image.missingResource'),
    externalResource: t('image.externalResource'),
    invalidResource: t('image.invalidResource'),
    contentMismatch: t('image.contentMismatch'),
    decodeFailed: t('image.decodeFailed'),
    resourceLimit: t('image.resourceLimit'),
    pendingResource: t('image.pendingResource'),
  });
}
