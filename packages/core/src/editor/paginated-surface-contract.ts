// The paginated surface's public contract (paginated-surface seam).
//
// This module owns the types a host programs against — options, state, perf counters,
// the formatting snapshot and the surface interface itself. The composition root in
// paginated-surface.ts implements and re-exports them, so importers keep one entry point.

import type { IndentFormatting } from '../contracts/types.ts';
import type { TreeDocxSession } from '@docx-editor.dev/core-contract/binding';
import type { BookmarkIndex } from '@docx-editor.dev/core-contract/store';
import type { ViewScope } from '../contracts/editor.ts';
import type { HyperlinkOps } from './surface-hyperlinks.ts';
import type { HyperlinkActivation, SurfaceNavigation } from './surface-navigation.ts';
import type {
  CellSelection,
  NavigationCommand,
  SectionProperties,
  SemanticLayout,
  SemanticSelection,
  TextMeasurer,
} from '@docx-editor.dev/core-contract/layout';

/**
 * How an edit is written.
 *
 * `'suggest'` is the one that changes what the ops MEAN: the same keystroke becomes a `w:ins`
 * and the same Backspace becomes a `w:del` over the words it would have removed. `'view'`
 * refuses edits outright.
 */
export type SurfaceEditingMode = 'edit' | 'suggest' | 'view';

