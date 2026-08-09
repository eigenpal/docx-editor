// Reading a native browser selection back as MODEL positions.
//
// The paginated surface paints layout records, so every interaction it does not implement
// by hand simply does not exist: no drag, no double-click word, no triple-click paragraph,
// no shift-extend. Hand-writing those is how an editor spends years catching up with
// behaviour the browser already ships — including the parts nobody remembers, like
// double-click selecting a word differently per locale.
//
// So the browser owns the GESTURE and layout keeps owning the GEOMETRY. The painter already
// stamps every span with the source range it came from, which is enough to turn a DOM
// anchor/focus into a paragraph id and a UTF-16 offset:
//
//   span[data-paragraph-id="p3"][data-start="12"] + 4 characters into its text -> (p3, 16)
//
// This reads DOM IDENTITY and text offsets — never `getBoundingClientRect`, never a computed
// style. Nothing here derives geometry, so the layout records remain the only answer to
// where anything is; this only decides WHICH characters the user gestured over.

import type { SemanticPosition, SemanticSelection } from '@docx-editor.dev/core/layout';

/** A painted span carries the source range it was laid out from. */
interface SpanIdentity {
  readonly paragraphId: string;
  readonly start: number;
  /**
   * The span's model END, which is NOT `start + textContent.length` for every span.
   *
   * A field is one model unit however many characters its result paints — "Scope of the
   * discussions" is 24 glyphs over a range of 1. Deriving the endpoint from the painted text
   * therefore handed back an offset the paragraph does not have, and the edit built from it
   * was refused: a caret placed just after such a field could not type at all.
   */
  readonly end: number;
}

/**
 * The furthest model offset a gesture inside `identity` can mean.
 *
 * Clamped to the span's own RANGE, not to its text. Where the two agree — ordinary runs, which
 * is nearly everything — this changes nothing.
 */
function offsetWithin(identity: SpanIdentity, within: number): number {
  const span = Math.max(0, identity.end - identity.start);
  return identity.start + Math.max(0, Math.min(within, span));
}

/** Node ids are `part#path`, and the part name comes from the document. */
const PARAGRAPH_ID = /^[^\s]{1,512}$/;

function identityOf(element: Element): SpanIdentity | null {
  const paragraphId = (element as HTMLElement).dataset?.paragraphId;
  const rawStart = (element as HTMLElement).dataset?.start;
  if (!paragraphId || rawStart === undefined) return null;
  // BOTH values are re-validated. They round-trip through the DOM, where anything on the
  // page could have rewritten them, and the id then flows into a tree op as the paragraph to
  // mutate. `__proto__` as an id is refused here rather than relied on being refused later.
  if (!/^\d{1,9}$/.test(rawStart)) return null;
  if (!PARAGRAPH_ID.test(paragraphId) || paragraphId === '__proto__') return null;
  const start = Number(rawStart);
  // `data-end` is written with `data-start` by the same painter branch, and validated the same
  // way for the same reason. A span missing or misreporting it falls back to the painted
  // length, which is the pre-existing behaviour and correct for every 1:1 span.
  const rawEnd = (element as HTMLElement).dataset?.end;
  const end =
    rawEnd !== undefined && /^\d{1,9}$/.test(rawEnd) && Number(rawEnd) >= start
      ? Number(rawEnd)
      : start + ((element as HTMLElement).textContent?.length ?? 0);
  return { paragraphId, start, end };
}

/** The nearest ancestor (or self) that is a painted span. */
function spanFor(node: Node): { element: Element; identity: SpanIdentity } | null {
  let current: Node | null = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const identity = identityOf(current as Element);
    if (identity) return { element: current as Element, identity };
    current = current.parentNode;
  }
  return null;
}

/** The header/footer container open for editing, when any. */
function activeHeaderFooterRoot(root: Element): Element | null {
  return root.querySelector('[data-docx-hf-active]');
}

/**
 * Search roots for painted spans, preferring the active header/footer when one is open.
 *
 * Shared header/footer parts paint the same paragraph ids on every page; the active
 * container is the caret target the user entered.
 */
function spanSearchRoots(root: Element): readonly Element[] {
  const active = activeHeaderFooterRoot(root);
  return active ? [active, root] : [root];
}

/** The first painted span at, above, or inside a node — whichever comes first in DOM order. */
function spanAtOrInside(
  node: Node,
  last: boolean
): { element: Element; identity: SpanIdentity } | null {
  const own = spanFor(node);
  if (own) return own;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const spans = (node as Element).querySelectorAll('[data-paragraph-id][data-start]');
  const ordered = last ? [...spans].reverse() : [...spans];
  for (const span of ordered) {
    const identity = identityOf(span);
    if (identity) return { element: span, identity };
  }
  return null;
}

