// Drawing paint dispatch (typed-drawings-and-images task 10).
//
// Trust boundary: every string is file-derived or host-supplied through i18n callbacks.
// DOM is built with createElement/setAttribute/textContent only; styles use validated numbers
// or fixed tokens — never raw authored markup or unescaped file-derived CSS.

import type {
  RenderableImageMime,
  ValidatedImageBytesHandle,
} from '../store/package/image-resources.ts';
import type { AnchoredDrawingRecord, InlineDrawingRecord } from '../layout/drawing-layout.ts';
import type { DrawingPoint } from '../layout/drawing-geometry.ts';
import { cssTransformForDrawingImage } from '../layout/drawing-geometry.ts';
import type {
  LayoutBox,
  PageRecord,
  ParagraphFragmentRecord,
  TableFragmentRecord,
} from '../layout/semantic-records.ts';
import { forEachStoryDrawing } from '../layout/semantic-record-queries.ts';
import type { SemanticLayout } from '@docx-editor.dev/core/layout';
import { paintLayerOf } from '../layout/drawing-exclusion.ts';
import {
  REVIEW_AUTHOR_SLOTS,
  revisionPresentationOf,
  type RevisionStyleContext,
} from './revision-presentation.ts';

/** Host port for safe blob URLs — only called for {@link ImageResourceState.kind} `ready`. */
export interface PaintImageUrlPort {
  create(handle: ValidatedImageBytesHandle, mime: RenderableImageMime): string;
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
  /**
   * Discriminates repeated paints of the SAME drawing (a header image appears once per
   * page). Combined with the drawing id it keys `<img>` element reuse across repaints,
   * so a keystroke moves the already-decoded element instead of recreating it — a fresh
   * element re-decodes asynchronously and flashes blank for a frame.
   */
  readonly paintInstance?: string;
  /**
   * Host-supplied fragment painter for textbox stories (the host owns paragraph/table
   * fragment paint). Absent hosts degrade textbox drawings to the placeholder card.
   */
  readonly paintStoryFragment?: (
    document: Document,
    fragment: ParagraphFragmentRecord | TableFragmentRecord
  ) => HTMLElement;
  /** Resolved author colouring, so a tracked drawing's cue follows the span scheme. */
  readonly revisionStyles?: RevisionStyleContext;
}

// A Map, not an object literal: the key is a MIME read off the package, so a value naming a
// prototype member must answer undefined and fall through to the label below.
const MIME_FORMAT_LABEL: ReadonlyMap<string, string> = new Map([
  ['image/svg+xml', 'SVG'],
  ['image/tiff', 'TIFF'],
  ['image/x-emf', 'EMF'],
  ['image/x-wmf', 'WMF'],
]);
const UNKNOWN_FORMAT_LABEL = 'Unknown';

interface UrlRegistry {
  readonly urlForReady: (
    handle: ValidatedImageBytesHandle,
    mime: RenderableImageMime
  ) => string | null;
  /** Stable `<img>` per (paint instance, drawing, resource) — reuse keeps the decode. */
  readonly imageFor?: (
    elementKey: string,
    resourceKey: string,
    document: Document
  ) => HTMLImageElement;
  /** Previously decoded image to retain while a new package snapshot revalidates it. */
  readonly imageForPending?: (elementKey: string) => HTMLImageElement | null;
  readonly readyElementFor?: (elementKey: string) => HTMLElement | null;
  readonly rememberReadyElement?: (elementKey: string, element: HTMLElement) => void;
  readonly reconcile: (
    usedResourceKeys: ReadonlySet<string>,
    usedElementKeys: ReadonlySet<string>
  ) => void;
  readonly revokeAll: () => void;
}

const urlRegistries = new WeakMap<object, UrlRegistry>();
const readyImagePaintSignatures = new WeakMap<HTMLElement, string>();

/** Cached-element ceiling per registry — beyond it paint falls back to fresh elements. */
const MAX_CACHED_DRAWING_IMAGES = 256;

