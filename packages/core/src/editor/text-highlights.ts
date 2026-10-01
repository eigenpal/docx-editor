// Named, paint-only text highlight sets: the engine half of `Editor.setHighlights()`.
//
// The sets live on the FACADE, not the surface. A surface is rebuilt when fonts resolve and
// when the editor moves containers, and a host that marked its glossary terms once must not
// lose them to either. Each new surface gets the painter installed again.
//
// A mark never covers the wrong text. Every range records the model text it covered, and every
// paint after a document change checks that text again. An edit elsewhere keeps the mark; an
// edit inside it stops it painting until the host sets it again. A `TextMatch` records its text
// when `findMatches()` returns it, so a match array that is a revision old when the host sets
// it is checked against the text it was found in, never against what now sits at its offsets.

import { findNode, paragraphTextOf } from '@docx-editor.dev/core/store';
import type {
  EditorHighlights,
  HighlightHit,
  HighlightOptions,
  HighlightRange,
  HighlightResult,
} from '../contracts/editor-highlights.ts';
import type { SemanticLayout } from '../layout/semantic-records.ts';
import {
  paragraphRangeRects,
  placedParagraphIds,
  type ParagraphRange,
} from '../layout/paragraph-range-rects.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import type { SurfaceOverlayFrame } from './surface-overlay-sheet.ts';
import { partOfNodeId } from './surface-scope.ts';
import { textboxPresenceLayout } from './textbox-presence-layout.ts';

const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const CLASS_TOKEN = /^-?[A-Za-z_][A-Za-z0-9_-]*$/;
/** Most ranges in one set: one Find result page is 2000, so this leaves room for glossaries. */
export const HIGHLIGHT_RANGE_LIMIT = 10000;
/** Most sets alive at once. Each set is one sheet of DOM over the pages. */
export const HIGHLIGHT_SET_LIMIT = 32;
const PRIORITY_LIMIT = 1000;

interface HighlightSet {
  readonly name: string;
  /** The caller's array, copied, so a later mutation of theirs cannot move a mark. */
  readonly ranges: readonly HighlightRange[];
  readonly blockIds: readonly string[];
  readonly starts: Int32Array;
  readonly ends: Int32Array;
  readonly color?: string;
  readonly activeColor?: string;
  readonly activeIndex: number;
  readonly classes: readonly string[];
  readonly priority: number;
  /** First-set order, for stable stacking between equal priorities. */
  readonly order: number;
  /** Model text each range covered when captured; `null` for a range that did not resolve. */
  expected: (string | null)[] | null;
  /** Which ranges still cover their expected text, for `checkedAt`. */
  resolved: Uint8Array;
  /** Resolved ranges whose paragraph has a laid-out line: what paints. */
  live: Uint8Array;
  checkedAt: {
    readonly session: unknown;
    readonly revision: number;
    readonly layout: SemanticLayout;
  } | null;
}

interface PaintedMark {
  readonly set: HighlightSet;
  readonly index: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function cssSupports(container: HTMLElement | null, property: string, value: string): boolean {
  const css = container?.ownerDocument.defaultView?.CSS ?? globalThis.CSS;
  return !css?.supports || css.supports(property, value);
}

function colorOption(
  value: unknown,
  name: 'color' | 'activeColor',
  container: HTMLElement | null
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || !cssSupports(container, 'color', value)) {
    throw new TypeError(`${name} must be a CSS color or var() expression.`);
  }
  return value;
}

function validateName(name: unknown): string {
  if (typeof name !== 'string' || !NAME.test(name)) {
    throw new TypeError(
      'Highlight set names are 1 to 64 letters, digits, "-", or "_", starting with a letter.'
    );
  }
  return name;
}

