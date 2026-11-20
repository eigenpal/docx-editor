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
//
// `imageFilePastePlan` adds the target: the caret in text, or, while a drawing is selected,
// the point `drawingPastePoint` gives for a picture. The pages and the drawing selection
// overlay both run it.

import { fragmentFromHtml } from './clipboard-fragment-codec.ts';
import { probeExternalHtml } from './clipboard-html-read.ts';
import { hasVisibleChar, htmlHasVisibleText } from './clipboard-plain-text.ts';
import { drawingPastePoint } from './drawing-paste-target.ts';
import { capturePointPosition } from './editor-point-target.ts';
import { PICTURE_SELECTED_INSERT_REASON } from './docx-editor-images.ts';
import { IMAGE_INSERT_PROBE_BYTES } from './toolbar-commands.ts';
import type { EditorPointPosition } from '../contracts/editor-drop.ts';
import type { DocxEditorInstance } from './docx-editor-types.ts';

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
 * HTML text (the projection and the plain lane's HTML fallback both land it), a
 * zip-shaped embedded fragment, and finally the projection probe for text-free HTML.
 *
 * Deliberate asymmetries against the router's letter: text made only of invisible
 * characters (zero-width wrappers, bidi marks, a bare newline) does not count — the router
 * technically lands it, but standing down for it would drop a real image for characters
 * nobody can see. And engine-state gates the adapter cannot observe (suggesting mode, cell
 * selections, the force-plain window) are ignored; in those states the engine may land
 * nothing where this predicate said it would.
 *
 * @internal
 */
export function clipboardPasteLandsContent(transfer: DataTransfer | null | undefined): boolean {
  if (!transfer) return false;
  if (hasVisibleChar(flavourOf(transfer, 'text/plain'))) return true;
  const html = flavourOf(transfer, 'text/html');
  if (html.length === 0) return false;
  if (htmlHasVisibleText(html)) return true;
  // Text-free HTML. An embedded fragment counts only when its bytes are at least
  // zip-shaped — the router refuses everything else and would land nothing. (A zip that
  // fails deeper package reads still slips through; fully validating it here would
  // duplicate the router's whole bounded open per gesture.)
  const embedded = fragmentFromHtml(html);
  if (embedded !== null && embedded.bytes[0] === 0x50 && embedded.bytes[1] === 0x4b) return true;
  // Otherwise only a projected IMAGE counts. The projection also lands invisible runs and
  // empty paragraphs as blocks, and standing down for those would trade a real image file
  // for content nobody can see.
  return probeExternalHtml(html).imageCount > 0;
}

function carriesImageFile(transfer: DataTransfer): boolean {
  const items = transfer.items as DataTransferItemList | undefined;
  if (!items) return false;
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item?.kind === 'file' && item.type.startsWith('image/')) return true;
  }
  return false;
}

/**
 * What a host's image-FILE paste lane does with one paste event.
 *
 * @internal
 */
export interface ImageFilePastePlan {
  /**
   * The `insertImage.at` point. A point is the drawing paste point while a drawing is
   * selected. Undefined inserts as `insertImage` does with no point: at the caret, or, when
   * the editor refuses a picture beside the selected drawing in suggesting mode, with that
   * refusal reported.
   */
  readonly at: EditorPointPosition | undefined;
}

/**
 * Whether a host's image-FILE lane takes this paste, and where the picture goes. Null means
 * stand down: no image file, content the engine lands itself (see
 * {@link clipboardPasteLandsContent}), an insert the editor refuses for any reason other than
 * the one below, or a document open for viewing. A paste the lane stands down from stays
 * silent, as a refused paste in text does.
 *
 * With the caret in text, the picture lands at the caret. With a drawing selected, it lands
 * where every pasted drawing lands, `drawingPastePoint(surface)`: before the selected
 * drawing's anchor run. That point is captured, and stays valid only while the document keeps
 * the same revision, so a slow file read cannot insert into changed content; an insert into
 * changed content reports its stale-target reason. In suggesting mode the editor refuses a
 * picture beside a selected drawing (`PICTURE_SELECTED_INSERT_REASON`). The lane still takes
 * that paste, so the insert reports the reason the reader needs.
 *
 * @internal
 */
export function imageFilePastePlan(
  editor: Pick<DocxEditorInstance, 'surface' | 'canExecuteImageCommand'>,
  transfer: DataTransfer | null | undefined
): ImageFilePastePlan | null {
  if (!transfer || !carriesImageFile(transfer)) return null;
  if (clipboardPasteLandsContent(transfer)) return null;
  const surface = editor.surface;
  if (!surface) return null;
  // The probe the toolbar's picture insert runs, with no point, so the editor applies its own
  // rules for a picture inserted while a drawing is selected.
  const judged = editor.canExecuteImageCommand({
    type: 'insertImage',
    data: IMAGE_INSERT_PROBE_BYTES,
    mime: 'image/png',
    widthPoints: 72,
    heightPoints: 72,
  });
  const point = drawingPastePoint(surface);
  if (!judged.ok) {
    return point && judged.reason === PICTURE_SELECTED_INSERT_REASON ? { at: undefined } : null;
  }
  return { at: point ? capturePointPosition(surface, point) : undefined };
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
 * @internal
 */
export function clipboardDropLandsText(transfer: DataTransfer | null | undefined): boolean {
  if (!transfer) return false;
  return htmlHasVisibleText(flavourOf(transfer, 'text/html'));
}