export function drawingUrlRegistryFor(
  container: HTMLElement,
  port: PaintImageUrlPort
): UrlRegistry {
  let registry = urlRegistries.get(container);
  if (registry) return registry;
  const urlsByKey = new Map<string, string>();
  const imagesByElementKey = new Map<
    string,
    {
      readonly element: HTMLImageElement;
      readonly resourceKey: string;
      readonly readyElement?: HTMLElement;
    }
  >();
  registry = Object.freeze({
    urlForReady(handle: ValidatedImageBytesHandle, mime: RenderableImageMime): string | null {
      const existing = urlsByKey.get(handle.resourceKey);
      if (existing) return existing;
      let url: string;
      try {
        url = port.create(handle, mime);
      } catch (error) {
        // Layout marked the resource ready, but the validated bytes are gone — a
        // package reset between layout and paint, or a stale handle. Paint must
        // still finish; the placeholder stands until a later pass mints.
        if (error instanceof Error && error.message.startsWith('PaintImageUrlSource:')) {
          return null;
        }
        throw error;
      }
      urlsByKey.set(handle.resourceKey, url);
      return url;
    },
    imageFor(elementKey: string, resourceKey: string, document: Document): HTMLImageElement {
      const cached = imagesByElementKey.get(elementKey);
      if (cached && cached.resourceKey === resourceKey) return cached.element;
      const element = document.createElement('img');
      if (imagesByElementKey.size < MAX_CACHED_DRAWING_IMAGES) {
        imagesByElementKey.set(elementKey, {
          element,
          resourceKey,
          ...(cached?.readyElement ? { readyElement: cached.readyElement } : {}),
        });
      }
      return element;
    },
    imageForPending(elementKey: string): HTMLImageElement | null {
      return imagesByElementKey.get(elementKey)?.element ?? null;
    },
    readyElementFor(elementKey: string): HTMLElement | null {
      return imagesByElementKey.get(elementKey)?.readyElement ?? null;
    },
    rememberReadyElement(elementKey: string, element: HTMLElement): void {
      const cached = imagesByElementKey.get(elementKey);
      if (!cached) return;
      imagesByElementKey.set(elementKey, { ...cached, readyElement: element });
    },
    reconcile(usedResourceKeys: ReadonlySet<string>, usedElementKeys: ReadonlySet<string>): void {
      for (const [key, url] of urlsByKey) {
        if (usedResourceKeys.has(key)) continue;
        port.revoke(url);
        urlsByKey.delete(key);
      }
      for (const [key, entry] of imagesByElementKey) {
        if (usedElementKeys.has(key)) continue;
        entry.element.removeAttribute('src');
        imagesByElementKey.delete(key);
      }
    },
    revokeAll(): void {
      for (const url of urlsByKey.values()) port.revoke(url);
      urlsByKey.clear();
      for (const entry of imagesByElementKey.values()) entry.element.removeAttribute('src');
      imagesByElementKey.clear();
    },
  });
  urlRegistries.set(container, registry);
  return registry;
}

