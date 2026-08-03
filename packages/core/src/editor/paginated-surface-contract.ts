// The paginated surface's public contract (paginated-surface seam).
//
// This module owns the types a host programs against — options, state, perf counters,
// the formatting snapshot and the surface interface itself. The composition root in
// paginated-surface.ts implements and re-exports them, so importers keep one entry point.

import type { TreeDocxSession } from '@docx-editor.dev/core-contract/binding';
import type {
  CellSelection,
  NavigationCommand,
  SectionProperties,
  SemanticLayout,
  SemanticSelection,
  TextMeasurer,
} from '@docx-editor.dev/core-contract/layout';

export interface PaginatedSurfaceOptions {
  readonly measurer?: TextMeasurer;
  /**
   * Identifies the measurer for cache invalidation.
   *
   * Fonts resolve asynchronously, so a host that swaps its measurer must change this or the
   * cached pre-font layout is served for the rest of the session.
   */
  readonly producer?: string;
  /**
   * Maps a document-declared font family to the alias its registered bytes live under, so
   * painted runs can use embedded glyphs without the file's family name entering the
   * page-global CSS font namespace.
   */
  readonly fontAlias?: (family: string) => string | undefined;
  /** Points to CSS pixels. */
  readonly scale?: number;
  /**
   * Who resolves a pointer to a caret.
   *
   * `'engine'` (the default) answers from the layout records, which is what makes a click in
   * a margin, an indent or a cell's padding land where it was aimed. `'native'` binds no
   * pointer handlers and leaves the browser's own caret placement in charge.
   */
  readonly pointer?: 'engine' | 'native';
  readonly onChange?: (state: PaginatedSurfaceState) => void;
}

/**
 * What the selection is currently formatted as.
 *
 * A value is present only when EVERY span in the selection agrees on it: a selection running
 * from 11pt into 14pt has no font size, and a toolbar should show a blank rather than pick
 * one of the two and imply the whole selection is that.
 */
export interface SurfaceFormatting {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strikethrough: boolean;
  readonly superscript: boolean;
  readonly subscript: boolean;
  readonly fontFamily: string | null;
  /** Half-points, the unit OOXML stores and the picker expects. */
  readonly fontSizeHalfPoints: number | null;
  readonly color: string | null;
  readonly highlight: string | null;
  readonly alignment: 'left' | 'center' | 'right' | 'both' | null;
  readonly styleId: string | null;
}

/**
 * Where the last pass spent its time, and how much work it actually did.
 *
 * The durations are the surface's own three phases — layout, paint, selection sync — timed
 * separately because they fail separately: a full relayout, a full repaint and a forced
 * reflow each have a different fix. The counters come free from machinery that already
 * exists: the layout session says how much was re-placed versus reused, and the scheduler
 * says how often work was thrown away as stale. `placed` equal to `total` on every
 * keystroke is the one-glance sign that incremental layout is not engaging.
 */
export interface PaginatedSurfacePerf {
  /** Time the last layout pass took, in milliseconds. */
  readonly layoutMs: number;
  /** Time the last paint took — building and swapping the page DOM. */
  readonly paintMs: number;
  /** Time the last selection sync took — writing the model selection into the browser. */
  readonly selectionMs: number;
  /** Paragraphs the last pass re-placed, against the number in the document. */
  readonly placed: number;
  readonly total: number;
  /** Pages carried over from the previous layout without being rebuilt. */
  readonly reusedPages: number;
  /** Passes that could not resume and laid the document out from the top. */
  readonly fullPasses: number;
  /** Layouts discarded because the model had already moved on. */
  readonly staleDiscards: number;
  /** Cooperative runs abandoned mid-flight for a newer revision. */
  readonly cancelledRuns: number;
}

/** How a reveal places its target in the viewport. */
export interface RevealOptions {
  /**
   * `'start'` puts the target near the top (a heading the user jumped to), `'center'`
   * centres it, `'nearest'` scrolls only when it is out of view. Default `'start'`.
   */
  readonly block?: 'start' | 'center' | 'nearest';
  /** Padding above the target, in CSS pixels. Default 24. */
  readonly offsetPx?: number;
  readonly behavior?: ScrollBehavior;
}