/**
 * Resolve an endpoint expressed as a child index into a model position.
 *
 * A selection endpoint can land on a line or fragment element rather than on text —
 * triple-clicking a paragraph, or dragging past the end of a line, does exactly that. The
 * offset is then a CHILD INDEX, not a character offset.
 *
 * The children are not all model text. A paragraph fragment holds a shading band, a list
 * marker, tab leaders and border rules alongside its lines, and the RULES ARE PAINTED LAST —
 * so "after the last child" landed on a border rather than on the final run, and any index
 * that happened to hit furniture resolved to nothing. Both cases then fell through to the
 * empty-line answer, offset zero, silently moving the endpoint to the paragraph start.
 *
 * So scan outward from the index instead of clamping to one child: forward for the next
 * painted text (its START, the position the index points AT), then backward for the previous
 * (its END, the position the index points AFTER).
 */
function positionFromChildIndex(container: Element, index: number): SemanticPosition | null {
  const children = [...container.childNodes];
  if (children.length === 0) return null;
  for (let at = Math.max(0, index); at < children.length; at += 1) {
    const found = spanAtOrInside(children[at]!, false);
    if (found) return { paragraphId: found.identity.paragraphId, offset: found.identity.start };
  }
  for (let at = Math.min(index, children.length) - 1; at >= 0; at -= 1) {
    const found = spanAtOrInside(children[at]!, true);
    if (!found) continue;
    return { paragraphId: found.identity.paragraphId, offset: found.identity.end };
  }
  return null;
}

/**
 * Turn one DOM endpoint into a model position.
 *
 * Returns null when the endpoint is not inside painted content at all, which is how a
 * selection living in the offscreen input host is told from one the user made on the page.
 */
export function positionFromDomPoint(
  node: Node,
  offset: number,
  root: Element
): SemanticPosition | null {
  if (!root.contains(node)) return null;

  const nearestElement =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;

  // Live-projected PAGE/NUMPAGES fields are inert furniture: they carry no editable model
  // text until typed fields land.
  if (nearestElement?.closest('[data-docx-field]')) return null;

  // Header/footer furniture is painted, not editable, unless this copy is the active scope.
  const headerFooter = nearestElement?.closest('[data-docx-hf]');
  if (headerFooter && !headerFooter.hasAttribute('data-docx-hf-active')) return null;

  // While a header/footer is open, the body content box is inert — the user is editing
  // furniture, not the story.
  if (activeHeaderFooterRoot(root) && nearestElement?.closest('.docx-page-content')) return null;

  // A LIST MARKER is furniture with one honest answer. It carries no source range, so it
  // cannot be mapped through a child index — but it is painted at the paragraph's own start,
  // inside the hanging indent, which is exactly the position Word gives a click on a bullet.
  //
  // Returning nothing instead is what made this worth changing: a double-click on the first
  // word of a list item can anchor in the marker, the whole selection then failed to map,
  // and the caller kept the PREVIOUS model selection while the browser showed the new one —
  // so the next toolbar command formatted a range the user could no longer see.
  //
  // The engine's painted caret shares this attribute but hangs off the page content box, so
  // it has no owning paragraph and still resolves to nothing, which is what it should do.
  const marker = nearestElement?.closest('[data-docx-marker]');
  if (marker) return marker.parentElement ? paragraphStartAt(marker.parentElement) : null;

  // A TAB LEADER has no such answer: it is drawn across the advance of a tab in the MIDDLE
  // of a paragraph, so the paragraph start would be a lie and its repeated glyphs are not
  // model characters. It is `pointer-events: none` and `user-select: none`, so a real
  // endpoint should never land in one; refusing explicitly keeps that a property rather than
  // an accident of how the ancestors happen to be attributed.
  if (nearestElement?.closest('[data-docx-tab-leader]')) return null;

  // An ELEMENT endpoint carries a child index, never a character offset — including when the
  // element is a painted span. Runs are inline-blocks, so a shift-click or a drag across one
  // is exactly when a browser reports the span itself as the endpoint; reading that index as
  // a character offset silently moved the selection to near the start of the run.
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as Element;
    const identity = identityOf(element);
    if (identity) {
      return {
        paragraphId: identity.paragraphId,
        offset: offset > 0 ? identity.end : identity.start,
      };
    }
    const resolved = positionFromChildIndex(element, offset);
    if (resolved) return resolved;
    // An EMPTY line still has a caret position: the paragraph it belongs to, at its start.
    return emptyLinePosition(element);
  }

  const found = spanFor(node);
  if (!found) return null;

  // Clamp to the span's own RANGE: a browser may report an offset past the end for an endpoint
  // that sits at a boundary between elements, and a field's painted result is wider than the
  // one offset it occupies.
  return {
    paragraphId: found.identity.paragraphId,
    offset: offsetWithin(found.identity, offset),
  };
}

