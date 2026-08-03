// The engine's own insertion point for the paginated surface.
//
// The painted pages are contenteditable, so the browser draws the caret itself — one DEVICE
// pixel, which on a 2x display is a hairline that reads as a rendering artefact rather than
// a cursor. Every desktop word processor draws a two-pixel insertion point, so the engine
// paints its own and suppresses the native one for exactly as long as it does.
//
// It also appears where the native caret does not. An EMPTY paragraph paints no text span,
// so the browser has no inline box to size an insertion point against and pressing Enter
// left the user with no visible cursor at all; `caretAt` resolves against the LINE record,
// which layout publishes whether or not any run landed on it.
//
// GEOMETRY COMES FROM LAYOUT, never from the DOM. `caretAt` answers where a model position
// sits, and the painter positions every fragment, row, cell and line by subtracting its
// parent's box from that SAME page-content coordinate space — so the caret can be placed
// inside `.docx-page-content` with no remeasurement and no per-nesting arithmetic, and it
// lands correctly inside a table cell for the same reason body text does.
//
// The element is FURNITURE, not model text. It carries `data-docx-marker`, the attribute
// `positionFromDomPoint` already refuses for painted non-model content: without it a
// selection endpoint resolved through the caret would map into the adjacent run and every
// offset after it would come back wrong. It is `contenteditable=false`, `aria-hidden` and
// pointer/selection inert for the same reason, and it is appended to the page CONTENT box
// rather than to a line or a fragment, because those are the elements whose CHILD INDICES
// dom-selection reads — adding a child to one of them would shift them.
//
// Everything here fails soft. A range selection, an unfocused surface, an active IME
// composition, a position layout does not place, or a page that is not materialized all
// leave the native caret alone rather than leaving the user with no caret at all.

import {
  caretAt,
  type SemanticLayout,
  type SemanticSelection,
  type TextMeasurer,
} from '@docx-editor.dev/core-contract/layout';

/** What the caret reads at paint time. Both move independently of the caret itself. */
export interface SurfaceCaretInput {
  readonly layout: SemanticLayout;
  readonly selection: SemanticSelection;
  /**
   * The port the layout was measured with.
   *
   * Without it the caret's x is interpolated across a span's advance, which only lands on a
   * glyph edge in a monospaced face — in any proportional one the caret is drawn through a
   * letter rather than beside it.
   */
  readonly measurer?: TextMeasurer;
}

export interface SurfaceCaret {
  /** Repaint from the current layout and selection. Safe to call on every render. */
  update(): void;
  destroy(): void;
}

/** Appearance — width, colour, blink — lives in the stylesheet under these names. */
const CARET_CLASS = 'ep-one-surface__caret';
const STEADY_CLASS = 'ep-one-surface__caret--steady';

/**
 * How long a moved caret stays solid before it resumes blinking.
 *
 * Half the blink period. A caret that keeps blinking while it is being dragged or arrowed
 * across the page disappears under the user's own gesture, which is why every platform
 * holds it solid while it moves — and why the stylesheet ships a `--steady` modifier.
 * Dropping the class restarts the animation at 0%, so the blink resumes visible.
 */
const STEADY_MS = 530;