export interface PaginatedSurfaceState {
  readonly revision: number;
  readonly pageCount: number;
  readonly selection: SemanticSelection;
  /**
   * The rectangle of table cells a drag across cells selected, or null.
   *
   * `selection` always holds the equivalent TEXT range, so a reader that does not care about
   * rectangles needs no branch. This is for the ones that do — the highlight, and table
   * commands that act on cells rather than characters.
   */
  readonly cellSelection: CellSelection | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly lastRejection: string | null;
  /**
   * The typing format armed at the caret (Word's stored marks), or null.
   *
   * NOT document state — nothing is written until the next characters are typed — but it
   * IS observable state: `formatting()` reports it, so a host that reflects the toolbar
   * has to learn when it moves. Reference-stable while unchanged, so a host can compare
   * it to decide whether to re-derive. See `toggleRunProperty` for the lane itself.
   */
  readonly pendingFormat: readonly { readonly localName: string }[] | null;
  /** Timing and reuse counters for the last pass. Diagnostics, not document state. */
  readonly perf: PaginatedSurfacePerf;
}

export interface PaginatedSurface {
  readonly session: TreeDocxSession;
  layout(): SemanticLayout;
  state(): PaginatedSurfaceState;
  type(text: string): void;
  deleteBackward(): void;
  /** Delete forward — the Delete key, and `deleteContentForward` from an IME. */
  deleteForward(): void;
  /** Delete to the previous word boundary — Alt/Ctrl+Backspace. */
  deleteWordBackward(): void;
  /** Delete to the next word boundary — Alt/Ctrl+Delete. */
  deleteWordForward(): void;
  splitParagraph(): void;
  /** A tab character as a `w:tab` element, not a literal tab in the run text. */
  insertTab(): void;
  /** A `w:br` — Shift+Enter, a line break inside the same paragraph. */
  insertLineBreak(): void;
  /** A `w:br w:type="page"` — Ctrl+Enter, a hard page break inside the paragraph. */
  insertPageBreak(): void;
  /**
   * Word's Increase/Decrease Indent, over every paragraph the selection touches.
   *
   * A NUMBERED or BULLETED paragraph changes LEVEL: `w:numPr/w:ilvl` moves by one, which
   * re-resolves its marker from `numbering.xml` — so a bullet becomes a hollow circle, a
   * `1.` becomes an `a.`, exactly as Word demotes a list item. A level the definition
   * does not declare is DECLARED on the way, with Word's default format for that depth
   * (its stock bullets and number formats cycle every three levels) — a definition that
   * stops at `ilvl 0` never blocks the press. Everything else moves its `w:ind/@left` by
   * one default tab stop, never past the margin.
   *
   * Answers whether anything changed, so a caller can fall back (Tab inserting a tab
   * where there is no list to demote).
   */
  adjustIndent(direction: 'increase' | 'decrease'): boolean;
  /**
   * Whether Increase/Decrease Indent would do anything right now.
   *
   * A list item at level 0 cannot outdent and one at level 8 cannot indent — `w:ilvl`
   * has nine levels and Word greys the control out at the ends. A missing level
   * DEFINITION never disables it: `adjustIndent` declares the level as it goes. The one
   * residue: a `w:numStyleLink` definition missing the level refuses the declaration
   * (its levels belong to the linked style), so there the press is a safe no-op rather
   * than a greyed control.
   */
  canAdjustIndent(direction: 'increase' | 'decrease'): boolean;
  /**
   * Enter on an empty list item: outdent a level, or leave the list at level 0.
   *
   * Answers false when the caret is not on an empty list item, so the caller falls
   * through to an ordinary paragraph split.
   */
  exitListOnEmptyItem(): boolean;
  /** Whether the paragraph at the caret is a list item, for Tab's Word-like fallback. */
  isListParagraph(): boolean;
  /**
   * Word's Bullets and Numbering buttons.
   *
   * Turns every paragraph the selection touches into a list of `kind`, or takes them all
   * out when they are already one. The definition is created in `numbering.xml` on first
   * use — a document that has never carried a list has no numbering part at all.
   */
  toggleList(kind: 'bullet' | 'ordered'): boolean;
  /** Whether every paragraph the selection touches is already a list of `kind`. */
  isListActive(kind: 'bullet' | 'ordered'): boolean;
  /** Select the whole document. */
  selectAll(): void;
  /**
   * Scroll a page, or the page a paragraph sits on, into view. Returns whether it
   * scrolled — false when the target is not laid out, or the surface is not inside a
   * scroll container, so a caller can tell "no such target" from "done".
   *
   * The geometry comes from the LAYOUT, never from the DOM: a page that has not been
   * materialized yet has no element to measure, and that is exactly the page a reveal is
   * usually asked for. `revealParagraph` scrolls to the paragraph's own line rather than
   * the top of its page, so a heading deep in a page lands in view.
   */
  revealPage(pageIndex: number, options?: RevealOptions): boolean;
  revealParagraph(paragraphId: string, options?: RevealOptions): boolean;
  /** Set the selection directly, for a host driving the surface programmatically. */
  setSelection(next: SemanticSelection): void;
  /**
   * Select a rectangle of table cells, or clear one with null.
   *
   * The equivalent text range is installed alongside it, so `state().selection` stays valid
   * for every reader that does not know rectangles exist.
   */
  setCellSelection(next: CellSelection | null): void;
  /**
   * Toggle a run property over the selection, e.g. `b`, `i`, `u`.
   *
   * AT A COLLAPSED CARET this ARMS the property instead of writing it — Word's stored
   * marks. Nothing reaches the document until the next characters are typed there, and
   * those take the armed format; the armed state shows in `formatting()` and in
   * `state().pendingFormat` immediately, so a toolbar reflects the press. It survives the
   * caret-preserving edits (Backspace, Delete, Enter) and IME composition, and is
   * discarded when the caret moves elsewhere or the document is undone. A property the
   * store cannot author is refused at arm time rather than left to poison the keystroke.
   */
  toggleRunProperty(localName: string, attributes?: Record<string, string>): void;
  /**
   * SET a run property over the selection, rather than toggling it.
   *
   * Font family, size and colour are values, not switches: picking Arial twice must leave
   * the text in Arial, which a toggle would not. Arms at a collapsed caret on the same
   * terms as `toggleRunProperty`.
   */
  setRunProperty(localName: string, attributes?: Record<string, string>): void;
  /** Set a property on every paragraph the selection touches — alignment, style, spacing. */
  setParagraphProperty(localName: string, attributes?: Record<string, string>): void;
  /**
   * Formatting as it stands at the selection, for a toolbar to reflect.
   *
   * With a typing format armed at the caret this reports what the NEXT characters typed
   * will look like, not what the document holds — which is the answer a toolbar wants and
   * the one Word gives.
   */
  formatting(): SurfaceFormatting;
  /**
   * The section the document declares: page size, margins, columns, orientation.
   *
   * What a ruler is made of, and what pagination is measured against.
   */
  sectionProperties(): SectionProperties;
  /**
   * The section GOVERNING one paragraph — what a ruler or dialog reflects when the
   * caret sits in a multi-section document. Falls back to the body-level section for
   * an unknown id.
   */
  sectionPropertiesAt(paragraphId: string): SectionProperties;
  /**
   * Write section page-setup fields — size, orientation, margins — as ONE undoable
   * transaction. Twips throughout; omitted fields are left as authored. With
   * `anchorParagraphId` only that paragraph's governing section is written (Word's
   * "Apply to: This section"); without it, every section. Returns whether the write
   * committed (a hostile value is refused by the op layer).
   */
  setSectionProperties(update: {
    readonly pageWidthTwips?: number;
    readonly pageHeightTwips?: number;
    readonly orientation?: 'portrait' | 'landscape';
    readonly marginTopTwips?: number;
    readonly marginRightTwips?: number;
    readonly marginBottomTwips?: number;
    readonly marginLeftTwips?: number;
    readonly anchorParagraphId?: string;
  }): boolean;
  /**
   * Insert a next-page section break at the caret: the paragraph splits, and the head
   * ends a new section cloning the governing section's page setup — Word's Layout >
   * Breaks > Next Page. One undoable step. Returns whether the break committed.
   */
  insertSectionBreak(): boolean;
  /** The layout session, so a host or a test can see how much work a pass actually did. */
  layoutSession(): {
    readonly stats: {
      readonly placed: number;
      readonly total: number;
      readonly reusedPages: number;
    };
  };
  /** The selected text, for copy and cut. */
  selectedText(): string;
  /** Remove the selection, if any. Returns whether anything was deleted. */
  deleteSelection(): boolean;
  navigate(command: NavigationCommand, extend?: boolean): void;
  /** Reverse the last history entry and put the caret back where it was made. */
  undo(): void;
  redo(): void;
  focus(): void;
  destroy(): void;
}

export type OpenPaginatedResult =
  | { readonly ok: true; readonly surface: PaginatedSurface }
  | { readonly ok: false; readonly reason: string; readonly detail?: string };
