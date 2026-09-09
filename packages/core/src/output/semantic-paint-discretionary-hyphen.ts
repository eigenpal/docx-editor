// Layout-only discretionary hyphen paint for automatic line breaks.
//
// The glyph is never in span.text or span.range. Furniture only: createElement +
// textContent, no model address, excluded from selection and serialization.

import { styleForFontSlot } from '../layout/script-itemization.ts';
import { DISCRETIONARY_HYPHEN_GLYPH } from '../layout/hyphenation.ts';
import type { ResolvedRunStyle } from '../layout/run-style.ts';
import type { StyleSpanRecord } from '../layout/semantic-records.ts';

/** Private semantic-paint helpers passed in at the call site. */
export interface DiscretionaryHyphenPaintHelpers {
  applyRunFaceStyle(target: HTMLElement, style: ResolvedRunStyle, ctx: unknown): void;
  mountRunText(
    document: Document,
    run: HTMLElement,
    text: string,
    style: ResolvedRunStyle,
    scale: number
  ): void;
  applyRevisionPresentation(target: HTMLElement, span: StyleSpanRecord, ctx: unknown): void;
}

/** Scale plus the paint context object semantic-paint already threads through paintLine. */
export interface DiscretionaryHyphenPaintContext {
  readonly scale: number;
  readonly paintContext: unknown;
}

function paintDiscretionaryHyphen(
  document: Document,
  span: StyleSpanRecord,
  faceStyle: ResolvedRunStyle,
  bandHeightPt: number,
  extraLeadingPt: number,
  ctx: DiscretionaryHyphenPaintContext,
  helpers: DiscretionaryHyphenPaintHelpers
): HTMLElement | null {
  const hyphen = span.discretionaryHyphen;
  if (!hyphen || !(hyphen.widthPt > 0)) return null;

  const element = document.createElement('span');
  element.className = 'layout-run layout-run-discretionary-hyphen';
  element.dataset.docxDiscretionaryHyphen = '';
  element.setAttribute('aria-hidden', 'true');
  element.contentEditable = 'false';
  element.style.display = 'inline-block';
  element.style.verticalAlign = 'baseline';
  element.style.boxSizing = 'border-box';
  element.style.width = `${hyphen.widthPt * ctx.scale}px`;
  element.style.height = `${bandHeightPt * ctx.scale}px`;
  element.style.paddingTop = `${extraLeadingPt * ctx.scale}px`;
  element.style.lineHeight = `${(bandHeightPt - extraLeadingPt) * ctx.scale}px`;
  element.style.pointerEvents = 'none';
  element.style.userSelect = 'none';

  helpers.applyRunFaceStyle(element, faceStyle, ctx.paintContext);
  helpers.applyRevisionPresentation(element, span, ctx.paintContext);
  helpers.mountRunText(document, element, DISCRETIONARY_HYPHEN_GLYPH, span.style, ctx.scale);
  return element;
}

/**
 * Append a layout-only hyphen after one painted span when layout published one.
 *
 * Dependency adapter and append orchestration live here so semantic-paint.ts stays
 * under its max-lines gate.
 */
export function appendDiscretionaryHyphenAfter(
  document: Document,
  parent: HTMLElement,
  span: StyleSpanRecord,
  bandHeightPt: number,
  extraLeadingPt: number,
  ctx: DiscretionaryHyphenPaintContext,
  helpers: DiscretionaryHyphenPaintHelpers
): void {
  const hyphen = paintDiscretionaryHyphen(
    document,
    span,
    styleForFontSlot(span.style, span.fontSlot),
    bandHeightPt,
    extraLeadingPt,
    ctx,
    helpers
  );
  if (hyphen) parent.append(hyphen);
}
