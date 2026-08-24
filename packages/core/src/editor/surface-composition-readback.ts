// What the browser currently shows for a paragraph, IN THE MODEL'S OWN OFFSET SPACE.
//
// `beforeinput` for `insertCompositionText` is not cancelable, so an IME's text unavoidably
// lands in the painted DOM and this readback is the ONLY route by which it reaches the tree.
// The caller diffs the string this returns against the paragraph's model text and commits the
// difference, so every character this gets wrong is a character the document gets wrong.
//
// THE MIRROR OF `paragraphTextFromLayout`. That function builds the MODEL side of the same
// diff out of the layout records, and it has already had to answer every question here: it
// contributes each model range once (a paragraph crossing a page paints the same ranges
// twice), clamps a projected atom to its model width, counts an inline drawing as the one
// UTF-16 unit it occupies, and pads a gap so offsets stay aligned. This side must answer them
// the same way, or the two disagree and the diff explains the disagreement by editing the
// document. It differs in exactly one respect, which is the whole point: it reads the PAINTED
// text, so wherever the browser has written something, that is what comes back.
//
// Four ways a naive read gets it wrong, each of which cost a document:
//
//   - Text that is not inside a `[data-start]` span. An empty paragraph paints a line holding
//     nothing but a `<br>`, so the browser is handed the LINE as the selection node and
//     composes a bare text node into it (#190).
//   - Furniture that IS inside the paragraph. A list marker's bullet, a tab leader's dots, the
//     revision pilcrow, a drawing's placeholder label — none are characters the model has.
//   - The same paragraph painted more than once: a shared header, a repeating table header
//     row, a twice-referenced footnote. Joining every copy read a three-page header back as
//     three concatenated copies of itself.
//   - Model offsets NOTHING paints: an inline drawing's atom, a `w:vanish` hidden run. Read as
//     absent, they read as deleted — so one composition anywhere in the paragraph removed the
//     image, or the hidden text, permanently and silently.

import { paragraphElements } from './dom-selection.ts';

/**
 * One contribution to the readback.
 *
 * `end` is the MODEL end, which is not `start + text.length` for everything: a field atom is
 * one model unit however many glyphs it paints, and a stray the browser wrote occupies no
 * model range at all. `seq` is DOM order, which is the only thing that can say whether text
 * the browser wrote sits before or after a span that starts at the same offset.
 */
interface PaintedPiece {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly seq: number;
}

/**
 * Furniture painted INSIDE a paragraph, which is never model text.
 *
 * A list marker's bullet, a tab leader's dots, the revision pilcrow, the inline-drawing and
 * float-wrap advance spacers, and a zero-width `w:ptab`'s painted `\t` all carry glyphs the
 * model does not have.
 *
 * `[data-drawing-node-id]` is every painted drawing, and it is load-bearing rather than
 * belt-and-braces. An inline drawing is appended to the LINE, and while its resource is
 * pending — or missing, or of a format that will not decode — it paints a placeholder card
 * whose label reads "Loading image". That card is only `aria-hidden` when the drawing has NO
 * alt text, because `applyAccessibility` gives a labelled drawing `aria-label` instead. So a
 * `.docx` supplying `wp:docPr/@descr` made its own label part of the paragraph on the next
 * composition. The drawing's own model unit still arrives, from the gap fill below.
 *
 * `contenteditable="false"` says the same thing in the browser's own words and catches the
 * rest. Asked only of a DESCENDANT, never of the container the walk starts at: a read-only
 * paragraph carries the attribute on its own fragment, and the body content box carries it
 * whenever a header is open.
 */
const PAINTED_FURNITURE =
  '[data-docx-marker],[data-docx-tab-leader],[aria-hidden="true"],[contenteditable="false"],[data-drawing-node-id]';

/** A `data-end` is only believed when it is a plausible model end for its own start. */
function modelEndOf(element: HTMLElement, start: number, fallback: number): number {
  const rawEnd = element.dataset.end;
  if (rawEnd === undefined || !/^\d{1,9}$/.test(rawEnd)) return fallback;
  const end = Number(rawEnd);
  return end >= start ? end : fallback;
}

/** A span's model start, or null when it does not publish a usable one. */
function modelStartOf(element: HTMLElement, paragraphId: string): number | null {
  if (element.dataset.paragraphId !== paragraphId) return null;
  const rawStart = element.dataset.start;
  if (rawStart === undefined || !/^\d{1,9}$/.test(rawStart)) return null;
  return Number(rawStart);
}

