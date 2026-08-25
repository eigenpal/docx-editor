// The paginated surface's public contract owns the types a host programs against.
// paginated-surface.ts implements and re-exports them, so importers keep one entry point.

import type { IndentFormatting } from '../contracts/types.ts';
import type {
  ParagraphDisagreements,
  ParagraphFlags,
  SurfaceParagraphFormat,
  ParagraphPropertyEdit,
  ParagraphTabStop,
} from './paragraph-format-contract.ts';
import type { TreeApplyResult, TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { BookmarkIndex, StoryScope, TreeDocOp } from '@docx-editor.dev/core/store';
import type { SelectionPin, ViewScope } from '../contracts/editor.ts';
import type { RevisionDisplayMode } from '../layout/revision-projection.ts';
import type { RevisionStyles } from '../output/revision-presentation.ts';
import type { FieldShadingMode } from '../output/semantic-paint.ts';
import type { ReviewModuleContribution } from '../contracts/modules.ts';
import type { HyperlinkOps } from './surface-hyperlinks.ts';
import type { EquationActivation, EquationOps } from './surface-equations.ts';
import type { HyperlinkActivation, SurfaceNavigation } from './surface-navigation.ts';
import type {
  CellSelection,
  ContentControlBoundaryRecord,
  NavigationCommand,
  SectionProperties,
  SemanticLayout,
  SemanticPosition,
  SemanticSelection,
  TextMeasurer,
} from '@docx-editor.dev/core/layout';

/**
 * How an edit is written.
 *
 * `'suggest'` is the one that changes what the ops MEAN: the same keystroke becomes a `w:ins`
 * and the same Backspace becomes a `w:del` over the words it would have removed. `'view'`
 * refuses edits outright.
 */
export type SurfaceEditingMode = 'edit' | 'suggest' | 'view';

/**
 * Content-control interaction lane on the paginated surface.
 *
 * Chrome toggles are surface state; value / remove commit through tree ops.
 */
export interface ContentControlOps {
  /** Toggle show-all boundary chrome. No layout reflow. */
  setShowAll(show: boolean): void;
  /** Toggle form-fill Tab navigation mode. */
  setFormFill(active: boolean): void;
  /** Whether show-all chrome is on. */
  showAll(): boolean;
  /** Whether form-fill navigation is on. */
  formFill(): boolean;
  /** Innermost control at the caret from layout boundary records. */
  atCaret(): ContentControlBoundaryRecord | null;
  /**
   * Move to the next or previous editable control (tabIndex, then document order).
   *
   * Skips content-locked and bound controls. Selects the control's content for replacement.
   * Returns whether navigation landed somewhere.
   */
  navigate(direction: 'next' | 'previous'): boolean;
  /**
   * Set a control's value through `setContentControlValue`. Honours lock / bound refusals.
   * Returns whether the op committed.
   */
  setValue(controlId: string, value: string): boolean;
  /**
   * Unwrap a control keeping its content (`removeContentControl`). Defaults to the control
   * at the caret. Returns whether the op committed.
   */
  remove(controlId?: string): boolean;
  /**
   * Engine reason a widget or remove action is disabled, or null when allowed.
   *
   * `edit` covers content / value changes; `remove` covers unwrap.
   */
  disabledReason(controlId: string, action: 'edit' | 'remove'): string | null;
}

/**
 * How a paginated surface opens. Every field is optional.
 *
 * `measurer` is the injection seam that keeps layout DOM-free — supply one to lay a document out
 * on a server, or leave it off in a browser to get the canvas measurer.
 */
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
   * How revisions project into layout and paint. Omitted keeps the layout default
   * (`all-markup`). The editor facade passes `proposed` when no review module is
   * registered — the free tier's final-state rendering; the machinery below this
   * option is shared either way.
   */
  readonly revisionDisplayMode?: RevisionDisplayMode;
  /**
   * When a field's result wears Word's grey shading. Omitted keeps Word's own default,
   * `when-selected`.
   *
   * Applies to ORDINARY fields only. Legacy form fields follow the document's
   * `w:doNotShadeFormData`, because a form's blanks are the document's own statement about
   * itself rather than a reader's preference.
   *
   * A paint-level option, not a layout one: it changes no geometry, so switching it repaints
   * without remeasuring a single line.
   */
  readonly fieldShading?: FieldShadingMode;
  /**
   * How tracked changes are coloured: by AUTHOR (the default), by kind, or by author with
   * host-pinned colours. A paint-level option like {@link fieldShading}: it changes no
   * geometry, so switching it repaints without remeasuring a line. Applies wherever
   * revision markup paints, whatever the {@link revisionDisplayMode} leaves visible.
   */
  readonly revisionStyles?: RevisionStyles;
  /**
   * The review module's derivation hooks for this surface's session. Absent,
   * `session.reviewItems()` is the typed empty queue and every review affordance
   * built on it stays inert.
   */
  readonly reviewModel?: ReviewModuleContribution;
  /**
   * The family a run with no authored font is reported as by `formatting()` AND painted
   * in — the face the measurer falls back to. Absent, such a run reports
   * `fontFamily: null` and paints in whatever font the page inherits, which the measurer
   * did not measure: visible glyphs drift from wrap points and caret geometry.
   */
  readonly defaultFontFamily?: string;
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
  readonly onEquationPopover?: (activation: EquationActivation) => void;
  /**
   * Ctrl/Cmd+K — Word's Insert Hyperlink. The engine reports the request; the host's chrome
   * decides what a link dialog looks like. A host that passes nothing leaves the key alone
   * rather than doing something surprising with it.
   */
  readonly onRequestHyperlink?: () => void;
  /**
   * Localized accessible names for core-owned table insertion furniture.
   * Defaults to English from `@docx-editor.dev/i18n` when omitted.
   */
  readonly tableInteractionLabel?: (
    key: 'table.insertRowBelow' | 'table.insertColumnRight'
  ) => string;
  /** Localized drawing refusal labels; defaults to English when omitted. */
  readonly drawingStrings?: import('../output/semantic-paint-drawings.ts').DrawingPaintStrings;
  /** Override raster decode for package image intents; defaults to browser/headless. */
  readonly imageDecodePort?: import('../store/package/image-resources.ts').ImageDecodePort;
  /**
   * Localized name for a generated TOC, written as the control's `w:alias` on insert.
   *
   * The update ACTIONS are not here: they are rows in the host's context menu, which owns
   * its own labels. The engine paints no menu of its own.
   */
  readonly tocLabels?: {
    readonly title: string;
  };
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
  /**
   * The paragraph flags the Paragraph dialog shows as checkboxes, or null when the
   * selection's paragraphs disagree about that one.
   *
   * `contextualSpacing` is "Don't add space between paragraphs of the same style"; the
   * other four are its Pagination block. Each is read from the cascade, so a flag a STYLE
   * sets reads as on — which is what a checkbox has to show.
   */
  readonly paragraphFlags: ParagraphFlags;
  /**
   * The paragraph's resolved custom tab stops, cascade included, or null when the selection
   * disagrees or nothing is loaded. Positions in TWIPS, like every other measurement a
   * control writes back.
   */
  readonly tabStops: readonly ParagraphTabStop[] | null;
  /**
   * Which of the paragraph-level reads above are `null` because the selection DISAGREES,
   * as opposed to because nothing states them. See {@link ParagraphDisagreements}.
   */
  readonly disagrees: ParagraphDisagreements;
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
   * centres it, `'nearest'` scrolls only when it is out of view — and only far enough to
   * clear the edge, which parks the target flush against it. `'centerIfNeeded'` is the one
   * a jump-to-next-thing control wants: silent while the target is already on screen, and
   * centred when it has to move, so the reader lands looking AT the thing rather than at
   * the bottom line of the window. Default `'start'`.
   */
  readonly block?: 'start' | 'center' | 'centerIfNeeded' | 'nearest';
  /** Padding above the target, in CSS pixels. Default 24. */
  readonly offsetPx?: number;
  readonly behavior?: ScrollBehavior;
}