/** Validate a complete request before any visible state changes. */
function buildSet(
  name: string,
  ranges: unknown,
  options: HighlightOptions | undefined,
  order: number,
  container: HTMLElement | null
): HighlightSet {
  if (!Array.isArray(ranges)) throw new TypeError('ranges must be an array of HighlightRange.');
  if (ranges.length > HIGHLIGHT_RANGE_LIMIT) {
    throw new RangeError(`A highlight set holds at most ${HIGHLIGHT_RANGE_LIMIT} ranges.`);
  }
  if (options !== undefined && (typeof options !== 'object' || options === null)) {
    throw new TypeError('options must be an object.');
  }
  const copy = ranges.slice() as HighlightRange[];
  const blockIds: string[] = [];
  const starts = new Int32Array(copy.length);
  const ends = new Int32Array(copy.length);
  for (const [index, range] of copy.entries()) {
    const valid =
      typeof range === 'object' &&
      range !== null &&
      typeof range.blockId === 'string' &&
      range.blockId.length > 0 &&
      Number.isSafeInteger(range.start) &&
      range.start >= 0 &&
      Number.isSafeInteger(range.length) &&
      range.length >= 0 &&
      range.start + range.length <= 0x7fffffff &&
      (range.expectedText === undefined || typeof range.expectedText === 'string');
    if (!valid) {
      throw new TypeError(
        `ranges[${index}] must have a blockId string, nonnegative integer start and length, ` +
          'and an optional expectedText string.'
      );
    }
    blockIds.push(range.blockId);
    starts[index] = range.start;
    ends[index] = range.start + range.length;
  }
  const activeIndex = options?.activeIndex ?? -1;
  // An index past the end means no active range: a result list can shrink under an edit
  // while the host still holds the old index.
  if (!Number.isInteger(activeIndex) || activeIndex < -1) {
    throw new RangeError('activeIndex must be an integer of -1 or more.');
  }
  const priority = options?.priority ?? 0;
  if (!Number.isInteger(priority) || Math.abs(priority) > PRIORITY_LIMIT) {
    throw new RangeError(
      `priority must be an integer from -${PRIORITY_LIMIT} to ${PRIORITY_LIMIT}.`
    );
  }
  const className = options?.className ?? '';
  if (typeof className !== 'string') throw new TypeError('className must be a string.');
  const classes = className.split(/\s+/).filter(Boolean);
  if (classes.some((token) => !CLASS_TOKEN.test(token))) {
    throw new TypeError('className must hold space-separated CSS class names.');
  }
  const color = colorOption(options?.color, 'color', container);
  const activeColor = colorOption(options?.activeColor, 'activeColor', container);
  return {
    name,
    ranges: copy,
    blockIds,
    starts,
    ends,
    ...(color !== undefined ? { color } : {}),
    ...(activeColor !== undefined ? { activeColor } : {}),
    activeIndex,
    classes,
    priority,
    order,
    expected: null,
    resolved: new Uint8Array(copy.length),
    live: new Uint8Array(copy.length),
    checkedAt: null,
  };
}

/** Model text each `findMatches()` result covered when it was found. */
const foundText = new WeakMap<object, string | null>();
const notedResults = new WeakSet<object>();
/**
 * Model text each range object covered the first time any set captured it. Keyed per OBJECT,
 * not per set: setting the same stale ranges again must compare against the text they were
 * first set on, never adopt whatever an edit has since moved under their offsets.
 */
const capturedText = new WeakMap<object, string | null>();

/** The text a range must cover to paint: found, declared, or first captured. */
function expectedTextOf(range: HighlightRange, covered: string | null): string | null {
  if (foundText.has(range)) return foundText.get(range)!;
  if (typeof range.expectedText === 'string') return range.expectedText;
  if (!capturedText.has(range)) capturedText.set(range, covered);
  return capturedText.get(range)!;
}

/**
 * Model text per paragraph NODE. The tree replaces only the nodes an edit touches, so a check
 * after a keystroke derives the text of the edited paragraph and reuses every other one.
 */
const nodeText = new WeakMap<object, string | null>();

/** Model text per paragraph id, read once per check. */
function textReader(surface: PaginatedSurface) {
  const texts = new Map<string, string | null>();
  return (blockId: string): string | null => {
    if (texts.has(blockId)) return texts.get(blockId)!;
    const part = partOfNodeId(surface.session, blockId);
    const node = part ? findNode(part, blockId) : null;
    let text: string | null = null;
    if (part && node) {
      if (nodeText.has(node)) text = nodeText.get(node)!;
      else {
        text = paragraphTextOf(part, blockId);
        nodeText.set(node, text);
      }
    }
    texts.set(blockId, text);
    return text;
  };
}

/**
 * Bring a set's liveness up to the current document and layout. The first check captures
 * each range's text; later checks compare against it. A range is live when its paragraph has
 * a laid-out line and still holds the captured text at the range's offsets.
 */
function check(set: HighlightSet, surface: PaginatedSurface, layout: SemanticLayout): void {
  const session = surface.session;
  const revision = session.packageRevision();
  const last = set.checkedAt;
  if (last?.session === session && last.revision === revision && last.layout === layout) return;
  const read = textReader(surface);
  const placed = placedParagraphIds(layout);
  const capturing = set.expected === null;
  const expected = set.expected ?? new Array<string | null>(set.ranges.length).fill(null);
  for (let index = 0; index < set.ranges.length; index += 1) {
    const start = set.starts[index]!;
    const end = set.ends[index]!;
    const text = end > start ? read(set.blockIds[index]!) : null;
    const covered = text !== null && end <= text.length ? text.slice(start, end) : null;
    if (capturing) expected[index] = expectedTextOf(set.ranges[index]!, covered);
    const live = covered !== null && covered === expected[index];
    set.resolved[index] = live ? 1 : 0;
    set.live[index] = live && placed.has(set.blockIds[index]!) ? 1 : 0;
  }
  set.expected = expected;
  set.checkedAt = { session, revision, layout };
}

