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

import type { SemanticPosition, SemanticSelection } from '@docx-editor.dev/engine-layout';

/** A painted span carries the source range it was laid out from. */
interface SpanIdentity {
  readonly paragraphId: string;
  readonly start: number;
}

function identityOf(element: Element): SpanIdentity | null {
  const paragraphId = (element as HTMLElement).dataset?.paragraphId;
  const rawStart = (element as HTMLElement).dataset?.start;
  if (!paragraphId || rawStart === undefined) return null;
  // File-derived ids reach the DOM as data attributes, so the value coming back is parsed
  // and range-checked rather than trusted to be the number that was written.
  if (!/^\d{1,9}$/.test(rawStart)) return null;
  return { paragraphId, start: Number(rawStart) };
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

/**
 * The first painted span at or after a container/offset that is not itself a span.
 *
 * A selection endpoint can land on a line or fragment element rather than on text — clicking
 * in the empty space to the right of a short line does exactly that. The endpoint then means
 * "between these children", so the neighbouring span is the honest answer.
 */
function spanNearContainer(container: Element, offset: number): Node | null {
  const children = [...container.childNodes];
  return children[Math.min(offset, children.length - 1)] ?? null;
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

  let target: Node | null = node;
  let within = offset;
  if (node.nodeType === Node.ELEMENT_NODE && !identityOf(node as Element)) {
    const near = spanNearContainer(node as Element, offset);
    if (!near) return null;
    target = near;
    // The endpoint addressed a child boundary, not a character, so the offset does not
    // carry over: start at the beginning of whatever span that boundary points at.
    within = 0;
  }

  const found = target ? spanFor(target) : null;
  if (!found) return null;

  // Clamp to the span's own text: a browser may report an offset past the end for an
  // endpoint that sits at a boundary between elements.
  const length = found.element.textContent?.length ?? 0;
  return {
    paragraphId: found.identity.paragraphId,
    offset: found.identity.start + Math.max(0, Math.min(within, length)),
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
  if (!anchor || !head) return null;
  // Anchor and head are kept in the order the USER dragged them, not sorted: which end is
  // moving is what shift-arrow has to extend from.
  return { anchor, head };
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
