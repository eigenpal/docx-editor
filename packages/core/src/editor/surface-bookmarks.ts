// Bookmarks on the paginated surface: list them, add one at the selection, delete one, jump to
// one, and show where they are.
//
// THE NAME IS DOCUMENT-WIDE. A bookmark can live in the body, a header, a footer or a note, and
// one name means one bookmark across all of them. Adding a name that another story already
// declares moves it: the other story's markers go first, in their own story transaction, and
// the new pair is written in the story the selection is in.
//
// THE MARKS ARE FURNITURE. With "Show bookmarks" on, a gray bracket is painted at each visible
// bookmark's start and end, and an I-beam at a point bookmark, in an overlay sheet BESIDE the
// pages. Nothing is added to the editable DOM, so selection mapping, hit testing and the caret
// never see the marks, and they are never part of the document, its export or its print.
// Hidden bookmarks (names starting with an underscore) are not shown. Marks are painted for
// bookmarks in the main text.

import { caretAt, type SemanticLayout, type TextMeasurer } from '@docx-editor.dev/core/layout';
import type { SemanticSelection } from '@docx-editor.dev/core/layout';
import {
  bookmarkNameKey,
  bookmarkNameProblem,
  listBookmarks,
  type BookmarkNameProblem,
  type BookmarkRecord,
  type OoxmlPart,
  type StoryScope,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import type { BookmarkStory, BookmarkSummary } from '../contracts/editor-bookmarks.ts';
import { storyScopeOfNodeId, type StoryScopeLookup } from './surface-scope.ts';

/** What the bookmark lane reads from and writes through. */
export interface SurfaceBookmarkDeps {
  readonly session: StoryScopeLookup & {
    storyParts(): readonly OoxmlPart[];
    applyTreeOps(
      ops: readonly TreeDocOp[],
      before?: unknown,
      after?: unknown,
      scope?: StoryScope
    ): { readonly committed: boolean; readonly reason?: string };
  };
  readonly storyScope: () => StoryScope;
  readonly orderedRange: () => {
    readonly from: { readonly paragraphId: string; readonly offset: number };
    readonly to: { readonly paragraphId: string; readonly offset: number };
  };
  /** Why a write cannot happen at the selection now, or null. */
  readonly writeRefusal: () => string | null;
  readonly commit: (run: () => boolean, selectionAfter?: () => SemanticSelection | null) => void;
  readonly goToPosition: (position: { paragraphId: string; offset: number }) => boolean;
  readonly setSelection: (selection: SemanticSelection) => void;
  readonly repaint: () => void;
  /** Whether the marks start shown. */
  readonly initiallyShown?: boolean;
}

/** One painted mark: where it is and which shape it takes. */
export interface BookmarkMark {
  readonly kind: 'start' | 'end' | 'point';
  readonly paragraphId: string;
  readonly offset: number;
}

/** The surface's bookmark lane. */
export interface SurfaceBookmarks {
  /** Every bookmark in the document: body first, then headers, footers and notes. */
  list(): readonly BookmarkSummary[];
  /** Why `insert(name)` would be refused now, or null. */
  insertRefusal(name: string): string | null;
  /** Bookmark the selection under `name`, moving a bookmark that already has it. */
  insert(name: string): boolean;
  /** Remove the bookmark with this name, compared without case. */
  remove(name: string): boolean;
  /** Select the bookmark's range and scroll it into view. */
  goTo(name: string): boolean;
  /** Whether the marks are shown. */
  shown(): boolean;
  setShown(shown: boolean): void;
  /** Paint the marks for one rendered frame. */
  paint(frame: {
    readonly layer: HTMLElement;
    readonly layout: SemanticLayout;
    readonly scale: number;
    readonly pageOffsetX?: ReadonlyMap<number, number>;
    readonly pages?: ReadonlySet<number>;
    readonly measurer?: TextMeasurer;
  }): void;
}

const PROBLEM_REASONS: Record<BookmarkNameProblem, string> = {
  empty: 'a bookmark needs a name',
  tooLong: 'a bookmark name has at most 40 characters',
  invalidStart: 'a bookmark name starts with a letter',
  invalidCharacter: 'a bookmark name holds only letters, digits and underscores',
};

/** Why a name cannot be written, as a refusal reason, or null. */
export function bookmarkNameRefusal(name: string): string | null {
  const problem = bookmarkNameProblem(name);
  if (problem) return PROBLEM_REASONS[problem];
  // Hidden names are for the application's own bookmarks; a person names a visible one.
  return name.startsWith('_') ? 'a bookmark name starts with a letter' : null;
}

const listCache = new WeakMap<OoxmlPart, readonly BookmarkRecord[]>();

function recordsOf(part: OoxmlPart): readonly BookmarkRecord[] {
  let records = listCache.get(part);
  if (!records) {
    records = listBookmarks(part);
    listCache.set(part, records);
  }
  return records;
}

function storyOf(scope: StoryScope): BookmarkStory {
  if (scope.kind === 'body') return 'body';
  return scope.kind === 'headerFooter' ? 'headerFooter' : 'note';
}

export function createSurfaceBookmarks(deps: SurfaceBookmarkDeps): SurfaceBookmarks {
  let visible = deps.initiallyShown === true;

  const located = (): { readonly record: BookmarkRecord; readonly scope: StoryScope }[] => {
    const found: { record: BookmarkRecord; scope: StoryScope }[] = [];
    for (const part of deps.session.storyParts()) {
      for (const record of recordsOf(part)) {
        found.push({
          record,
          scope: storyScopeOfNodeId(deps.session, record.startNodeId, { kind: 'body' }),
        });
      }
    }
    return found;
  };

  const find = (name: string) => {
    const key = bookmarkNameKey(name);
    return located().find((entry) => bookmarkNameKey(entry.record.name) === key) ?? null;
  };

  const write = (op: TreeDocOp, scope: StoryScope): boolean => {
    let committed = false;
    deps.commit(() => {
      committed = deps.session.applyTreeOps([op], undefined, undefined, scope).committed;
      return committed;
    });
    return committed;
  };

  const insertRefusal = (name: string): string | null =>
    bookmarkNameRefusal(name) ?? deps.writeRefusal();

  return {
    list() {
      return located().map(({ record, scope }, order) =>
        Object.freeze({
          name: record.name,
          hidden: record.hidden,
          story: storyOf(scope),
          order,
          empty:
            record.start.paragraphId === record.end.paragraphId &&
            record.start.offset === record.end.offset,
        })
      );
    },
    insertRefusal,
    insert(name) {
      if (insertRefusal(name)) return false;
      const scope = deps.storyScope();
      const range = deps.orderedRange();
      const key = bookmarkNameKey(name);
      // The other stories first: one name, one bookmark.
      for (const entry of located()) {
        if (bookmarkNameKey(entry.record.name) !== key) continue;
        if (JSON.stringify(entry.scope) === JSON.stringify(scope)) continue;
        if (!write({ op: 'deleteBookmark', name }, entry.scope)) return false;
      }
      return write(
        {
          op: 'insertBookmark',
          name,
          start: { paragraphId: range.from.paragraphId, offset: range.from.offset },
          end: { paragraphId: range.to.paragraphId, offset: range.to.offset },
        },
        scope
      );
    },
    remove(name) {
      const entry = find(name);
      if (!entry || deps.writeRefusal() !== null) return false;
      return write({ op: 'deleteBookmark', name }, entry.scope);
    },
    goTo(name) {
      const entry = find(name);
      if (!entry) return false;
      const { start, end } = entry.record;
      if (!deps.goToPosition(start)) return false;
      deps.setSelection({ anchor: start, head: end });
      return true;
    },
    shown: () => visible,
    setShown(next) {
      if (next === visible) return;
      visible = next;
      deps.repaint();
    },
    paint(frame) {
      if (!visible) {
        frame.layer.replaceChildren();
        return;
      }
      const body = deps.session.part();
      const marks: BookmarkMark[] = [];
      for (const record of recordsOf(body)) {
        if (record.hidden) continue;
        const point =
          record.start.paragraphId === record.end.paragraphId &&
          record.start.offset === record.end.offset;
        if (point) {
          marks.push({ kind: 'point', ...record.start });
          continue;
        }
        marks.push({ kind: 'start', ...record.start }, { kind: 'end', ...record.end });
      }
      paintBookmarkMarks(frame, marks);
    },
  };
}

/**
 * Paint bracket marks over the pages. Geometry comes from layout, the same `caretAt` the caret
 * uses, so a mark sits exactly where a caret at that position would. The mark's width is fixed
 * on screen; its height is the line's.
 */
export function paintBookmarkMarks(
  frame: Parameters<SurfaceBookmarks['paint']>[0],
  marks: readonly BookmarkMark[]
): void {
  const { layer, layout, scale } = frame;
  const document = layer.ownerDocument;
  const width = Math.max(3, 3 * scale);
  const painted: HTMLElement[] = [];
  for (const mark of marks) {
    const geometry = caretAt(
      layout,
      { paragraphId: mark.paragraphId, offset: mark.offset },
      frame.measurer ? { measurer: frame.measurer } : undefined
    );
    if (!geometry || !(geometry.height > 0)) continue;
    if (frame.pages && !frame.pages.has(geometry.pageIndex)) continue;
    const page = layout.pages[geometry.pageIndex];
    if (!page) continue;
    const offsetX = frame.pageOffsetX?.get(geometry.pageIndex) ?? 0;
    const x = (page.contentBox.x + geometry.x + offsetX) * scale;
    const element = document.createElement('div');
    element.className = `docx-bookmark-mark docx-bookmark-mark--${mark.kind}`;
    element.dataset.docxMarker = '';
    element.setAttribute('contenteditable', 'false');
    element.setAttribute('aria-hidden', 'true');
    element.style.position = 'absolute';
    element.style.pointerEvents = 'none';
    element.style.left = `${mark.kind === 'start' ? x : mark.kind === 'end' ? x - width : x - width / 2}px`;
    element.style.top = `${(page.contentBox.y + geometry.y) * scale}px`;
    element.style.width = `${width}px`;
    element.style.height = `${geometry.height * scale}px`;
    painted.push(element);
  }
  layer.replaceChildren(...painted);
}