function pagesKey(pages: ReadonlySet<number> | undefined): string {
  return pages ? [...pages].sort((a, b) => a - b).join(',') : '*';
}

function offsetsKey(offsets: ReadonlyMap<number, number> | undefined): string {
  return offsets ? [...offsets].map(([page, x]) => `${page}:${x}`).join(',') : '';
}

/**
 * The highlight controller one editor owns. `attach` installs its painter on each new
 * surface; `reset` drops every set when another document loads.
 */
export function createTextHighlights(deps: {
  surface(): PaginatedSurface | null;
  container(): HTMLElement | null;
  /** Mount a document whose open is still scheduled, so ranges resolve against it. */
  flushOpen(): void;
}) {
  const sets = new Map<string, HighlightSet>();
  let nextOrder = 0;
  let version = 0;
  let painted: PaintedMark[] = [];
  let paintedLayer: HTMLElement | null = null;
  let lastPaint: string | null = null;
  let lastLayout: SemanticLayout | null = null;

  const ordered = () =>
    [...sets.values()].sort((a, b) => a.priority - b.priority || a.order - b.order);

  function paint(frame: SurfaceOverlayFrame): void {
    const surface = deps.surface();
    paintedLayer = frame.layer;
    if (!surface || sets.size === 0) {
      if (frame.layer.childElementCount > 0) frame.layer.replaceChildren();
      painted = [];
      lastPaint = null;
      return;
    }
    const list = ordered();
    for (const set of list) check(set, surface, frame.layout);
    const layout = textboxPresenceLayout(frame.layout);
    const key = [
      version,
      surface.session.packageRevision(),
      pagesKey(frame.pages),
      frame.scale,
      offsetsKey(frame.pageOffsetX),
    ].join('|');
    // Same document, pages, scale, and sets: the marks on screen are already right.
    if (key === lastPaint && layout === lastLayout && frame.layer.childElementCount > 0) return;
    lastPaint = key;
    lastLayout = layout;
    const document = frame.layer.ownerDocument;
    const sheets: HTMLElement[] = [];
    const marks: PaintedMark[] = [];
    for (const set of list) {
      const byParagraph = new Map<string, ParagraphRange[]>();
      for (let index = 0; index < set.ranges.length; index += 1) {
        if (!set.live[index]) continue;
        const blockId = set.blockIds[index]!;
        const bucket = byParagraph.get(blockId) ?? [];
        bucket.push({ key: index, start: set.starts[index]!, end: set.ends[index]! });
        byParagraph.set(blockId, bucket);
      }
      const sheet = document.createElement('div');
      sheet.className = 'docx-text-highlight-set';
      sheet.setAttribute('data-highlight-set', set.name);
      if (set.color) sheet.style.setProperty('--doc-text-highlight-set-color', set.color);
      if (set.activeColor) {
        sheet.style.setProperty('--doc-text-highlight-set-active-color', set.activeColor);
      }
      const rects = paragraphRangeRects(layout, byParagraph, frame.pages, frame.measurer);
      // The active range paints last in its set, so a neighbour never covers it.
      rects.sort((a, b) => Number(a.key === set.activeIndex) - Number(b.key === set.activeIndex));
      for (const rect of rects) {
        const page = layout.pages[rect.pageIndex];
        if (!page) continue;
        const offsetX = frame.pageOffsetX?.get(rect.pageIndex) ?? 0;
        const mark: PaintedMark = {
          set,
          index: rect.key,
          left: (page.contentBox.x + rect.x + offsetX) * frame.scale,
          top: (page.contentBox.y + rect.y) * frame.scale,
          width: rect.width * frame.scale,
          height: rect.height * frame.scale,
        };
        const element = document.createElement('div');
        element.className = 'docx-text-highlight';
        element.style.position = 'absolute';
        if (rect.key === set.activeIndex) element.classList.add('docx-text-highlight--active');
        if (set.classes.length > 0) element.classList.add(...set.classes);
        element.setAttribute('data-highlight-index', String(rect.key));
        element.style.left = `${mark.left}px`;
        element.style.top = `${mark.top}px`;
        element.style.width = `${mark.width}px`;
        element.style.height = `${mark.height}px`;
        sheet.append(element);
        marks.push(mark);
      }
      sheets.push(sheet);
    }
    frame.layer.replaceChildren(...sheets);
    painted = marks;
  }

  function repaint(): void {
    version += 1;
    deps.surface()?.repaintHighlights();
  }

  function resultOf(set: HighlightSet): HighlightResult {
    const surface = deps.surface();
    if (!surface) return { applied: 0, unavailable: set.ranges.length };
    // The published layout: a decoration must never force a layout pass mid-typing.
    const published = surface.publishedLayout();
    check(set, surface, published);
    // A range counts when it paints. While the published layout lags the document, a resolved
    // range in a paragraph that layout has not reached yet counts too: it paints next frame.
    const lagging = published.revision !== surface.session.packageRevision();
    let applied = 0;
    for (let index = 0; index < set.ranges.length; index += 1) {
      applied += lagging ? set.resolved[index]! : set.live[index]!;
    }
    return { applied, unavailable: set.ranges.length - applied };
  }

  const members: EditorHighlights = {
    setHighlights(name, ranges, options) {
      validateName(name);
      // Resolve against a document whose open is still scheduled, BEFORE reading the sets: a
      // mount of replaced content clears them. Only a set with ranges flushes; an empty one
      // must not cut short the loading frame of a large document.
      if (Array.isArray(ranges) && ranges.length > 0) deps.flushOpen();
      const existing = sets.get(name);
      const set = buildSet(name, ranges, options, existing?.order ?? nextOrder, deps.container());
      if (!existing && set.ranges.length > 0 && sets.size >= HIGHLIGHT_SET_LIMIT) {
        throw new RangeError(`At most ${HIGHLIGHT_SET_LIMIT} highlight sets exist at once.`);
      }
      if (set.ranges.length === 0) {
        if (existing) {
          sets.delete(name);
          repaint();
        }
        return { applied: 0, unavailable: 0 };
      }
      if (!existing) nextOrder += 1;
      sets.set(name, set);
      const result = resultOf(set);
      repaint();
      return result;
    },
    clearHighlights(name) {
      if (name === undefined) {
        if (sets.size === 0) return;
        sets.clear();
      } else if (!sets.delete(validateName(name))) {
        return;
      }
      repaint();
    },
    getHighlightsAt(clientX, clientY) {
      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return [];
      const layer = paintedLayer;
      if (!layer?.isConnected || painted.length === 0) return [];
      const origin = layer.getBoundingClientRect();
      const x = clientX - origin.left;
      const y = clientY - origin.top;
      const hits: HighlightHit[] = [];
      const seen = new Set<string>();
      // Painted order is bottom to top, so walk it backwards for topmost first.
      for (let at = painted.length - 1; at >= 0; at -= 1) {
        const mark = painted[at]!;
        if (x < mark.left || x >= mark.left + mark.width) continue;
        if (y < mark.top || y >= mark.top + mark.height) continue;
        const id = `${mark.set.name}\u0000${mark.index}`;
        if (seen.has(id) || sets.get(mark.set.name) !== mark.set) continue;
        seen.add(id);
        const left = origin.left + mark.left;
        const top = origin.top + mark.top;
        hits.push({
          name: mark.set.name,
          index: mark.index,
          range: mark.set.ranges[mark.index]!,
          active: mark.index === mark.set.activeIndex,
          rect: {
            x: left,
            y: top,
            left,
            top,
            width: mark.width,
            height: mark.height,
            right: left + mark.width,
            bottom: top + mark.height,
          },
        });
      }
      return hits;
    },
  };

  return {
    members,
    /** Record what each search result covers now, before the document can move under it. */
    noteMatches<T extends HighlightRange>(matches: readonly T[]): readonly T[] {
      const surface = deps.surface();
      if (!surface || notedResults.has(matches)) return matches;
      notedResults.add(matches);
      const read = textReader(surface);
      for (const match of matches) {
        const text = read(match.blockId);
        const end = match.start + match.length;
        foundText.set(
          match,
          text !== null && end <= text.length ? text.slice(match.start, end) : null
        );
      }
      return matches;
    },
    /**
     * Install the painter on a new surface. Ranges are checked again against its session;
     * `replaced` drops every set first, for a mount of different content.
     */
    attach(surface: PaginatedSurface | null, replaced = false) {
      lastPaint = null;
      if (replaced) sets.clear();
      surface?.setHighlightPainter(paint);
    },
    /** Drop every set: node ids name one loaded document. */
    reset() {
      if (sets.size === 0) return;
      sets.clear();
      repaint();
    },
  };
}