/**
 * The current native selection expressed in model coordinates.
 *
 * Null when there is no selection, or when it is not inside the painted content — the
 * caller must not mistake the caret sitting in the offscreen input host for the user having
 * selected nothing.
 */
export function semanticSelectionFromDom(
  root: Element,
  domSelection: Selection | null
): SemanticSelection | null {
  if (!domSelection || domSelection.rangeCount === 0) return null;
  const { anchorNode, anchorOffset, focusNode, focusOffset } = domSelection;
  if (!anchorNode || !focusNode) return null;

  const anchor = positionFromDomPoint(anchorNode, anchorOffset, root);
  const head = positionFromDomPoint(focusNode, focusOffset, root);
  // ONE resolvable end is still an answer. A drag that starts in the body and ends in the
  // header, or the reverse, has an end the model can address; collapsing to it costs the
  // user a range they could not have edited anyway, whereas returning nothing left the model
  // on whatever it held BEFORE the gesture — and the next command ran on that.
  if (!anchor || !head) {
    const only = anchor ?? head;
    return only ? { anchor: only, head: only } : null;
  }
  // Anchor and head are kept in the order the USER dragged them, not sorted: which end is
  // moving is what shift-arrow has to extend from.
  return { anchor, head };
}

/**
 * Whether a native selection is inside the painted pages at all.
 *
 * Tells "the user gestured here and it did not map" from "the selection belongs to something
 * else on the page" — the first must never leave a stale model selection behind, the second
 * must never disturb one.
 */
export function domSelectionTouchesPages(root: Element, domSelection: Selection | null): boolean {
  if (!domSelection || domSelection.rangeCount === 0) return false;
  const { anchorNode, focusNode } = domSelection;
  return (!!anchorNode && root.contains(anchorNode)) || (!!focusNode && root.contains(focusNode));
}

/**
 * The DOM point for a model position.
 *
 * The inverse of `positionFromDomPoint`, and just as necessary: arrow keys, undo and
 * programmatic selection move the MODEL, and the browser only draws a caret and a highlight
 * for its OWN selection. Without writing the position back, pressing Right would move the
 * model and leave the visible caret where it was.
 */
function domPointFromPosition(
  root: Element,
  position: SemanticPosition
): { node: Node; offset: number } | null {
  for (const searchRoot of spanSearchRoots(root)) {
    const point = domPointFromPositionIn(searchRoot, position);
    if (point) return point;
  }
  return null;
}

function domPointFromPositionIn(
  searchRoot: Element,
  position: SemanticPosition
): { node: Node; offset: number } | null {
  const spans = searchRoot.querySelectorAll('[data-paragraph-id][data-start]');
  let fallback: { node: Node; offset: number } | null = null;
  let emptyLine: Element | null = null;
  for (const span of spans) {
    const identity = identityOf(span);
    if (!identity || identity.paragraphId !== position.paragraphId) continue;
    const text = textNodeOf(span);
    const length = span.textContent?.length ?? 0;
    const end = identity.end;
    if (!text) continue;
    if (position.offset >= identity.start && position.offset <= end) {
      // A position on a boundary belongs to the span that STARTS there, so a caret between
      // two words sits before the second rather than after the first. The first match wins
      // for the interior; the boundary case keeps looking so the later span is preferred.
      //
      // The DOM offset is clamped to the painted text, which is a different length from the
      // model range wherever a field is: one model unit can be 24 glyphs, and asking a text
      // node for character 1 of 24 would put the native selection inside a word the model
      // has no position inside.
      const point = {
        node: text,
        offset: Math.min(position.offset - identity.start, length),
      };
      if (position.offset < end) return point;
      fallback = point;
    }
  }
  if (fallback) return fallback;

  // An EMPTY paragraph paints a line with no spans, so there is no text node to point at —
  // yet it still has exactly one caret position. Without this the caret vanished after every
  // Enter, and Select All drew no highlight at all on a document ending in a blank
  // paragraph, which is nearly every document Word writes.
  emptyLine = lineOfParagraph(searchRoot, position.paragraphId);
  return emptyLine ? { node: emptyLine, offset: 0 } : null;
}