function drawingElementKey(
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  ctx: DrawingPaintContext
): string {
  return `${ctx.paintInstance ?? ''}|${drawing.drawingNodeId}`;
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
            MIME_FORMAT_LABEL.get(resource.mime) ?? UNKNOWN_FORMAT_LABEL
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

function readyImagePaintSignature(
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  resource: Extract<InlineDrawingRecord['resource'], { kind: 'ready' }>,
  ctx: DrawingPaintContext,
  url: string,
  origin?: LayoutBox
): string {
  const paint = drawing.paintBounds;
  const content = drawing.geometry.contentBounds;
  const crop = cropImageStyles(drawing, resource);
  return [
    url,
    ctx.scale,
    origin?.x ?? 0,
    origin?.y ?? 0,
    paint.x,
    paint.y,
    paint.width,
    paint.height,
    content.x,
    content.y,
    content.width,
    content.height,
    cssClipPathFromPolygon(drawing.geometry.clipPolygon ?? [], paint) ?? '',
    filterStyleOf(drawing) ?? '',
    imagePaintTransformStyle(drawing) ?? '',
    crop.width,
    crop.height,
    crop.left,
    crop.top,
    ctx.inertLinks ? '' : (drawing.hyperlinkHref ?? ''),
    drawing.accessibility.label ?? '',
  ].join('|');
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
  urlRegistry: UrlRegistry | null,
  origin?: LayoutBox
): HTMLElement {
  const resource = drawing.resource;
  if (resource.kind !== 'ready') {
    return paintPlaceholderCard(document, drawing, ctx, origin);
  }

  const elementKey = drawingElementKey(drawing, ctx);
  const outer = urlRegistry?.readyElementFor?.(elementKey) ?? document.createElement('div');
  const paintSignature = readyImagePaintSignature(drawing, resource, ctx, url, origin);
  if (readyImagePaintSignatures.get(outer) === paintSignature) return outer;
  outer.className = 'docx-drawing docx-drawing-ready';
  outer.style.cssText = '';
  outer.dataset.drawingNodeId = drawing.drawingNodeId;
  delete outer.dataset.docxDrawingLink;
  delete outer.dataset.docxDrawingLinkKind;
  delete outer.dataset.docxDrawingLinkHref;
  outer.removeAttribute('aria-hidden');
  outer.removeAttribute('aria-label');
  outer.removeAttribute('role');
  outer.removeAttribute('tabindex');
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

  const img =
    urlRegistry?.imageFor?.(elementKey, resource.resourceKey, document) ??
    document.createElement('img');
  img.className = 'docx-drawing-image';
  img.setAttribute('draggable', 'false');
  // SAFE: `src` is a host-minted object URL from PaintImageUrlPort, never file-derived.
  // Re-assigning an identical src still restarts the load and blanks a frame — skip it.
  if (img.getAttribute('src') !== url) img.setAttribute('src', url);
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
  outer.replaceChildren(inner);

  if (drawing.hyperlinkHref && !ctx.inertLinks) {
    outer.dataset.docxDrawingLink = drawing.drawingNodeId;
    outer.dataset.docxDrawingLinkKind = 'external';
    outer.dataset.docxDrawingLinkHref = drawing.hyperlinkHref;
    outer.setAttribute('tabindex', '-1');
    applyAccessibility(outer, drawing, true);
  } else {
    applyAccessibility(outer, drawing, false);
  }
  urlRegistry?.rememberReadyElement?.(elementKey, outer);
  readyImagePaintSignatures.set(outer, paintSignature);
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

  // `components` is the paint authority and is always non-empty; the top-level `fillHex`
  // and `strokeHex` describe a one-component shape only.
  for (const component of shape.components) {
    const path = document.createElementNS(SVG_NAMESPACE, 'path');
    const d = component.subpathsEmu
      .map(
        (points) =>
          `M${points.map((point) => `${finiteStyle(point.x)} ${finiteStyle(point.y)}`).join('L')}Z`
      )
      .join('');
    path.setAttribute('d', d);
    // SAFE: colours are validated 6-digit sRGB at the projection trust boundary.
    path.setAttribute('fill', component.fillHex !== null ? `#${component.fillHex}` : 'none');
    path.setAttribute('fill-rule', 'evenodd');
    if (component.fillAlpha < 1) {
      path.setAttribute('fill-opacity', finiteStyle(Math.max(0, component.fillAlpha)));
    }
    if (component.strokeHex !== null) {
      path.setAttribute('stroke', `#${component.strokeHex}`);
      path.setAttribute('stroke-width', finiteStyle(Math.max(1, component.strokeWidthEmu)));
      if (component.strokeAlpha < 1) {
        path.setAttribute('stroke-opacity', finiteStyle(Math.max(0, component.strokeAlpha)));
      }
    }
    svg.append(path);
  }
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

/**
 * Paint a textbox drawing's laid-out story: optional fill/outline box, then the story
 * fragments inside a clipped content container at the resolved anchor position. The
 * container is page furniture — non-editable, with no selection bindings inside.
 */
function paintTextboxStory(
  document: Document,
  drawing: AnchoredDrawingRecord,
  story: NonNullable<AnchoredDrawingRecord['textboxStory']>,
  ctx: DrawingPaintContext,
  origin?: LayoutBox
): HTMLElement {
  const scale = ctx.scale;
  const outer = document.createElement('div');
  outer.className = 'docx-drawing docx-drawing-textbox';
  outer.dataset.drawingNodeId = drawing.drawingNodeId;
  outer.setAttribute('contenteditable', 'false');
  positionedBox(outer, drawing.paintBounds, ctx.scale, origin);
  outer.style.overflow = 'hidden';

  // Extent box in paint-bounds-relative coordinates (paintBounds may be a clipped subregion).
  const extentLeft = (drawing.x - drawing.paintBounds.x) * scale;
  const extentTop = (drawing.y - drawing.paintBounds.y) * scale;

  if (story.fillHex !== null || story.strokeHex !== null) {
    const box = document.createElement('div');
    box.className = 'docx-drawing-textbox-box';
    box.style.position = 'absolute';
    box.style.left = `${extentLeft}px`;
    box.style.top = `${extentTop}px`;
    box.style.width = `${drawing.width * scale}px`;
    box.style.height = `${drawing.height * scale}px`;
    box.style.boxSizing = 'border-box';
    // SAFE: hex colors are validated 6-digit sRGB at the projection trust boundary.
    if (story.fillHex !== null) box.style.backgroundColor = `#${story.fillHex}`;
    if (story.strokeHex !== null) {
      box.style.border = `${Math.max(story.strokeWidthPt * scale, 0.5)}px solid #${story.strokeHex}`;
    }
    outer.append(box);
  }

  const content = document.createElement('div');
  content.className = 'docx-drawing-textbox-content';
  content.style.position = 'absolute';
  content.style.left = `${extentLeft + story.contentOffset.x * scale}px`;
  content.style.top = `${extentTop + story.contentOffset.y * scale}px`;
  content.style.width = `${story.contentWidth * scale}px`;
  content.style.height = `${Math.max(0, story.contentHeight) * scale}px`;
  content.style.overflow = 'hidden';
  for (const fragment of story.fragments) {
    content.append(ctx.paintStoryFragment!(document, fragment));
  }
  // Story text is furniture: strip selection/editing bindings so pointer mapping never
  // resolves into a story the surface cannot edit.
  for (const bound of content.querySelectorAll<HTMLElement>('[data-paragraph-id]')) {
    delete bound.dataset.paragraphId;
  }
  outer.append(content);
  applyAccessibility(outer, drawing, false);
  return outer;
}

/**
 * The tracked-change cue on a painted drawing (#479).
 *
 * The same statement `applyRevisionPresentation` makes for text, translated to a box: the
 * stylesheet draws an insertion- or deletion-coloured outline under
 * `docx-drawing--revision-*` and dims a pending removal, and the element carries the same
 * `data-revision-*` datasets spans do, so review chrome resolves a hovered picture to its
 * decision exactly like a hovered word.
 *
 * Applied on EVERY paint — including the ready-image path's signature-matched reuse, whose
 * cached element would otherwise keep the marking of a decision the document no longer
 * records. That is also why the untracked branch scrubs rather than returns.
 */
function applyDrawingRevisionPresentation(
  element: HTMLElement,
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  ctx: DrawingPaintContext
): void {
  const colors = ctx.revisionStyles;
  const presentation = revisionPresentationOf(
    drawing.revisions,
    colors?.authorSlots,
    colors?.styles
  );
  if (!presentation) {
    if (element.dataset.revisionKind === undefined) return;
    element.classList.remove(
      'docx-drawing--revision',
      'docx-drawing--revision-insertion',
      'docx-drawing--revision-deletion'
    );
    delete element.dataset.revisionKind;
    delete element.dataset.revisionId;
    delete element.dataset.reviewAuthor;
    delete element.dataset.revisionDate;
    delete element.dataset.reviewAuthorSlot;
    element.style.outlineColor = '';
    return;
  }
  const { attribution } = presentation;
  element.classList.add(
    'docx-drawing--revision',
    presentation.deleted ? 'docx-drawing--revision-deletion' : 'docx-drawing--revision-insertion'
  );
  element.classList.remove(
    presentation.deleted ? 'docx-drawing--revision-insertion' : 'docx-drawing--revision-deletion'
  );
  element.dataset.revisionKind = attribution.kind;
  element.dataset.revisionId = attribution.id;
  if (attribution.author !== '') element.dataset.reviewAuthor = attribution.author;
  else delete element.dataset.reviewAuthor;
  if (attribution.date !== undefined) element.dataset.revisionDate = attribution.date;
  else delete element.dataset.revisionDate;
  // The spans' selective ink rule: the outline follows the author under author colouring
  // (inline style beats the stylesheet's kind colour), and stays on the kind tokens
  // otherwise. `spanClassName` tokens are NOT mirrored here — they are documented as span
  // classes, and a reused image element would accumulate stale host tokens no scrub knows.
  const authorStyle = colors?.styles.get(attribution.author);
  const byAuthor =
    colors !== undefined && (authorStyle?.color !== undefined || colors.others === 'author');
  if (colors) {
    element.dataset.reviewAuthorSlot = String(
      (colors.authorSlots.get(attribution.author) ?? 0) % REVIEW_AUTHOR_SLOTS
    );
  } else {
    delete element.dataset.reviewAuthorSlot;
  }
  element.style.outlineColor = byAuthor ? presentation.authorColor : '';
}

export function paintDrawingRecord(
  document: Document,
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  ctx: DrawingPaintContext,
  urlRegistry: UrlRegistry | null,
  origin?: LayoutBox
): HTMLElement | null {
  const element = paintDrawingRecordElement(document, drawing, ctx, urlRegistry, origin);
  if (element) applyDrawingRevisionPresentation(element, drawing, ctx);
  return element;
}

function paintDrawingRecordElement(
  document: Document,
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  ctx: DrawingPaintContext,
  urlRegistry: UrlRegistry | null,
  origin?: LayoutBox
): HTMLElement | null {
  if (drawing.accessibility.hidden) return null;
  if (drawing.paintBounds.width <= 0 || drawing.paintBounds.height <= 0) return null;

  if (
    drawing.kind === 'anchoredDrawing' &&
    drawing.textboxStory !== undefined &&
    ctx.paintStoryFragment !== undefined
  ) {
    return paintTextboxStory(document, drawing, drawing.textboxStory, ctx, origin);
  }

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
    return paintReadyImage(document, drawing, ctx, url, urlRegistry, origin);
  }

  if (resource.kind === 'pending') {
    const retained =
      urlRegistry?.readyElementFor?.(drawingElementKey(drawing, ctx)) ??
      urlRegistry
        ?.imageForPending?.(drawingElementKey(drawing, ctx))
        ?.closest<HTMLElement>('.docx-drawing-ready');
    if (retained) {
      readyImagePaintSignatures.delete(retained);
      retained.dataset.drawingNodeId = drawing.drawingNodeId;
      positionedBox(retained, drawing.paintBounds, ctx.scale, origin);
      return retained;
    }
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

/**
 * Every drawing one page paints, whatever story it is in.
 *
 * `paintPageNoteAreas` paints note fragments through the same `paintFragment` the body uses, so
 * a picture in a footnote gets a cached element and a blob URL like any other. Walking only the
 * body and the furniture stories meant the reconcile pass never saw those keys and treated them
 * as unused — so every repaint revoked the note image's resource and stripped its `src`. Typing
 * one character in the body blanked a picture in a footnote.
 *
 * Each story walks with {@link forEachStoryDrawing} — the SAME bounded walk the furniture
 * invalidation token uses, so what layout invalidates and what paint keeps alive cannot
 * drift apart.
 */
function forEachPageDrawing(
  page: PageRecord,
  visitDrawing: (drawing: InlineDrawingRecord | AnchoredDrawingRecord) => void
): void {
  forEachStoryDrawing(
    {
      fragments: page.fragments,
      ...(page.anchoredDrawings ? { anchoredDrawings: page.anchoredDrawings } : {}),
    },
    visitDrawing
  );
  for (const story of [page.header, page.footer]) {
    if (story) forEachStoryDrawing(story, visitDrawing);
  }
  for (const area of [page.footnotes, page.endnotes]) {
    if (!area) continue;
    // The separator is an authored story too, and `paintPageNoteAreas` paints it.
    if (area.separator) forEachStoryDrawing(area.separator, visitDrawing);
    for (const note of area.notes) forEachStoryDrawing(note, visitDrawing);
  }
}

interface PageDrawingKeys {
  readonly resourceKeys: readonly string[];
  readonly elementKeys: readonly string[];
}

/**
 * Drawing keys per immutable page record.
 *
 * Both collectors run on every paint, and each walked every fragment of every page — two
 * whole-document walks per keystroke for answers that cannot change on an untouched page.
 * Page records are reused by identity across incremental passes, and everything a key reads
 * (fragments, resource state, the page index the element key embeds) lives inside the record,
 * so the record's identity is the complete cache key.
 */
const drawingKeysByPage = new WeakMap<PageRecord, PageDrawingKeys>();

function pageDrawingKeys(page: PageRecord): PageDrawingKeys {
  const cached = drawingKeysByPage.get(page);
  if (cached) return cached;
  const resourceKeys: string[] = [];
  const elementKeys: string[] = [];
  forEachPageDrawing(page, (drawing) => {
    if (drawing.resource.kind === 'ready') resourceKeys.push(drawing.resource.resourceKey);
    elementKeys.push(`p${page.index}|${drawing.drawingNodeId}`);
  });
  const keys: PageDrawingKeys = Object.freeze({
    resourceKeys: Object.freeze(resourceKeys),
    elementKeys: Object.freeze(elementKeys),
  });
  drawingKeysByPage.set(page, keys);
  return keys;
}

export function collectUsedDrawingResourceKeys(layout: SemanticLayout): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const page of layout.pages) {
    for (const key of pageDrawingKeys(page).resourceKeys) keys.add(key);
  }
  return keys;
}

export function collectUsedDrawingElementKeys(layout: SemanticLayout): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const page of layout.pages) {
    for (const key of pageDrawingKeys(page).elementKeys) keys.add(key);
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
