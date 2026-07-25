/**
 * Image layout helpers shared between framework adapters (React, Vue, ...).
 *
 * Everything here is framework-agnostic: pure DOM math + pure functions over
 * OOXML wrap-type vocabulary. The corresponding UI bindings (right-click menu,
 * toolbar dropdown) live in each framework adapter and call into these.
 */

import { pixelsToEmu } from '../legacy-core-compat';
import type { ImageAttrs, ImageLayoutTarget } from '../legacy-core-compat';
import type { WrapType } from './wrapTypes';

// ============================================================================
// Class names emitted by the layout painter — single source of truth so hosts
// can hit-test rendered images without hard-coding selectors.
// ============================================================================

export const LAYOUT_IMAGE_CLASSES = {
  /** Inline image rendered inside `.layout-line`. */
  runImage: 'layout-run-image',
  /** Wrapper used when an inline image needs a rotated bounding box. */
  runImageWrapper: 'layout-run-image-wrapper',
  /** Block (centered, topAndBottom) image. */
  blockImage: 'layout-block-image',
  /** Anchored image rendered in the page-level floating layer. */
  pageFloatingImage: 'layout-page-floating-image',
  /** Anchored image rendered inside a table cell's floating layer. */
  cellFloatingImage: 'layout-cell-floating-image',
  pageContent: 'layout-page-content',
  paragraph: 'layout-paragraph',
} as const;

const IMAGE_HIT_SELECTOR = [
  `.${LAYOUT_IMAGE_CLASSES.pageFloatingImage}`,
  `.${LAYOUT_IMAGE_CLASSES.cellFloatingImage}`,
  `.${LAYOUT_IMAGE_CLASSES.blockImage}`,
  `.${LAYOUT_IMAGE_CLASSES.runImageWrapper}`,
  `.${LAYOUT_IMAGE_CLASSES.runImage}`,
].join(', ');

function resolveInlineImageHit(target: HTMLElement): HTMLElement | null {
  if (target.tagName !== 'IMG' || !target.classList.contains(LAYOUT_IMAGE_CLASSES.runImage)) {
    return null;
  }
  const wrapper = target.closest(`.${LAYOUT_IMAGE_CLASSES.runImageWrapper}`) as HTMLElement | null;
  return wrapper?.dataset.docFrom ? wrapper : target;
}

// ============================================================================
// Hit-test
// ============================================================================

export interface ImagePointerTargetResult {
  /** PM doc position of the image node, read from `data-doc-from`. */
  pos: number;
  /** The matched element — pass to `captureInlinePositionEmu` if it's inline. */
  imageEl: HTMLElement;
}

/**
 * Walk up from an event target looking for any rendered image element. Returns
 * the PM position embedded in `data-doc-from`, or null if the target isn't on
 * an image.
 */
export function pointerTargetResolveImage(
  target: EventTarget | null
): ImagePointerTargetResult | null {
  if (!(target instanceof Element)) return null;
  const inlineImageHit = target instanceof HTMLElement ? resolveInlineImageHit(target) : null;
  const imageEl = inlineImageHit ?? (target.closest(IMAGE_HIT_SELECTOR) as HTMLElement | null);
  if (!imageEl) return null;
  const docFromAttr = imageEl.dataset.docFrom;
  if (docFromAttr === undefined) return null;
  const pos = Number(docFromAttr);
  if (Number.isNaN(pos)) return null;
  return { pos, imageEl };
}

/**
 * Walk up from a click target to the nearest rendered image element, returning
 * just the element (no PM position parsing). Used by the left-click selection
 * path in both adapters — `data-doc-from` is read separately by callers that
 * need the position. Returns the element when the click was directly on an
 * inline `<img.layout-run-image>` OR inside one of the container classes
 * registered in `LAYOUT_IMAGE_CLASSES`.
 */
export function findImageElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  const inlineImageHit = resolveInlineImageHit(target);
  if (inlineImageHit) return inlineImageHit;
  // Otherwise walk up to the nearest image container with `data-doc-from`.
  const container = target.closest(IMAGE_HIT_SELECTOR) as HTMLElement | null;
  if (container && container.dataset.docFrom) return container;
  return null;
}

// ============================================================================
// Position capture for inline → anchor transitions
// ============================================================================

/**
 * Capture the rendered position of an inline image as EMUs, normalised to
 * unzoomed coordinates. Returns horizontal offset relative to the page
 * content area (column origin) and vertical offset relative to the
 * containing paragraph — matches the OOXML attrs the resolver writes
 * (`relativeFrom: 'column'` / `relativeFrom: 'paragraph'`).
 *
 * `zoom` defaults to 1; pass the editor's current zoom factor when the
 * pages container has a CSS scale applied so `getBoundingClientRect` deltas
 * are converted back to authored-pixel space before going to EMU.
 *
 * Returns undefined for non-inline images or detached DOM.
 */