/**
 * Everything observable about the surface right now, as one immutable value.
 *
 * `revision` is the change token: it moves whenever anything else here does, which is what lets
 * `snapshot()` hand back the same reference until state actually changes.
 */
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
  /**
   * Content-control chrome and form-fill mode.
   *
   * Surface-owned (not document bytes). Updates report through the same `onChange` path as
   * selection moves — hosts must not maintain a parallel channel.
   */
  readonly contentControls: ContentControlSurfaceState;
  /**
   * The TOC the last right-click landed on, or null.
   *
   * A right-click deliberately does not move the caret, and a TOC refuses the caret
   * entirely, so `selection` can never say which table of contents the user is pointing at.
   * This is how a host's context menu learns it. Surface chrome, not document state.
   */
  readonly contextTocId: string | null;
  /** Timing and reuse counters for the last pass. Diagnostics, not document state. */
  readonly perf: PaginatedSurfacePerf;
}

/**
 * Observable content-control interaction state on the paginated surface.
 *
 * Boundary furniture visibility and form-fill navigation are surface chrome, not model
 * bytes — toggling them never reflows layout records.
 */
export interface ContentControlSurfaceState {
  /** Show boundary chrome for every control. */
  readonly showAll: boolean;
  /** Tab / Shift+Tab navigate between editable controls. */
  readonly formFill: boolean;
  /** Innermost control containing the caret, or null. */
  readonly activeControlId: string | null;
}