export interface PaginatedSurfaceOptions {
  readonly measurer?: TextMeasurer;
  /** Ambient author for tracked edits. Required before suggesting can write anything. */
  readonly author?: string;
  /** Opening mode; changeable at runtime with `setEditingMode`. */
  readonly editingMode?: SurfaceEditingMode;
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
  /**
   * A plain click on an external (or inert) hyperlink, for a host to open its popover with.
   *
   * Absent means such a click does nothing. That is deliberate: a host with no popover
   * mounted must not have clicks silently opening tabs, and the popover is the only path to
   * activation (see the navigation module's single `window.open` gate).
   */
  readonly onHyperlinkPopover?: (activation: HyperlinkActivation) => void;
  /**
   * Ctrl/Cmd+K — Word's Insert Hyperlink. The engine reports the request; the host's chrome
   * decides what a link dialog looks like. A host that passes nothing leaves the key alone
   * rather than doing something surprising with it.
   */
  readonly onRequestHyperlink?: () => void;
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
  /**
   * `w:spacing`'s line rule and its value: LINES for `multiple`, points for the other two
   * (`w:line` is 240ths of a line under `auto` and twentieths of a point otherwise).
   * Null when the selection's paragraphs disagree, or state no line spacing at all.
   */
  readonly lineSpacing: {
    readonly rule: 'multiple' | 'exact' | 'atLeast';
    readonly value: number;
  } | null;
  /** `w:spacing/@w:before` and `@w:after` in points, null when the selection disagrees. */
  readonly spaceBeforePt: number | null;
  readonly spaceAfterPt: number | null;
  /**
   * Effective indent at the selection, in twips, or null with no selection or inside a
   * table.
   *
   * The one field here that does NOT go null on disagreement: the values are the FIRST
   * touched paragraph's and `mixed` reports the disagreement per field, because a ruler
   * must draw its handles somewhere and Word draws them at the first selected paragraph.
   */
  readonly indent: IndentFormatting | null;
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
   * Set indent to exact values on every paragraph the selection touches — what a ruler
   * drag and an indent spinner both need, where {@link adjustIndent} only steps.
   *
   * Twips. Omitting a field leaves it as authored; `null` CLEARS it, so the paragraph
   * falls back to its style — distinct from zero, which blocks the cascade.
   *
   * `firstLine` is ONE SIGNED offset, negative for a hanging indent; the two OOXML
   * spellings are written for it, the unused one as an explicit zero. Answers whether
   * anything was committed.
   */
  setIndent(update: {
    readonly left?: number | null;
    readonly right?: number | null;
    readonly firstLine?: number | null;
  }): boolean;
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
  /**
   * Set a property on every paragraph the selection touches — alignment, style, spacing.
   *
   * `mergeAttributes` keeps the attributes the call does not name, for the properties that
   * carry several independent settings in one element: `w:spacing` holds the line rule and
   * the space before and after, so a line-spacing pick must not delete the space-before. A
   * null-valued attribute removes just that one.
   */
  setParagraphProperty(
    localName: string,
    attributes?: Record<string, string | null>,
    options?: { readonly mergeAttributes?: boolean }
  ): void;
  /**
   * Word's Clear All Formatting: direct run properties off the selected text, and every
   * paragraph the selection touches back to the default style with its direct paragraph
   * properties and mark dropped.
   *
   * Only what the document states DIRECTLY — formatting inherited from a style survives, so
   * the text falls back to its style rather than to nothing. Properties an op cannot name
   * (`w:rStyle`, `w:lang`, `w:sectPr`, `w:pBdr`) are preserved for the same reason every
   * other write preserves them.
   */
  clearFormatting(): void;
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
  /**
   * The hyperlink lane: what link the caret is in, and the insert / retarget / unlink verbs.
   *
   * Every verb is one `transact`, so it is one undo step. Targets going IN are host-supplied
   * and pass the package's own URL allowlist; targets coming OUT are the sanitized
   * projection, so a caller cannot accidentally hand a refused scheme to a sink.
   */
  readonly hyperlinks: HyperlinkOps;
  /**
   * Bookmark jumps and the ONE external-activation gate. A host's popover "open" action
   * calls `openExternal`; nothing else in the engine may call `window.open`.
   */
  readonly navigation: SurfaceNavigation;
  /**
   * Pin the current selection so it stays VISIBLY selected while focus is elsewhere.
   *
   * A document has one selection: the moment a panel focuses an input of its own the browser
   * takes the highlight off the text, which is when the user most needs to see what the panel
   * is about to act on. This draws the range on the engine's own overlay instead, so it
   * survives the focus move. The MODEL selection is untouched — the op the panel finally runs
   * addresses the same characters it always would.
   *
   * The pin releases itself when the caret leaves the range (either edge counts as inside),
   * which is what lets a host close its panel on "the user clicked somewhere else" without
   * every adapter reimplementing that comparison.
   */
  retainSelection(): void;
  /** Drop the pin and stop drawing it, whether or not the caret ever left. */
  releaseSelection(): void;
  /** The pinned range, or null once it was released or escaped. */
  retainedSelection(): SemanticSelection | null;
  /**
   * How edits are written right now.
   *
   * Lives on the SURFACE, not on the store. The store's write vocabulary stays explicit —
   * an op says whether it is tracked — and the surface is the one thing that knows a
   * keystroke happened, so it is the right place to decide what that keystroke becomes.
   */
  editingMode(): SurfaceEditingMode;
  setEditingMode(mode: SurfaceEditingMode): void;
  /**
   * Commit review ops — accept, reject, a new comment — through the SAME path a keystroke
   * takes: layout, paint, and a caret clamped to what the document now holds.
   *
   * Applying them straight to the session skipped all three. Rejecting an insertion left the
   * pages painting text the tree no longer had, every card anchored where it used to be, and
   * the caret past the end of the paragraph — after which every keystroke was refused with
   * `offset-out-of-range` until the user happened to click somewhere else.
   */
  commitReviewOps(run: () => { readonly committed: boolean; readonly reason?: unknown }): void;
  /**
   * The layout as last PUBLISHED, without forcing pending work.
   *
   * `layout()` flushes first, which is right for a caller that is about to act on geometry
   * and wrong for one that merely decorates it. The review rail read through `layout()` and
   * so forced a synchronous full pass on every keystroke — eleven seconds per read on a
   * 2432-block document. A card whose anchor is one frame stale is invisible; the paint that
   * follows the flush republishes it.
   */
  publishedLayout(): SemanticLayout;
  /**
   * The comment or tracked change the caret is in, as the painted bands report it.
   *
   * ONE source for "which item is open". The band under the text and the card beside it are
   * two views of the same answer, and deriving it twice let them disagree — the card closed
   * while the text stayed highlighted.
   */
  activeReviewKey(): string | null;
  /**
   * Close the open item until the caret next moves.
   *
   * What a click on the canvas means. The caret does not move when someone clicks the grey
   * around the page, so nothing else would ever put the item away.
   */
  dismissActiveReview(): void;
  /**
   * `bookmarkName -> position` over the current revision, for resolving an internal link.
   * First in document order wins a duplicate name, matching Word.
   */
  bookmarks(): BookmarkIndex;
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
  /** Active editing view — body, or an open header/footer story by rId. */
  activeScope(): ViewScope;
  /** Activate a view scope. Returns false when a header/footer rId cannot be opened. */
  setActiveScope(scope: ViewScope): boolean;
  /**
   * Open a header/footer story for editing on the painted surface.
   * Refuses dangling / unknown relationship ids.
   */
  enterHeaderFooter(args: {
    readonly rId: string;
    readonly pageIndex?: number;
    readonly sectionIndex?: number;
    readonly kind?: 'header' | 'footer';
    readonly variant?: 'default' | 'first' | 'even';
    readonly position?: import('@docx-editor.dev/core-contract/layout').SemanticPosition;
  }): boolean;
  /** Leave furniture editing and restore the prior body selection. */
  exitHeaderFooter(): void;
  /** Chrome read-model for the open furniture scope, or null when editing the body. */
  headerFooterState(): {
    readonly editing: 'header' | 'footer' | null;
    readonly sectionIndex: number;
    readonly variant?: 'default' | 'first' | 'even';
    readonly rId?: string;
    readonly partName?: string;
    readonly inherited?: boolean;
    readonly titlePage?: boolean;
    readonly evenAndOddHeaders?: boolean;
    readonly headerDistanceTwips?: number;
    readonly footerDistanceTwips?: number;
  } | null;
  /**
   * Commit one package-level furniture lifecycle op (create/delete/link/unlink/options).
   * Flushes layout so the next enter/rebind sees the new resolution.
   */
  applyHeaderFooterLifecycle(op: {
    readonly op:
      | 'createHeaderFooter'
      | 'deleteHeaderFooter'
      | 'linkToPrevious'
      | 'unlinkFromPrevious'
      | 'setSectionFurnitureOptions';
    readonly sectionIndex?: number;
    readonly kind?: 'header' | 'footer';
    readonly variant?: 'default' | 'first' | 'even';
    readonly titlePage?: boolean;
    readonly evenAndOddHeaders?: boolean;
    readonly headerDistanceTwips?: number;
    readonly footerDistanceTwips?: number;
  }): { readonly ok: true } | { readonly ok: false; readonly reason: string };
  /** Insert an allowlisted page field at the caret in the open HF story. */
  insertPageField(field: 'PAGE' | 'NUMPAGES' | 'SECTIONPAGES' | 'PAGE_X_OF_Y'): boolean;
  /** Insert a footnote/endnote at the body caret. */
  insertNote(noteKind: 'footnote' | 'endnote'): boolean;
  deleteNote(noteKind: 'footnote' | 'endnote', noteId: number): boolean;
  convertNote(fromKind: 'footnote' | 'endnote', noteId: number): boolean;
  convertAllNotes(fromKind: 'footnote' | 'endnote'): boolean;
  setNoteProperties(args: {
    readonly scope: 'document' | 'section';
    readonly sectionIndex?: number;
    readonly footnote?: {
      readonly numFmt?: string;
      readonly numRestart?: string;
      readonly position?: string;
      readonly numStart?: number;
    };
    readonly endnote?: {
      readonly numFmt?: string;
      readonly numRestart?: string;
      readonly position?: string;
      readonly numStart?: number;
    };
  }): boolean;
  enterNote(scopeId: string, position?: { paragraphId: string; offset: number }): boolean;
  exitNote(): void;
  /** Resolved/authored note properties for the caret section — chrome read-model. */
  notePropertiesState(): import('./surface-note-state.ts').NotePropertiesStateSnapshot | null;
  /** Plain-text preview for hover chrome — never returns markup. */
  notePreviewText(scopeId: string): string | null;
}

export type OpenPaginatedResult =
  | { readonly ok: true; readonly surface: PaginatedSurface }
  | { readonly ok: false; readonly reason: string; readonly detail?: string };