/**
 * The sheet a node was painted on.
 *
 * WHICH COPY the caret is in is the only honest answer to a paragraph painted many times, and
 * a repeating table header row has no active-scope attribute to ask instead — every copy is
 * ordinary body content on a different page.
 */
function sheetOf(node: Node | null): Element | null {
  if (!node) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest('.docx-page') ?? null;
}

/**
 * How strongly a painted copy claims to be the one that was composed into.
 *
 * The container itself is asked before the sheet, because the sheet cannot always tell them
 * apart: a footnote referenced twice paints both copies on the SAME page, so a sheet test
 * scores them equally and the first — the one the IME did not write — would win, and the
 * composed text would be dropped rather than duplicated.
 */
function anchorAffinity(
  element: Element,
  anchor: Node | null,
  anchorSheet: Element | null
): number {
  if (anchor && element.contains(anchor)) return 2;
  if (anchorSheet?.contains(element)) return 1;
  return 0;
}

/** What a span contributes: the model's own characters for a projected atom, else its text. */
function spanPiece(
  element: HTMLElement,
  start: number,
  modelText: string,
  seq: number
): PaintedPiece {
  if (element.dataset.docxField !== undefined) {
    // A PROJECTED atom — one layout owns the glyphs of — is one model unit however many
    // characters it paints, and the browser cannot write inside one. So it contributes the
    // MODEL's characters for its range: "Scope of the discussions" is 24 glyphs over a range
    // of 1, and joining the painted text made the diff delete the field and insert its own
    // rendering as literal text.
    const end = modelEndOf(element, start, start);
    return { start, end, text: modelText.slice(start, end), seq };
  }
  const text = element.textContent ?? '';
  // The PUBLISHED range, not the painted length: the IME has just rewritten this text, so its
  // length says where the caret is, not where the next model offset begins.
  return { start, end: modelEndOf(element, start, start + text.length), text, seq };
}

/** State threaded through the DOM-order walk. */
interface ReadbackWalk {
  readonly paragraphId: string;
  readonly modelText: string;
  readonly pieces: PaintedPiece[];
  /** Model ranges already contributed, so a repeat cannot contribute twice. */
  readonly ranges: Set<string>;
  /** The model offset just past the last span walked: where a stray text node sits. */
  end: number;
  /** DOM order, so a stray keeps the side of a span the browser put it on. */
  seq: number;
}

/**
 * Walk one painted container in DOM order, collecting spans AND the text between them.
 *
 * DOM order is what places text the browser wrote outside any span. An empty paragraph paints
 * a line holding nothing but a `<br>`, and a paragraph whose only content is a field paints
 * spans the caret is refused inside, so in both the browser is handed the LINE as the
 * selection node and composes a bare text node into it. A stray contributes at the model
 * offset the walk has reached, so it lands before or after the spans exactly as placed.
 */
function walkContainer(container: Element, walk: ReadbackWalk): void {
  for (const node of container.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      // A stray occupies no model range (`end === start`), because it is text the model does
      // not have yet — that is the whole reason it is worth reading.
      if (text.length > 0) {
        walk.pieces.push({ start: walk.end, end: walk.end, text, seq: walk.seq });
        walk.seq += 1;
      }
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const element = node as HTMLElement;
    const start = modelStartOf(element, walk.paragraphId);
    if (start === null) {
      // Not one of our spans. A span published for ANOTHER paragraph is not ours to read
      // either — a resolved display mode lays merged paragraphs out on one line, so this is
      // an ordinary page, not a malformed one.
      if (element.dataset?.start !== undefined) continue;
      if (element.matches?.(PAINTED_FURNITURE)) continue;
      // A line, a hyperlink anchor, a decoration wrapper: descend.
      walkContainer(element, walk);
      continue;
    }
    const piece = spanPiece(element, start, walk.modelText, walk.seq);
    walk.seq += 1;
    walk.end = Math.max(walk.end, piece.end);
    // ONCE PER RANGE. A field's result splits at its spaces and every resulting span
    // republishes the same model range; a paragraph crossing a page paints its ranges on both
    // sheets. Either way the second one is the same characters, not more of them.
    const key = `${piece.start}:${piece.end}`;
    if (walk.ranges.has(key)) continue;
    walk.ranges.add(key);
    walk.pieces.push(piece);
  }
}

/**
 * The outermost painted containers for a paragraph, one per fragment.
 *
 * A paragraph that crosses a page has a fragment on each sheet and they hold DIFFERENT text,
 * so both are walked. A paragraph painted many times over — a shared header, a repeating
 * `w:tblHeader` row, a twice-referenced footnote — republishes the SAME fragment index, and
 * only the copy the caret is in can have been composed into.
 */