export function captureInlinePositionEmu(
  imageEl: HTMLElement,
  zoom = 1
): { horizontalEmu: number; verticalEmu: number } | undefined {
  const isDirectInlineImage = imageEl.classList.contains(LAYOUT_IMAGE_CLASSES.runImage);
  const isWrappedInlineImage = imageEl.classList.contains(LAYOUT_IMAGE_CLASSES.runImageWrapper);
  if (!isDirectInlineImage && !isWrappedInlineImage) return undefined;
  const measuredEl = isWrappedInlineImage
    ? ((imageEl.querySelector(`img.${LAYOUT_IMAGE_CLASSES.runImage}`) as HTMLElement | null) ??
      imageEl)
    : imageEl;
  const pageContent = imageEl.closest(`.${LAYOUT_IMAGE_CLASSES.pageContent}`) as HTMLElement | null;
  const paragraph = imageEl.closest(`.${LAYOUT_IMAGE_CLASSES.paragraph}`) as HTMLElement | null;
  if (!pageContent || !paragraph) return undefined;
  const imgRect = measuredEl.getBoundingClientRect();
  const pageRect = pageContent.getBoundingClientRect();
  const paraRect = paragraph.getBoundingClientRect();
  const safeZoom = zoom > 0 ? zoom : 1;
  return {
    horizontalEmu: Math.round(pixelsToEmu((imgRect.left - pageRect.left) / safeZoom)),
    verticalEmu: Math.round(pixelsToEmu((imgRect.top - paraRect.top) / safeZoom)),
  };
}

// ============================================================================
// User-facing layout choice ↔ PM image attrs
// ============================================================================

/**
 * Map an image's current OOXML attrs onto the menu's choice vocabulary so the
 * menu can highlight the active option. Returns null for `topAndBottom` and
 * any unknown wrap type — those don't have a directional menu entry.
 *
 * `cssFloat` accepts both `null` and `undefined` so framework adapters can
 * use either as their "unset" sentinel without an extra normalisation step.
 */
export function deriveLayoutChoice(
  wrapType: WrapType,
  cssFloat?: ImageAttrs['cssFloat'] | null
): ImageLayoutTarget | null {
  if (wrapType === 'inline') return 'inline';
  if (wrapType === 'behind') return 'behind';
  if (wrapType === 'inFront') return 'inFront';
  if (wrapType === 'square' || wrapType === 'tight' || wrapType === 'through') {
    return cssFloat === 'right' ? 'squareRight' : 'squareLeft';
  }
  return null;
}

// ============================================================================
// Layout option schema (config without per-framework presentation)
// ============================================================================

/**
 * Hint to the framework's icon registry for which Material Symbol — or
 * equivalent — to render alongside each option. Bindings own the icon
 * component itself.
 */
export type ImageLayoutIconHint = 'inline' | 'squareLeft' | 'squareRight' | 'behind' | 'inFront';

export interface ImageLayoutOptionDef {
  /** Choice value — what gets dispatched on click. */
  choice: ImageLayoutTarget;
  /** i18n key under `imageWrap.menu.*`. */
  i18nLabelKey: string;
  /** i18n key under `imageWrap.menuDesc.*`. */
  i18nDescKey: string;
  /** Hint for the framework's icon registry. */
  iconHint: ImageLayoutIconHint;
}

/** Mirrors Word's Wrap Text menu — five directional config. */
export const IMAGE_LAYOUT_OPTIONS: readonly ImageLayoutOptionDef[] = [
  {
    choice: 'inline',
    i18nLabelKey: 'inLineWithText',
    i18nDescKey: 'inLineWithText',
    iconHint: 'inline',
  },
  {
    choice: 'squareLeft',
    i18nLabelKey: 'squareLeft',
    i18nDescKey: 'squareLeft',
    iconHint: 'squareLeft',
  },
  {
    choice: 'squareRight',
    i18nLabelKey: 'squareRight',
    i18nDescKey: 'squareRight',
    iconHint: 'squareRight',
  },
  {
    choice: 'behind',
    i18nLabelKey: 'behindText',
    i18nDescKey: 'behindText',
    iconHint: 'behind',
  },
  {
    choice: 'inFront',
    i18nLabelKey: 'inFrontOfText',
    i18nDescKey: 'inFrontOfText',
    iconHint: 'inFront',
  },
] as const;

/**
 * Whether a given option is enabled for an image with the given current wrap
 * type. Every option stays clickable — picking the option that matches the
 * current state is a no-op (the PM command early-returns), which matches
 * Word's behavior. We don't grey out the current option, so the menu reads
 * consistently regardless of whether the image is inline or anchored.
 *
 * The flag is kept around for forward-compatibility (e.g. future read-only
 * mode), but currently always returns true.
 */
export function isImageLayoutOptionEnabled(
  _option: ImageLayoutOptionDef,
  _currentWrapType: WrapType
): boolean {
  return true;
}

// ============================================================================
// Toolbar-vocabulary mapping
// ============================================================================

/**
 * Translate the legacy toolbar wrap-type vocabulary (`wrapLeft` / `wrapRight`
 * / `square` / `tight` / `through` / `topAndBottom` / `behind` / `inFront` /
 * `inline`) into a `ImageLayoutTarget` so toolbar dispatch shares the same PM
 * command path as the right-click menu.
 *
 * Returns `undefined` for unknown values; callers should treat that as
 * "no-op".
 */
export function toolbarValueToLayoutTarget(value: string): ImageLayoutTarget | undefined {
  switch (value) {
    case 'inline':
      return 'inline';
    case 'square':
    case 'tight':
    case 'through':
      return 'squareLeft';
    case 'topAndBottom':
      return 'topAndBottom';
    case 'behind':
      return 'behind';
    case 'inFront':
      return 'inFront';
    case 'wrapRight':
      return 'squareLeft';
    case 'wrapLeft':
      return 'squareRight';
    default:
      return undefined;
  }
}