/**
 * The mounted, painted, editable document — the layer `createDocxEditor` builds its contract on.
 *
 * The painted pages ARE the editable surface: they are `contenteditable`, but the DOM is a
 * picture. Browser mutations are prevented and re-expressed as tree ops, and selection maps only
 * through `data-paragraph-id`/`data-start`, never through DOM node identity.
 *
 * Every write goes through the guarded mutation path on this object. Reaching past it into
 * `session` to apply ops directly bypasses the layout invalidation and the caret bookkeeping.
 */
export interface PaginatedSurface {
  readonly session: TreeDocxSessionView;
  storyScope(): import('@docx-editor.dev/core/store').StoryScope;
  imageDecodePort(): import('../store/package/image-resources.ts').ImageDecodePort;
  applyDrawingOps(
    ops: readonly import('../store/store/tree-op-types.ts').DrawingTreeDocOp[]
  ): TreeApplyResult;
  applyImageProperties(
    input: import('../store/store/tree-package-images.ts').ApplyImagePropertiesInput
  ): import('../store/store/tree-package-images.ts').ImageIntentResult;
  deleteImage(
    drawingNodeId: string
  ): import('../store/store/tree-package-images.ts').ImageIntentResult;
  insertImage(
    input: Omit<import('../store/store/tree-package-images.ts').InsertImageInput, 'decodePort'>
  ): Promise<import('../store/store/tree-package-images.ts').ImageIntentResult>;
  replaceImage(
    drawingNodeId: string,
    bytes: Uint8Array,
    mime: import('../store/package/image-resources.ts').SupportedImageMime,
    options: {
      readonly expectedPackageRevision: number;
      readonly commitGuard?: () => boolean;
    }
  ): Promise<import('../store/store/tree-package-images.ts').ImageIntentResult>;
  layout(): SemanticLayout;
  state(): PaginatedSurfaceState;
  /** One-based page at the caret, or at the centre of the mounted viewport. */
  currentPage(mode?: 'viewport' | 'caret'): number;
  type(text: string): void;
  /** Author one explicit tracked text change without changing the editing mode. */
  proposeTextChange(
    kind: 'insertion' | 'deletion' | 'replacement',
    text: string,
    author?: string
  ): boolean;
  /**
   * Queue plain typed text for a batched commit at the caret.
   *
   * The DOM input lane's entry: keystrokes arriving in a burst append here and land
   * through ONE `type()` call — one transaction, one undo step, one layout flush —
   * when the input queue drains. Every surface-level mutation, selection or scope
   * move, geometry read, composition start and teardown flushes the buffer first.
   * Code reading `session` directly (its text or its bytes) sits BELOW the buffer
   * and must call {@link flushPendingInput} first, as the facade's save/detach
   * paths do. `type()` itself stays synchronous; automation and commands should
   * keep calling it directly.
   */
  enqueueType(text: string): void;
  /**
   * Land any queued typed text now, as its own transaction, AND publish any layout pass a
   * commit deferred under input pressure — so the caller reads current text and current
   * geometry at one seam. Both halves are no-ops when nothing is pending, which is the
   * common case: an isolated commit lays out synchronously in its own tail, and deferral
   * only happens when the browser reports queued input behind an expensive pass.
   */
  flushPendingInput(): void;
  /**
   * Insert text whose newlines are PARAGRAPH BOUNDARIES, in one commit.
   *
   * `type` writes its argument into run text verbatim, so a newline reaching it is a
   * control character the store refuses — which vetoes the whole transaction and makes
   * the insert do nothing at all. This is the lane for text that arrives from outside the
   * editor (a paste, a drop), where line breaks are structure rather than characters.
   *
   * Plain text only, by construction: no markup is parsed and no DOM is built from the
   * payload, whatever its origin.
   */
  insertPlainText(text: string): void;
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
   * Turn the browser's editing affordance on the pages layer on or off.
   *
   * The facade's `mode` gates COMMANDS, which stops `exec` but not the keyboard: the pages
   * layer is `contentEditable` and binds `beforeinput` itself, so a document the facade
   * called read-only still accepted typing straight into it. Read-only has to reach the
   * surface to be true.
   */
  setEditable(editable: boolean): void;
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
  /**
   * Scroll an exact position into view — `revealParagraph` for a caret that is not at
   * offset 0. Focus-independent and virtualization-safe like every reveal: geometry
   * comes from the layout and the target page is materialized on the way. Defaults to
   * `block: 'nearest'`, so an already-visible target never yanks the viewport.
   */
  revealPosition(position: SemanticPosition, options?: RevealOptions): boolean;
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
   * Several paragraph properties in ONE transaction, so a dialog is one undo step.
   *
   * `setParagraphProperty` is this with a single entry. A dialog that fired one call per
   * field would leave the user pressing Ctrl+Z five times to undo one OK, and would paint
   * four intermediate layouts on the way.
   */
  setParagraphProperties(entries: readonly ParagraphPropertyEdit[]): void;
  /**
   * The Paragraph dialog as ONE write: alignment, indents, spacing, line spacing and the
   * five paragraph flags, over every paragraph the selection touches.
   *
   * One transaction, so pressing OK is one undo step and the page repaints once. An omitted
   * field is left as authored; `null` where the type allows it REMOVES the setting so the
   * style supplies it again. Returns whether anything was written.
   */
  setParagraphFormat(update: SurfaceParagraphFormat): boolean;
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
   * The section GOVERNING one paragraph — what a ruler or dialog reflects when the caret sits
   * in a multi-section document.
   *
   * Body content answers for itself, whatever story is open. A header or footer belongs to the
   * section that names its relationship, and a note to the section holding its reference mark.
   * An id nothing settles falls back to the FIRST section: the tail is the document-wide answer
   * and is wrong for everything not on the last page.
   */
  sectionPropertiesAt(paragraphId: string): SectionProperties;
  /**
   * How a section-addressed op should name the section `paragraphId` is in.
   *
   * `w:sectPr` lives on the body story, so such an op can only name body content — and a caret
   * in a header or a note is not body content. Passing that caret straight through made every
   * section write from furniture fail `unknown-paragraph`.
   */
  sectionAnchorParagraphAt(paragraphId: string): import('./section-scope.ts').SectionAnchor;
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
  readonly equations: EquationOps;
  /**
   * Content-control chrome, form-fill navigation, and value / remove verbs.
   *
   * Value and remove commit through `session.applyTreeOps` — the same write path as typing.
   * Show-all and form-fill are surface chrome and never reflow layout.
   */
  readonly contentControls: ContentControlOps;
  /** Whether a `rows`×`cols` table can be inserted at the caret. */
  canInsertTable(rows: number, cols: number): boolean;
  /**
   * Insert an empty `rows`×`cols` table at the caret, columns evenly dividing the content
   * width of the caret's section, and leave the caret in the first cell.
   */
  insertTable(rows: number, cols: number): boolean;
  /** Whether the addressed (or caret-local) body TOC can be refreshed. */
  canRefreshToc(tocId?: string): boolean;
  /** Whether a generated body TOC can be inserted before the caret paragraph. */
  canInsertToc(): boolean;
  /** Insert and populate a generated body TOC before the caret paragraph. */
  insertToc(): boolean;
  /** Refresh cached TOC entries and/or page numbers through the two-pass layout pipeline. */
  refreshToc(tocId?: string, mode?: 'entire' | 'pageNumbers'): boolean;
  /** Whether a body paragraph belongs to a detected TOC boundary or cached result. */
  isInsideToc(paragraphId: string): boolean;
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
  retainSelection(): SelectionPin;
  /** Drop one owned pin. Another owner's pin remains visible. */
  releaseSelection(pin: SelectionPin): void;
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
   * Every author with a revision in the CURRENT layout, mapped to Word's colour slot by
   * order of first appearance. One map instance per layout, so a caller can key caches on
   * its identity.
   */
  revisionAuthors(): ReadonlyMap<string, number>;
  /**
   * Replace how tracked changes are coloured, live. Paint-level: the pages repaint without
   * remeasuring a line, and the caret, selection and undo history stay where they are.
   */
  setRevisionStyles(colors: RevisionStyles | undefined): void;
  /**
   * Commit ops that came from automation, through the gate a keystroke goes through.
   *
   * The narrow entry an automation host writes with, and the reason it needs one: reaching
   * `session.applyTreeOps` past this skips the editing-mode gate entirely — a document open for
   * viewing accepts a scripted edit, and a suggesting document records one as a permanent
   * change with no proposal and no author. Here, viewing refuses, suggesting attributes, the
   * refusal reason is reported like any other, and the pages repaint from the commit.
   *
   * The ops address the story the CALLER named, whatever story the reader is in: the caller
   * identified its target before calling, so following the caret into a header would write
   * somewhere else entirely. They default to the body rather than to the reader's story.
   *
   * They arrive as a BUILDER, given a way to mint the relationship an external hyperlink names.
   * That mint changes the package outside the transaction and outside the undo stack, so it must not
   * happen until the mode has allowed the write — a link minted while the batch was still being
   * planned left its target in a read-only document's `.rels`. A builder answering null means the
   * target is one this engine will not author, and the write is refused having changed nothing.
   */
  applyAutomationOps(
    staged: (relate: (url: string) => string | null) => readonly TreeDocOp[] | null,
    scope?: StoryScope
  ): TreeApplyResult;
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
   * Paint-scale coordinate context for overlay chrome.
   *
   * Internal seam — not part of the public editor contract. Image overlay uses the same
   * `zoom * 96/72` scale and per-page horizontal offsets the painter applied.
   */
  overlayCoordinates(): import('./surface-overlay-coordinates.ts').SurfaceOverlayCoordinates;
  /**
   * The comment or tracked change the caret is in, as the painted bands report it.
   *
   * ONE source for "which item is open". The band under the text and the card beside it are
   * two views of the same answer, and deriving it twice let them disagree — the card closed
   * while the text stayed highlighted.
   */
  activeReviewKey(): string | null;
  /**
   * Open THIS item, named by key, for as long as `selection` stays the live one.
   *
   * Without it the caret is the only evidence of which card is open, and a caret cannot name a
   * card when two cards cover exactly the same characters: `w:ins` wrapping `w:del` — content
   * one reviewer added and another struck — gives the insertion and the deletion one identical
   * range, and every click on either card classified back to whichever the queue happened to
   * list first. The reader clicked "Deleted" and watched "Added" light up.
   *
   * A key, not a position, because the position is precisely what is ambiguous. It holds only
   * while the selection matches; a pointer or keyboard move hands the answer back to the caret,
   * which is what lets the reader step out of a card by clicking away from it.
   *
   * `selection` is what activation wants installed, and it is installed HERE rather than by a
   * `setSelection` of the caller's own so that the pin is up before anything is published. The
   * other order repainted the bands and reported state while the caret was still the only
   * evidence, so a host saw the wrong twin active for one frame and then a correction. Omit it
   * to pin against the live selection, which is what a header or note scope has already set.
   */
  activateReview(key: string, selection?: SemanticSelection): void;
  /**
   * The key {@link activateReview} pinned, or null once its selection is no longer live.
   *
   * Exists so nothing outside the surface keeps its own copy of "the selection came from
   * opening a card". `selectionPlacement` needs that fact to stay quiet about offering a
   * comment on text the reader only selected by opening a card over it, and the copy it used to
   * keep was set on one of activation's three branches, so a header card offered to comment on
   * itself.
   */
  activatedReviewKey(): string | null;
  /**
   * Close the open item until the caret next moves.
   *
   * What a click on the canvas means. The caret does not move when someone clicks the grey
   * around the page, so nothing else would ever put the item away.
   */
  dismissActiveReview(): void;
  /**
   * Revision kinds the CARET must not activate, or null for none.
   *
   * The review rail filters what it renders (structural and format cards are hidden by
   * default), but {@link activeReviewKey} used to compute over the unfiltered queue — a
   * click on tracked text under a format change activated a card the rail does not draw,
   * and nothing on screen lit up. A host that filters its list tells the surface, so the
   * band and the visible cards stay one answer.
   */
  setReviewActivationExclusions(
    kinds: readonly import('@docx-editor.dev/core/store').ReviewRevisionKind[] | null
  ): void;
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
  /**
   * Refresh table insertion furniture labels without remounting or relayout.
   *
   * @public
   */
  refreshTableInteractionLabels(): void;
  focus(): void;
  /**
   * Refresh table insertion furniture labels without remounting the surface.
   *
   * @public
   */
  setTableInteractionLabel(
    resolver: (key: 'table.insertRowBelow' | 'table.insertColumnRight') => string
  ): void;
  destroy(): void;
  /**
   * The section a painted page belongs to, and the page that section starts on.
   *
   * Published because opening a furniture story without a page opens it without a section, and
   * the section is what the ruler clamps to and what a new table's grid is divided from. One
   * header part can serve several sections, so only the page settles which one the reader is
   * looking at.
   */
  sectionAtPage(pageIndex: number): { sectionIndex: number; sectionStart: number };
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
    readonly position?: import('@docx-editor.dev/core/layout').SemanticPosition;
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
  /** Commit one table-command plan as a single store transaction. */
  applyTableCommandPlan(
    plan: import('./table-command-plan.ts').TableCommandPlan
  ): import('../contracts/editor.ts').ExecResult;
}

/**
 * What opening a document produced: a mounted surface, or a refusal.
 *
 * A result rather than a throw, because every refusal here comes from FILE input — a package the
 * bounded reader rejected, a part that exceeded a limit — and a malformed upload should surface
 * as a message the host can show rather than an exception it has to catch.
 */
export type OpenPaginatedResult =
  | { readonly ok: true; readonly surface: PaginatedSurface }
  | { readonly ok: false; readonly reason: string; readonly detail?: string };

export type {
  ParagraphDisagreements,
  ParagraphFlags,
  ParagraphTabStop,
  ParagraphPropertyEdit,
  SurfaceParagraphFormat,
} from './paragraph-format-contract.ts';