/**
 * The text node a span's characters actually live in.
 *
 * A run that is BOTH underlined and struck mounts its text under nested decoration spans, so
 * the run element's first child is an element rather than the text. Handing that to
 * `setBaseAndExtent` with a character offset turns the offset into a CHILD INDEX, and the
 * browser rejects the whole write — no caret and no highlight anywhere inside such a run.
 */
function textNodeOf(span: Element): Node | null {
  let node: Node | null = span.firstChild;
  while (node && node.nodeType === Node.ELEMENT_NODE) node = node.firstChild;
  return node && node.nodeType === Node.TEXT_NODE ? node : null;
}

/** The painted line belonging to a paragraph, whether or not it holds any runs. */
function lineOfParagraph(root: Element, paragraphId: string): Element | null {
  let fragment: Element | null = null;
  for (const line of root.querySelectorAll('[data-paragraph-id]')) {
    if ((line as HTMLElement).dataset?.paragraphId !== paragraphId) continue;
    if ((line as HTMLElement).dataset?.start !== undefined) continue;
    // The paragraph FRAGMENT carries the same identity as its line. The line is the caret
    // target: the fragment's in-flow content box is empty (its children are absolutely
    // positioned), which browsers refuse as a caret position and canonicalize away from.
    if ((line as HTMLElement).dataset?.lineId !== undefined) return line;
    fragment ??= line;
  }
  return fragment;
}

/** The start of the paragraph an element was painted for, whatever the element is. */
function paragraphStartAt(element: Element): SemanticPosition | null {
  // Resolved via `closest`, not the element's own dataset: the endpoint may be the caret
  // anchor <br> INSIDE the line rather than the line itself.
  const container = element.closest('[data-paragraph-id]') as HTMLElement | null;
  // A span hit (`data-start`) is not a container — refusing keeps a future inline
  // element from silently snapping the caret to the paragraph start.
  if (!container || container.dataset.start !== undefined) return null;
  const paragraphId = container.dataset.paragraphId;
  if (!paragraphId || !PARAGRAPH_ID.test(paragraphId) || paragraphId === '__proto__') return null;
  return { paragraphId, offset: 0 };
}

/** The caret position for an empty painted line: the start of the paragraph it belongs to. */
function emptyLinePosition(element: Element): SemanticPosition | null {
  const start = paragraphStartAt(element);
  if (!start) return null;
  // A container that HOLDS painted text is not an empty line, and an endpoint that reached
  // here through one arrived on FURNITURE — a border rule, a shading band, a tab leader.
  // Answering "offset 0" for those silently dragged the endpoint to the paragraph start,
  // which on a bordered or shaded paragraph turned a click near its edge into a selection
  // running back to the beginning.
  const container = element.closest('[data-paragraph-id]')!;
  if (container.querySelector('[data-paragraph-id][data-start]')) return null;
  return start;
}

/**
 * Write a model selection into the browser's own selection.
 *
 * Returns false when either endpoint is not painted — a position inside a page that is not
 * currently rendered, once virtualization lands.
 */
export function applySelectionToDom(
  root: Element,
  selection: SemanticSelection,
  domSelection: Selection | null
): boolean {
  if (!domSelection) return false;
  const anchor = domPointFromPosition(root, selection.anchor);
  const head = domPointFromPosition(root, selection.head);
  if (!anchor || !head) return false;
  const current = semanticSelectionFromDom(root, domSelection);
  // Already correct: re-setting it would collapse an in-progress drag and fight the user.
  if (current && selectionsEqual(current, selection)) return true;
  try {
    // `setBaseAndExtent` keeps the anchor/head ORDER, which is what shift-arrow extends
    // from; collapsing and extending would lose the direction.
    domSelection.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
    return true;
  } catch {
    // A detached or replaced node between paint and sync: the next paint re-syncs.
    return false;
  }
}

/** Whether two selections address the same range, so a no-op event can be ignored. */
export function selectionsEqual(a: SemanticSelection, b: SemanticSelection): boolean {
  return (
    a.anchor.paragraphId === b.anchor.paragraphId &&
    a.anchor.offset === b.anchor.offset &&
    a.head.paragraphId === b.head.paragraphId &&
    a.head.offset === b.head.offset
  );
}