export function createSurfaceCaret(
  pagesLayer: HTMLElement,
  scale: number,
  read: () => SurfaceCaretInput
): SurfaceCaret {
  const document = pagesLayer.ownerDocument;
  const element = document.createElement('div');
  element.className = CARET_CLASS;
  // Named for a host that wants to find it; the REFUSAL is the marker attribute below.
  element.dataset.docxCaret = '';
  // `data-docx-marker` is the exclusion attribute `positionFromDomPoint` already refuses
  // for painted furniture. Reusing it rather than minting a second one keeps one list of
  // things a selection endpoint may not resolve through.
  element.dataset.docxMarker = '';
  element.setAttribute('contenteditable', 'false');
  element.setAttribute('aria-hidden', 'true');
  // Dark mode inverts `.docx-page-content` wholesale to get Word's dark page. The caret is
  // painted inside that subtree, so it counter-inverts the way images and highlights
  // already do — otherwise the dark theme's light `--doc-caret` inverts to dark-on-dark.
  element.dataset.noColorInvert = '';
  // Inline, like every other painted canvas element: the document canvas is not themed and
  // is not covered by the library's scoped utilities, so anything load-bearing for the
  // picture is written on the element. The stylesheet still owns how it LOOKS.
  element.style.position = 'absolute';
  element.style.pointerEvents = 'none';
  element.style.userSelect = 'none';
  element.style.setProperty('-webkit-user-select', 'none');

  /** The browser needs its own caret while an input method is holding text. */
  let composing = false;
  let steadyTimer: ReturnType<typeof setTimeout> | null = null;
  /** The geometry last painted, so a repaint in place is told from a real move. */
  let placed: string | null = null;

  function hasFocus(): boolean {
    const active = document.activeElement;
    return active === pagesLayer || (!!active && pagesLayer.contains(active));
  }

  function isCollapsed(selection: SemanticSelection): boolean {
    return (
      selection.anchor.paragraphId === selection.head.paragraphId &&
      selection.anchor.offset === selection.head.offset
    );
  }

  /** Stop painting and give the native caret back. */
  function hide(): void {
    placed = null;
    if (steadyTimer !== null) {
      clearTimeout(steadyTimer);
      steadyTimer = null;
    }
    element.classList.remove(STEADY_CLASS);
    element.remove();
    pagesLayer.style.removeProperty('caret-color');
  }

  /** Hold the caret solid while it is moving, then let the blink resume. */
  function markMoving(): void {
    element.classList.add(STEADY_CLASS);
    if (steadyTimer !== null) clearTimeout(steadyTimer);
    steadyTimer = setTimeout(() => {
      steadyTimer = null;
      element.classList.remove(STEADY_CLASS);
    }, STEADY_MS);
  }

  function update(): void {
    if (composing || !hasFocus()) {
      hide();
      return;
    }
    const { layout, selection } = read();
    // A range selection shows the browser's highlight; an insertion point inside it would
    // claim a position the selection does not have.
    if (!isCollapsed(selection)) {
      hide();
      return;
    }
    // Measured, not interpolated: the caret has to sit at a glyph edge, and a span's advance
    // divided by its character count only lands there in a monospaced face.
    const geometry = caretAt(layout, selection.head, read().measurer);
    if (!geometry || !Number.isInteger(geometry.pageIndex)) {
      hide();
      return;
    }
    // Only a MATERIALIZED page has a content box; an off-screen one is a sized shell, and
    // the caret has nowhere to be painted until it is built.
    const content = pagesLayer.querySelector<HTMLElement>(
      `[data-page-index="${geometry.pageIndex}"] > .docx-page-content`
    );
    if (!content) {
      hide();
      return;
    }
    element.style.left = `${geometry.x * scale}px`;
    element.style.top = `${geometry.y * scale}px`;
    element.style.height = `${geometry.height * scale}px`;
    if (element.parentNode !== content) content.append(element);
    // Suppress the native caret only while ours is up, and inline so it beats the
    // `[contenteditable='true']` rule in the stylesheet.
    pagesLayer.style.caretColor = 'transparent';

    const key = `${geometry.pageIndex}:${geometry.x}:${geometry.y}:${geometry.height}`;
    if (key !== placed) {
      placed = key;
      markMoving();
    }
  }

  // The caret's own state lives on these events, so the surface does not have to relay
  // them: composition is the IME's, focus is the browser's, and both flip the caret
  // between painted and native without the model moving at all.
  const onCompositionStart = (): void => {
    composing = true;
    update();
  };
  const onCompositionEnd = (): void => {
    composing = false;
    update();
  };
  const onFocusIn = (): void => update();
  const onFocusOut = (event: FocusEvent): void => {
    // `document.activeElement` is mid-transition here; the related target is what focus is
    // moving TO, and a move that stays inside the pages is not a blur.
    const next = event.relatedTarget as Node | null;
    if (next && pagesLayer.contains(next)) return;
    hide();
  };

  pagesLayer.addEventListener('compositionstart', onCompositionStart);
  pagesLayer.addEventListener('compositionend', onCompositionEnd);
  pagesLayer.addEventListener('focusin', onFocusIn);
  pagesLayer.addEventListener('focusout', onFocusOut);

  return {
    update,
    destroy() {
      pagesLayer.removeEventListener('compositionstart', onCompositionStart);
      pagesLayer.removeEventListener('compositionend', onCompositionEnd);
      pagesLayer.removeEventListener('focusin', onFocusIn);
      pagesLayer.removeEventListener('focusout', onFocusOut);
      hide();
    },
  };
}