function paragraphContainers(
  root: Element,
  paragraphId: string,
  anchor: Node | null,
  anchorSheet: Element | null
): readonly Element[] {
  const outermost: HTMLElement[] = [];
  // Through the selection reader's own lookup, which carries the guard against an id that
  // cannot be interpolated into a CSS selector; one copy of that rule, not two.
  for (const candidate of paragraphElements(root, paragraphId, '')) {
    const element = candidate as HTMLElement;
    if (element.dataset.paragraphId !== paragraphId) continue;
    // A span is content, not a container, and a line lives inside the fragment that already
    // covers it — walking both would read every character twice.
    if (element.dataset.start !== undefined) continue;
    if (outermost.some((outer) => outer.contains(element))) continue;
    outermost.push(element);
  }
  const chosen = new Map<string, { element: HTMLElement; affinity: number }>();
  for (const element of outermost) {
    const key = element.dataset.fragmentIndex ?? '';
    const affinity = anchorAffinity(element, anchor, anchorSheet);
    const held = chosen.get(key);
    // Strictly greater, so the FIRST copy still wins a tie — including the tie every copy
    // scores when there is no anchor at all.
    if (!held || affinity > held.affinity) chosen.set(key, { element, affinity });
  }
  return [...chosen.values()].map((held) => held.element);
}

/**
 * Spans this paragraph published that no container of its own covers.
 *
 * A resolved display mode folds a mark-deleted paragraph into the survivor that follows it and
 * lays both out on one line. The line is stamped with its FIRST span's paragraph and the
 * fragment with the survivor's id, so an absorbed member whose text starts mid-line owns no
 * container for the line its own words are painted in. Walking containers alone therefore lost
 * that member's text — and the diff, seeing the model hold characters the page did not, took
 * the composition as licence to delete them.
 */
function sweepUncoveredSpans(root: Element, covered: readonly Element[], walk: ReadbackWalk): void {
  for (const candidate of paragraphElements(root, walk.paragraphId, '[data-start]')) {
    const element = candidate as HTMLElement;
    const start = modelStartOf(element, walk.paragraphId);
    if (start === null) continue;
    if (covered.some((container) => container.contains(element))) continue;
    const piece = spanPiece(element, start, walk.modelText, walk.seq);
    walk.seq += 1;
    const key = `${piece.start}:${piece.end}`;
    if (walk.ranges.has(key)) continue;
    walk.ranges.add(key);
    walk.pieces.push(piece);
  }
}

/**
 * Join the pieces, filling from the model wherever nothing painted claims the offsets.
 *
 * A GAP IS NOT A DELETION. An inline drawing occupies one UTF-16 unit and publishes no span —
 * it is painted beside the text, not as it. A `w:vanish` run advances offsets and paints
 * nothing at all. Both leave a hole between one span's model end and the next one's start, and
 * reading a hole as absent read it as deleted: one composition anywhere in the paragraph
 * removed the image, or the hidden run, and no undo of the user's own could explain why.
 *
 * Filling from `modelText` says the only true thing about a range the browser has no
 * representation of: it cannot have been touched. `paragraphTextFromLayout` pads the same
 * holes on the model side, so the two agree and the diff describes only real edits.
 */
function joinPieces(pieces: readonly PaintedPiece[], modelText: string): string {
  const ordered = [...pieces].sort((a, b) => a.start - b.start || a.seq - b.seq);
  let out = '';
  let covered = 0;
  for (const piece of ordered) {
    if (piece.start > covered) out += modelText.slice(covered, piece.start);
    out += piece.text;
    covered = Math.max(covered, piece.end);
  }
  if (covered < modelText.length) out += modelText.slice(covered);
  return out;
}

/**
 * The painted text of one paragraph, or null when this DOM shows the paragraph nowhere.
 *
 * `modelText` is the paragraph's current model text, which the caller already holds. `anchor`
 * is the node the browser's own selection is in, which is how a paragraph painted many times
 * says which copy was composed into; without one the first copy is read.
 */
export function paintedTextIn(
  root: Element,
  paragraphId: string,
  modelText: string,
  anchor: Node | null
): string | null {
  const containers = paragraphContainers(root, paragraphId, anchor, sheetOf(anchor));
  const walk: ReadbackWalk = {
    paragraphId,
    modelText,
    pieces: [],
    ranges: new Set<string>(),
    end: 0,
    seq: 0,
  };
  for (const container of containers) walkContainer(container, walk);
  sweepUncoveredSpans(root, containers, walk);
  if (walk.pieces.length === 0) return null;
  return joinPieces(walk.pieces, modelText);
}
