// The paginated surface's public contract (paginated-surface seam).
//
// This module owns the types a host programs against — options, state, perf counters,
// the formatting snapshot and the surface interface itself. The composition root in
// paginated-surface.ts implements and re-exports them, so importers keep one entry point.

import type { TreeDocxSession } from '@docx-editor.dev/core-contract/binding';
import type {
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

export interface PaginatedSurfaceState {
  readonly revision: number;
  readonly pageCount: number;
  readonly selection: SemanticSelection;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly lastRejection: string | null;
  /** Timing and reuse counters for the last pass. Diagnostics, not document state. */
  readonly perf: PaginatedSurfacePerf;
}

export interface PaginatedSurface {
  readonly session: TreeDocxSession;
  layout(): SemanticLayout;
  state(): PaginatedSurfaceState;
  /** Move the caret to a point in surface coordinates. */
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
  /** Select the whole document. */
  selectAll(): void;
  /** Set the selection directly, for a host driving the surface programmatically. */
  setSelection(next: SemanticSelection): void;
  /** Toggle a run property over the selection, e.g. `b`, `i`, `u`. */
  toggleRunProperty(localName: string, attributes?: Record<string, string>): void;
  /**
   * SET a run property over the selection, rather than toggling it.
   *
   * Font family, size and colour are values, not switches: picking Arial twice must leave
   * the text in Arial, which a toggle would not.
   */
  setRunProperty(localName: string, attributes?: Record<string, string>): void;
  /** Set a property on every paragraph the selection touches — alignment, style, spacing. */
  setParagraphProperty(localName: string, attributes?: Record<string, string>): void;
  /** Formatting as it stands at the selection, for a toolbar to reflect. */
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
