// The image-FILE stand-down policy for host paste and drop lanes (React/Vue Content).
//
// The engine's own clipboard listeners run on the pages layer regardless of what a host
// handler does afterwards, so a host file lane can only ever ADD an insertion — the
// question these predicates answer is whether that addition duplicates content the engine
// already lands. Word on macOS is the payload that forced the policy: it puts a rendered
// PNG of copied TEXT on the pasteboard beside the HTML, and a host that inserts the file
// whenever one is present pastes that rendering on top of the text.
//
// Rather than re-modelling the paste router, the paste predicate asks the router's own
// machinery: the fragment codec for embedded fragments and the bounded HTML projection for
// everything else, so an html flavour the projection refuses (a webp `data:` image, an
// oversized payload, a malformed fragment attribute) correctly keeps the file lane and an
// html flavour it lands correctly stands it down.

import { fragmentFromHtml } from './clipboard-fragment-codec.ts';
import { projectExternalHtml } from './clipboard-html-read.ts';
import { hasVisibleChar, htmlHasVisibleText } from './clipboard-plain-text.ts';

/** One flavour, defensively: a stand-in transfer without `getData` reads as absent. */
function flavourOf(transfer: DataTransfer, type: string): string {
  if (typeof transfer.getData !== 'function') return '';
  try {
    return transfer.getData(type) ?? '';
  } catch {
    return '';
  }
}

/**
 * True when the engine's PASTE lanes will land user-visible content from this payload, so
 * a host's image-FILE lane must stand down or insert a duplicate.
 *
 * In order of cost: visible `text/plain` (the plain lane's unconditional fallback), visible
 * HTML text (the projection and the plain lane's HTML fallback both land it), a decodable
 * embedded fragment, and finally the projection itself for text-free HTML — the exact
 * decision the paste router makes for `data:` images.
 *
 * Two deliberate asymmetries against the router's letter: text made only of invisible
 * characters (zero-width wrappers, a bare newline) does not count — the router technically
 * lands it, but standing down for it would drop a real image for characters nobody can
 * see. And engine-state gates the adapter cannot observe (suggesting mode, cell
 * selections, the force-plain window) are ignored; in those states the engine may land
 * nothing where this predicate said it would.
 *
 * @public
 */
export function clipboardPasteLandsContent(transfer: DataTransfer | null | undefined): boolean {
  if (!transfer) return false;
  if (hasVisibleChar(flavourOf(transfer, 'text/plain'))) return true;
  const html = flavourOf(transfer, 'text/html');
  if (html.length === 0) return false;
  if (htmlHasVisibleText(html)) return true;
  if (fragmentFromHtml(html) !== null) return true;
  // Text-free HTML: only a projected IMAGE counts. The projection also lands invisible
  // runs and empty paragraphs as blocks, and standing down for those would trade a real
  // image file for content nobody can see.
  const projected = projectExternalHtml(html);
  return projected.ok && projected.imageCount > 0;
}

/**
 * True when the engine's DROP lane will land text from this payload, so a host's
 * image-FILE drop lane must stand down — by NOT preventing the default, which is what
 * lets the browser fire `insertFromDrop`, the engine's only drop path.
 *
 * Only visible HTML text counts. The drop lane is plain text end to end, so fragments and
 * `data:` images never land from a drop — and `text/plain` says nothing about intent here,
 * because image-file drags routinely mirror the file's path or URL into it. A text drag
 * that carries an image file beside it (Word's rendering PNG again) always carries the
 * text in HTML too.
 *
 * @public
 */
export function clipboardDropLandsText(transfer: DataTransfer | null | undefined): boolean {
  if (!transfer) return false;
  return htmlHasVisibleText(flavourOf(transfer, 'text/html'));
}
