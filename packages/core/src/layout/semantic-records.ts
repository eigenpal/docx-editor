// Revision-tagged semantic layout records over the canonical tree (task 7.1).
//
// These are the records everything downstream reads: interaction derives caret stops and hit
// regions from them (7.4), output paints them without remeasuring (7.5), and the incremental
// engine reuses them by identity (section 9). So they carry two things the painted DOM
// cannot supply back:
//
//   - a REVISION, so a consumer can tell a stale layout from a current one rather than
//     assuming whatever it holds is fresh;
//   - a stable SOURCE RANGE on every line and span — paragraph node id plus UTF-16 offsets —
//     so a position on screen maps to a position in the model without a DOM lookup.
//
// Measurement is a PORT. This package is DOM-free by construction, and a layout that could
// only run in a browser could not be tested deterministically or run headless.

import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import type {
  ParagraphBorderEdge,
  ParagraphBorderSide,
  ParagraphSpacing,
} from './paragraph-style.ts';
import type { ResolvedTabStops, TabLeader } from './paragraph-tabs.ts';
import type { FieldAtomMarker, ModelRange } from './field-pieces.ts';
import type { InlineDrawingRecord, AnchoredDrawingRecord } from './drawing-layout.ts';
import type { RevisionAttribution } from './revision-projection.ts';
import type { ResolvedRunStyle } from './run-style.ts';
import type { FontSlot } from './script-itemization.ts';
import type { ResolvedCellBorders } from './table-borders.ts';
import type { EquationSpanRecord } from './equation-layout.ts';

export type {
  InlineDrawingRecord,
  AnchoredDrawingRecord,
  DrawingGeometry,
} from './drawing-layout.ts';

export type {
  ParagraphBorderEdge,
  ParagraphBorderSide,
  ParagraphBorders,
  ParagraphSpacing,
} from './paragraph-style.ts';
export type { TabLeader } from './paragraph-tabs.ts';
export type {
  ResolvedCellBorders,
  ResolvedTableBorderEdge,
  ResolvedTableBorderEdgeSegment,
  TableBorderSideName,
  TableBorderStrokeRecord,
  TableBorderStyle,
} from './table-borders.ts';

/** A half-open UTF-16 range inside one paragraph, addressed by its canonical node id. */
export interface SourceRange {
  readonly paragraphId: string;
  readonly start: number;
  readonly end: number;
}

/**
 * A rectangle in layout POINTS.
 *
 * Points everywhere in this layer — twips convert at property-read boundaries and CSS pixels at
 * paint. A box carrying either of those would eventually be added to one carrying the other.
 */
export interface LayoutBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A bottom paragraph border as layout published it.
 *
 * `box` is the rule's geometry in the same coordinate space as the fragment (page-content
 * relative). Paint positions from this box and MUST NOT remeasure the border.
 */
export interface ParagraphBottomBorderRecord {
  readonly edge: ParagraphBorderEdge;
  readonly box: LayoutBox;
}

/**
 * One `w:pBdr` rule as layout published it.
 *
 * `box` is the STROKE rectangle in the same coordinate space as the fragment, so paint sets a
 * position and a colour and nothing else. It matters that paint cannot derive these itself:
 * Word draws the side rules OUTSIDE the text column, so `box.x` on a `left`/`bar` stroke is
 * left of the fragment box and a painter reasoning from the fragment alone would put it
 * inside the text.
 */
export interface ParagraphBorderStrokeRecord {
  readonly side: ParagraphBorderSide;
  readonly edge: ParagraphBorderEdge;
  readonly box: LayoutBox;
}

/**
 * The hyperlink a span sits inside, as layout resolved it.
 *
 * Already SANITIZED: `href` is the runtime projection produced once at the trust boundary,
 * and `null` means the link is inert — a refused scheme, or a relationship the package does
 * not declare. Paint, hit-testing and the popover consume this and never the authored target,
 * so there is exactly one place a file-derived URL becomes something a browser can follow.
 *
 * `id` is the `w:hyperlink` node's canonical id, which is what makes the spans of one link
 * recognisable as one link across the several lines it wraps onto — and what an unlink or a
 * retarget addresses.
 */
export interface SpanLinkRecord {
  readonly id: string;
  readonly kind: 'external' | 'internal' | 'unresolved';
  /** Sanitized runtime projection: an absolute URL, `#anchor`, or null when inert. */
  readonly href: string | null;
  /** Bookmark name for an internal link, so navigation need not re-parse the fragment. */
  readonly anchor?: string;
  /** `w:tooltip` — paint puts it on the anchor's `title`. */
  readonly tooltip?: string;
}

/** A run of text on one line sharing identical resolved formatting. */
export interface StyleSpanRecord {
  readonly range: SourceRange;
  readonly text: string;
  /** The run's authored properties, retained as evidence. */
  readonly props: readonly OoxmlProperty[];
  /**
   * The same properties RESOLVED — one unit system, defaults applied.
   *
   * Carried on the span so the measurer, the span and the painter all read one resolution
   * rather than each deriving its own. Two derivations that disagree by a fraction of a
   * point put the caret where no glyph is.
   */
  readonly style: ResolvedRunStyle;
  /**
   * The `w:rFonts` slot this span's text resolves its face through; absent means the base
   * (ascii/hAnsi) slots. {@link style} stays the run's full resolution — with both
   * `fontFamily` and `fontFamilyEastAsia` — so formatting readback and the format painter
   * see the run as authored; measurement, paint and hit-testing resolve the effective face
   * with `styleForFontSlot(span.style, span.fontSlot)`.
   */
  readonly fontSlot?: FontSlot;
  readonly box: LayoutBox;
  /**
   * Cumulative advances from {@link box}.x to each UTF-16 caret boundary in {@link text}.
   *
   * Length is `text.length + 1` (both endpoints). When PRESENT, these are the interaction
   * authority: hit-testing and the caret read them instead of re-measuring. Layout does not
   * publish them eagerly — measuring every character of every laid span dominated page
   * repagination — so interactions measure prefixes on demand through the same measurer the
   * span was laid with (memoized per span; see `prefixWidth` in semantic-hit-test.ts), and
   * only interpolate across {@link box}.width when no measurer is supplied.
   */
  readonly caretEdges?: readonly number[];
  /**
   * `w:tab/@w:leader` of the stop a `\t` span advanced to (ECMA-376 §17.3.1.38).
   *
   * Only ever set on a tab span, and only for a non-`none` leader. Paint repeats the glyph
   * across the advance THIS box already reserved — the leader adds no width of its own, so
   * it can never move the text that follows it.
   */
  readonly tabLeader?: TabLeader;
  /**
   * Advance of ONE leader glyph in this run's face, in points, measured by layout.
   *
   * Paint cannot ask a font how wide a character is, so without this it had to guess and
   * deliberately overfill, leaving the dots at whatever spacing an over-long string
   * happened to produce. Measured, the leader is spaced exactly as the same character
   * typed there would be — which is what Word draws.
   */
  readonly tabLeaderAdvancePt?: number;
  /**
   * The hyperlink this span belongs to, or absent for ordinary text.
   *
   * Carried on the SPAN rather than looked up at paint time because a link that wraps
   * produces one set of spans per line, and paint has no paragraph to walk — only the line
   * it was handed.
   */
  readonly link?: SpanLinkRecord;
  /**
   * Horizontal jump, in points, that a floating object's wrap zone forced before this span.
   *
   * A line that resumes on the far side of a float is still ONE line: its spans keep running
   * model offsets and share a selection band. Only layout knows the jump is an obstacle
   * rather than justification slack, so it publishes it here. Paint reserves it with an inert
   * advance and excludes it from the word spacing it reconstructs — inferring the difference
   * from the gap alone spread the float's whole width across every space on the line.
   */
  readonly wrapAdvanceBefore?: number;
  /**
   * The revision wrappers this text sits inside, outermost first, absent when untracked.
   *
   * Carried on the span for the same reason `style` is: paint and the review surface must read
   * ONE attribution. A sidebar that re-derived which revision covers a span by walking the tree
   * could disagree with what was painted, and the card would point at the wrong text.
   */
  readonly revisions?: readonly RevisionAttribution[];
  /**
   * Present when this span is a field's displayed RESULT, for the shading Word draws under one.
   *
   * `projected` cannot answer this: it is also set for note marks and inline drawings, so it
   * says "layout owns these glyphs" rather than "this is a field". Word shades legacy form
   * fields on a different rule from ordinary ones, which is why the marker distinguishes them.
   *
   * States the FACT, never the appearance — whether shading is drawn is a view decision, made
   * downstream from a host option and the document's own `w:doNotShadeFormData`. Deciding it
   * here would put the caret into layout's cache key and repaginate on every arrow press.
   */
  readonly fieldAtom?: FieldAtomMarker;
  /**
   * Live PAGE/NUMPAGES/SECTIONPAGES projection (layout-time evaluated text).
   *
   * Computed substitutions are not model-editable: paint treats these as atomic furniture
   * and selection mapping refuses them the way it refuses markers.
   */
  readonly projected?: boolean;
  /** Paint-ready geometry for one atomic Office Math equation. */
  readonly equation?: EquationSpanRecord;
  /**
   * Footnote/endnote navigation metadata for projected note atoms.
   *
   * Paint tags body citations (`to-note`) and note-body marks (`to-body`) so React chrome
   * can jump without owning layout logic.
   */
  readonly noteNav?: {
    readonly scopeId: string;
    readonly direction: 'to-note' | 'to-body';
  };
}

/**
 * One laid-out line: its geometry, its baseline, and the styled spans it renders.
 *
 * The unit hit-testing and caret placement resolve against. Geometry comes from HERE, never from
 * the DOM, which is what lets an empty paragraph still get a caret.
 */
export interface LineRecord {
  readonly id: string;
  readonly range: SourceRange;
  readonly spans: readonly StyleSpanRecord[];
  readonly box: LayoutBox;
  /**
   * Where the line's content actually starts, after alignment and the first-line indent.
   *
   * {@link box} is the content BAND the line was broken against — its `x` is the indented
   * column edge and its `width` the available measure, neither of which moves with
   * `w:jc`. Alignment is otherwise expressed only as x offsets on the span boxes, so a line
   * with no spans (an empty paragraph) had no aligned origin at all: paint, hit testing and
   * the caret each fell back to `box.x` and drew a centred empty paragraph's caret hard
   * against the left margin, where it stayed until the first character was typed.
   *
   * Equal to the first span's x whenever there is one, so it is the single origin every
   * consumer can read without a spans-or-box fallback of its own.
   */
  readonly contentX: number;
  /** Distance from the line box top to the text baseline. */
  readonly baseline: number;
  /**
   * Space ABOVE the glyph band inside {@link box} (exact centering, not auto/atLeast).
   *
   * `auto` / `atLeast` extras grow the box BELOW the glyphs — paint puts that depth in
   * padding-bottom. {@link baseline} is measured from the line top and already includes
   * this above-band when present.
   *
   * Published by layout rather than recovered by paint: three paint sites each deriving it
   * separately is how they came to disagree about where a line's text sits.
   */
  readonly leading: number;
  /**
   * Auto/atLeast line-spacing depth BELOW the glyph band, inside {@link box}.
   *
   * The complement of {@link leading}: exact spacing centres the glyphs and moves the
   * baseline down, while auto/atLeast leave the band at the top and grow the box beneath it.
   * So the band a consumer needs is `box.height - trailingSpacing - leading`, and
   * subtracting `leading` alone is right only under the exact rule.
   *
   * A line WITH spans carries its band in the span heights too. An empty paragraph carries
   * nothing, which is why the caret, paint's `padding-bottom` and the content-control
   * boundary all need this published rather than recovered from the box.
   *
   * Zero under the exact rule and on lines holding drawings, where the box is authored.
   * Absent on lines published before this was measured; treat as zero.
   */
  readonly trailingSpacing?: number;
  /**
   * Model ranges on this line covering DELETED content, absent when there is none.
   *
   * The caret steps over these rather than entering them: text typed inside a deletion exists
   * in neither the original nor the proposal, and there is no valid tree for the result.
   *
   * Recorded even in display modes that lay the deletion out invisibly, because the offsets
   * exist in the model in every mode and an offset-by-offset walk would otherwise stop at
   * positions with no glyph.
   */
  readonly deletedRanges?: readonly ModelRange[];
  /**
   * Inline drawings on this line, absent when there are none.
   *
   * Each occupies one UTF-16 model unit at {@link InlineDrawingRecord.start}. Hidden drawings
   * are omitted — they remain in the tree and projection but publish no geometry.
   */
  readonly drawings?: readonly InlineDrawingRecord[];
  /**
   * Revision attributions of tracked ANCHORED drawings whose anchor sits on this line,
   * absent when there are none.
   *
   * An anchored drawing paints from the page layer and leaves no span or line drawing at its
   * anchor offset, so this is the only carrier the margin change bar can read for it. Only
   * attributions the display mode lays out are recorded, matching the published records.
   */
  readonly anchorRevisions?: readonly RevisionAttribution[];
}

/**
 * A paragraph's resolved indent in points, in the vocabulary `w:ind` uses.
 *
 * `left`/`right` are signed; `hanging` is not (`ST_TwipsMeasure`). `firstLine` is signed
 * even though the schema declares it unsigned, because Word's model keeps one signed
 * first-line indent and this engine follows it.
 */
export interface ParagraphIndent {
  readonly left: number;
  readonly right: number;
  readonly firstLine: number;
  readonly hanging: number;
}

/**
 * The part of one paragraph that sits on one page.
 *
 * A paragraph that crosses a page boundary produces several fragments that all name the SAME
 * `paragraphId`, which is what lets selection and hit-testing treat it as one paragraph while
 * pagination treats it as two boxes.
 */
export interface ParagraphFragmentRecord {
  readonly kind: 'paragraph';
  readonly id: string;
  readonly paragraphId: string;
  /** 0 for the first fragment of the paragraph, 1 for its continuation, and so on. */
  readonly fragmentIndex: number;
  readonly range: SourceRange;
  readonly props: readonly OoxmlProperty[];
  /** Resolved paragraph style after the style/default cascade, or null when none applies. */
  readonly styleId: string | null;
  /** Resolved Word outline level (0 = Heading 1), or null for body text. */
  readonly outlineLevel: number | null;
  /** Resolved `w:jc` alignment used by layout. */
  readonly alignment: 'left' | 'center' | 'right' | 'both';
  /**
   * Before/after spacing applied to THIS fragment, in points.
   *
   * Continuations carry `before: 0`; only the final fragment carries `after`. The numbers
   * already reflect Word's adjacent-collapse against the previous paragraph's after.
   */
  readonly spacing: ParagraphSpacing;
  /**
   * The paragraph's EFFECTIVE indent in points, cascade and numbering merge included.
   *
   * Published because it is not recoverable from anything else here. `props` carries the
   * cascaded `w:ind`, but a list paragraph's indent comes from `numbering.xml` and is merged
   * in after the cascade, so a numbered item that authors no `w:ind` reads zero there while
   * its text sits indented. The geometry is no better an answer: `box.x` is cell-relative
   * inside a table and is displaced by float zones.
   *
   * `firstLine` and `hanging` are kept as OOXML spells them. A consumer wanting the one
   * signed first-line offset Word models takes `hanging > 0 ? -hanging : firstLine` —
   * hanging WINS, it is not summed (ECMA-376 §17.3.1.12).
   */
  readonly indent: ParagraphIndent;
  /** Bottom rule on the final fragment when `w:pBdr/w:bottom` resolves; absent otherwise. */
  readonly bottomBorder?: ParagraphBottomBorderRecord;
  /**
   * Every `w:pBdr` rule this fragment draws, in paint order.
   *
   * A paragraph split across pages opens and closes exactly once: the `top` stroke rides the
   * first fragment, the closing stroke the last. `bottomBorder` remains the bottom rule alone
   * — a `between` rule closing a grouped paragraph is not one.
   */
  readonly borders?: readonly ParagraphBorderStrokeRecord[];
  /**
   * Validated 6-hex paragraph shading fill (`w:pPr/w:shd`), absent for none/auto.
   *
   * Paint fills {@link shadingBox}. Measurement ignores it.
   */
  readonly shading?: string;
  /**
   * Geometry of the paragraph shading band when {@link shading} is set. Absent when there
   * is no fill.
   *
   * TWO SHAPES, because Word fills two different things. An UNBORDERED paragraph is filled
   * across its line boxes (indent-aware width), and before/after spacing stays unfilled. A
   * paragraph that publishes any {@link borders} stroke is filled across the rectangle those
   * strokes draw instead — `w:space` padding and rule extent included — so a callout's fill
   * reaches its frame rather than leaving a pale stripe floating inside an empty box. Paint
   * draws the strokes after the fill, so the frame is never covered.
   */
  readonly shadingBox?: LayoutBox;
  /**
   * The revisions on this paragraph's own MARK (`w:pPr/w:rPr/w:ins|w:del`), absent when there
   * are none.
   *
   * Carried on the fragment rather than on a span because they decorate no characters: the
   * pilcrow was inserted or deleted, which is how a split or a merge is recorded. Only the
   * FINAL fragment carries them — the mark lives at the end of the paragraph, so a paragraph
   * split across pages must not draw two of them.
   *
   * A LIST because one mark can hold two decisions at once — an insertion by one author and
   * a deletion of that insertion by the next. Published only in `all-markup`: the other two
   * display modes answer what the document WOULD be, and a resolved view draws no
   * attribution.
   *
   * Those two modes are ATTRIBUTION-resolved, not STRUCTURE-resolved. Taking a deleted mark
   * in `proposed` merges the paragraph into the next one, and taking an inserted mark in
   * `original` un-splits it, but `revision-visibility.ts` does that only for a paragraph that
   * renders no text. So a resolved view still shows the break — it just no longer draws a
   * coloured pilcrow beside it. The merge is the fix for that; suppressing the glyph is not,
   * and must not be read as it.
   */
  readonly markRevisions?: readonly RevisionAttribution[];
  /**
   * The one decision a single-field reader sees, absent when there are none.
   *
   * Derived from {@link markRevisions} at publish time, never authored beside it, so the two
   * cannot disagree: a deletion when the mark carries one, because that is where the pair
   * lands once every decision is taken, and it is the face paint draws for the same reason.
   *
   * @deprecated Shows one of the decisions a mark can carry. Read {@link markRevisions}.
   */
  readonly markRevision?: RevisionAttribution;
  /**
   * The tracked FORMAT change on this paragraph's mark (`w:pPr/w:rPr/w:rPrChange`), absent
   * when there is none. Final fragment only, and `all-markup` only, like the decisions above.
   *
   * Published without a glyph of its own on purpose. Word draws no pilcrow for a mark whose
   * only change is its own formatting — the decision belongs to the review pane, which lists
   * it either way. What was missing was GEOMETRY: with nothing on the fragment, a card had
   * no place on the page to point at.
   */
  readonly markFormatRevision?: RevisionAttribution;
  /**
   * List marker painted in the hanging-indent slot of the FIRST fragment only.
   *
   * Not part of model text: no UTF-16 range, never contributes to caret/selection offsets,
   * and must not be serialised back into the paragraph.
   */
  readonly marker?: ListMarkerRecord;
  /**
   * The paragraph's resolved tab stops — cascade included — and the default interval past
   * the last of them.
   *
   * Published because it is not recoverable from `props`: `w:tabs` carries its meaning in
   * `w:tab` CHILDREN and the flat property projection has none, so a control reading the
   * cascade sees the element and not a single stop. A tab-stop editor that showed only what
   * the paragraph authors would hide a style's stops and then leave them in force.
   */
  readonly tabStops: ResolvedTabStops;
  readonly lines: readonly LineRecord[];
  readonly box: LayoutBox;
}

/**
 * A numbering marker as layout published it.
 *
 * Geometry is in the same coordinate space as the fragment (page-content or cell-content
 * relative). Paint positions from this box and MUST NOT remeasure the marker.
 */
export interface ListMarkerRecord {
  readonly text: string;
  readonly style: ResolvedRunStyle;
  readonly box: LayoutBox;
  /**
   * The `w:ilvl` this marker was resolved at, 0..8.
   *
   * Published because the level, not the geometry, is what Increase/Decrease Indent moves
   * on a list paragraph — demoting an item re-resolves its format from `numbering.xml`,
   * which is why a bullet becomes a hollow circle and a `1.` becomes an `a.`.
   */
  readonly level: number;
  /**
   * The `w:numId` this marker resolved through.
   *
   * Published with the level because the two together are what identifies a list: whether
   * a demote is even possible depends on which levels THIS definition declares, and a
   * document may hold several lists whose level 0 looks identical.
   */
  readonly numId: string;
  /** `w:numFmt` of the resolved level — `bullet` or a numbering format. */
  readonly numFmt: string;
  /** Resolved counter at this marker's own level; absent for bullets. */
  readonly ordinal?: number;
}

/**
 * The part of one table that sits on one page.
 *
 * A table that crosses a page boundary produces one fragment per page it spans, which is
 * what lets it checkpoint like a paragraph: the flow loop places whole fragments, and
 * resuming after a table needs no knowledge of its interior.
 */
export interface TableFragmentRecord {
  readonly kind: 'table';
  readonly id: string;
  /** Canonical node id of the `w:tbl`. */
  readonly tableId: string;
  /** 0 for the first page the table touches, 1 for its continuation, and so on. */
  readonly fragmentIndex: number;
  /** Nesting depth: 0 for body-level tables, increasing for nested tables. */
  readonly nestingDepth: number;
  /**
   * Resolved column boundary x positions in table-local points, left edge through right edge.
   * Length is column count + 1.
   */
  readonly columnEdges: readonly number[];
  readonly rows: readonly TableRowFragmentRecord[];
  readonly box: LayoutBox;
}

/**
 * One table row on one page.
 *
 * A FRAGMENT, not the row: a row split across a page break appears once per page it touches, and
 * a repeated header row appears on every page of its table.
 */
export interface TableRowFragmentRecord {
  /** Canonical node id of the `w:tr`. */
  readonly id: string;
  /** Pending tracked row insertion/deletion, when authored in `w:trPr`. */
  readonly revisionKind?: 'insert' | 'delete';
  /**
   * The `w:trPr/w:ins|w:del` attribution — the `(id, author, date)` triple the review model
   * addresses this decision by, so painted rows can carry it the way revision spans do.
   */
  readonly revisionId?: string;
  readonly revisionAuthor?: string;
  readonly revisionDate?: string;
  /** Authored row ordinal within the table; repeats share the original row's index. */
  readonly rowIndex: number;
  /** True when the authored row resolves `w:tblHeader`, including its first occurrence. */
  readonly isHeaderRow: boolean;
  /**
   * True for a `w:tblHeader` row RE-EMITTED at the top of a continuation page. Painted,
   * but excluded from interaction walks so each caret stop exists exactly once.
   */
  readonly isHeaderRepeat: boolean;
  /**
   * True when this record continues a row that already emitted content on a prior page
   * (cell content fragmented at a paragraph/line boundary). Same `id` as the lead fragment.
   */
  readonly isContinuation?: boolean;
  readonly cells: readonly TableCellFragmentRecord[];
  readonly box: LayoutBox;
}

/**
 * One table cell on one page, already resolved against the grid.
 *
 * `gridSpan` is clamped at read time, because it comes from a file and an unclamped span is a
 * loop bound an attacker controls. A vertical-merge continuation paints its box but holds no
 * blocks — its content belongs to the cell that started the merge.
 */
export interface TableCellFragmentRecord {
  /** Canonical node id of the `w:tc`. */
  readonly id: string;
  /** First grid column this cell occupies. */
  readonly gridColumn: number;
  /** Canonical `w:gridCol` node id for this cell's start column, when authored. */
  readonly gridColumnId?: string;
  /** Grid columns spanned, already clamped at read time. */
  readonly gridSpan: number;
  /** A vertical-merge continuation paints its box but holds no blocks. */
  readonly vMergeContinue: boolean;
  /**
   * When true, paint skips borders/fill/content for this cell (vMerge continue). Grid
   * bookkeeping and the box remain so selection/geometry walks stay consistent.
   */
  readonly paintInert?: boolean;
  /** Number of rows this restart cell visually spans (1 when not a vertical merge). */
  readonly rowSpan?: number;
  /** Validated 6-hex cell shading fill, absent for none/auto. */
  readonly shading?: string;
  /**
   * Layout-owned resolved borders after collapsed conflict resolution.
   *
   * Includes convenience per-side edges, per-grid-interval winners, and explicit compound
   * stroke rectangles in cell-local points. Paint only scales and draws — it must not
   * invent stroke/gap/corner geometry.
   */
  readonly borders?: ResolvedCellBorders;
  /** Nested blocks in reading order; recursion carries nested tables. */
  readonly blocks: readonly BlockFragmentRecord[];
  readonly box: LayoutBox;
}

/** A top-level (or cell-level) block fragment, discriminated by `kind`. */
export type BlockFragmentRecord = ParagraphFragmentRecord | TableFragmentRecord;

/**
 * One header or footer story as it sits on one page.
 *
 * `box` is absolute (sheet coordinates) and sized to the story's FLOW height — never to
 * any anchored-object extent, which is the rule that keeps a decorated header's hit area
 * from covering the body. `fragments` are story-relative (origin at the box's top-left).
 * Baseline furniture may be shared across pages of the same variant when the story has no
 * allowlisted PAGE/NUMPAGES/SECTIONPAGES fields; after page-field finalize, projections are
 * per page (or per distinct field values for count-only stories).
 */
export interface HeaderFooterStoryRecord {
  readonly kind: 'header' | 'footer';
  readonly variant: 'default' | 'first' | 'even';
  readonly partName: string;
  /**
   * The part this story was laid out from. See {@link HeaderFooterStoryLayout.part}.
   *
   * Present when the furniture source supplied it. A pass that needs the story's TREE — the
   * content-control boundary derivation is the one — reads it here rather than resolving a
   * name against a package it does not have.
   */
  readonly part?: import('../store/package/ooxml-tree.ts').OoxmlPart;
  /**
   * Main-document relationship id that resolves to this part (`EditorScope.rId`).
   *
   * Present when the furniture source could name the relationship; scoped editing binds
   * on this id so shared parts stay one story across pages/sections.
   */
  readonly rId?: string;
  readonly box: LayoutBox;
  readonly fragments: readonly BlockFragmentRecord[];
  /** Anchored drawings owned by this story, in story-relative coordinates. */
  readonly anchoredDrawings?: readonly AnchoredDrawingRecord[];
  /**
   * Transient projector used between furniture attach and document-level page-field
   * finalize. Absent on published layout records after finalize — but not dead: finalize
   * retains it (with the context it last ran under) in a side table keyed on the published
   * record (`strippedStoryProjections` in `field-page-furniture.ts`), so a reused sheet can
   * re-project when the page count moves (#441). The retained closure keeps its minting
   * pass's scope alive for as long as the sheet is reused, and anything that clones a
   * published field-bearing story must carry the entry onto the clone
   * (`carryStrippedPageFieldProjection`).
   */
  readonly pageFieldProjector?: (context: {
    readonly pageNumber: number;
    readonly pageCount: number;
    readonly sectionPageCount?: number;
    readonly format?: string;
  }) => HeaderFooterStoryRecord;
}

/**
 * One footnote or endnote story as it sits on one page (or continuation page).
 *
 * Notes are ordinary editable stories — NOT `[data-docx-hf]` furniture. `box` is absolute
 * (sheet coordinates). `fragments` are story-relative. Separators are nonselectable paint
 * geometry owned by the parent {@link NoteAreaRecord}.
 */
export interface NoteStoryRecord {
  readonly noteKind: 'footnote' | 'endnote';
  readonly noteId: number;
  /** `footnote:N` / `endnote:N` — EditorScope note id. */
  readonly scopeId: string;
  /** Derived display mark for this occurrence; null when customMarkFollows / continuation. */
  readonly mark: string | null;
  /** True when this is a continuation fragment (no leading mark). */
  readonly continuation?: boolean;
  readonly box: LayoutBox;
  readonly fragments: readonly BlockFragmentRecord[];
}

/**
 * Footnote / endnote area on one page: separator + stacked note stories.
 *
 * `placement` records how the area was positioned. `fallbackReason` is set when the
 * bounded reflow loop exhausted and layout kept the reference with its note on a later
 * page (D12 named fallback).
 */
export interface NoteAreaRecord {
  readonly kind: 'footnotes' | 'endnotes';
  readonly placement: 'pageBottom' | 'beneathText' | 'sectEnd' | 'docEnd';
  readonly box: LayoutBox;
  /** Separator rule / authored separator story; absent when no notes on this page. */
  readonly separator?: {
    readonly kind: 'separator' | 'continuationSeparator';
    readonly box: LayoutBox;
    readonly fragments: readonly BlockFragmentRecord[];
    readonly synthetic: boolean;
    /** Layout-owned single/double rule when marker-only or synthetic; absent for authored stories. */
    readonly ruleStyle?: 'single' | 'double';
  };
  readonly notes: readonly NoteStoryRecord[];
  readonly fallbackReason?: string;
}

/**
 * Note-stream ownership for overflow sheets created by note pagination.
 *
 * - `footnote-drain`: continuation pages that exist only to finish pageBottom footnotes —
 *   not free body hosts for sectEnd/docEnd endnotes.
 * - `endnote-overflow`: sheets inserted to finish sectEnd/docEnd collections.
 */
export type PageNoteStream = 'footnote-drain' | 'endnote-overflow';

/**
 * Raw `w:lock/@w:val` on one control, or `unlocked` when absent / unrecognised.
 *
 * Effective permissions across a nesting chain are the union of every ancestor's lock on two
 * axes (content edit / removal); see {@link ContentControlBoundaryRecord.effectiveLock}.
 */
export type ContentControlLock = 'unlocked' | 'sdtLocked' | 'contentLocked' | 'sdtContentLocked';

/**
 * Mapped control type for layout / chrome — same members as the shipped public
 * `ContentControlType`. Untyped and preserved-only kinds report as `richText`.
 */
export type ContentControlMappedType =
  | 'richText'
  | 'plainText'
  | 'checkbox'
  | 'dropdown'
  | 'comboBox'
  | 'date'
  | 'picture'
  | 'repeatingSection';

/** Where the control sits in the tree relative to its content. */
export type ContentControlLevel = 'block' | 'inline' | 'row' | 'cell';

/**
 * One piece of a control's content geometry.
 *
 * A block control that crosses a page break publishes one fragment per page rather than a
 * single rectangle covering the inter-page gap. An inline control publishes one fragment per
 * LINE it touches, covering the text's vertical extent (line-spacing leading excluded), so a
 * wrapped control never claims the words beside it. Coordinates match fragment boxes
 * (page-content space).
 */
export interface ContentControlGeometryFragment {
  readonly pageIndex: number;
  readonly box: LayoutBox;
}

/**
 * Layout-published boundary for one content control (`w:sdt` / typed `contentControl`).
 *
 * Chrome, lock feedback, and hit resolution read this record — never painted DOM. The wrapper
 * itself is not a layout box; `fragments` cover the content that already flowed in place.
 */
export interface ContentControlBoundaryRecord {
  /** Canonical node id of the control wrapper — not `w:id`. */
  readonly id: string;
  readonly alias?: string;
  readonly tag?: string;
  readonly controlType: ContentControlMappedType;
  /** This control's own `w:lock`, before ancestor union. */
  readonly lock: ContentControlLock;
  /**
   * Nested lock union with every ancestor control, collapsed back to a single `ST_Lock`
   * vocabulary value (both axes locked → `sdtContentLocked`).
   */
  readonly effectiveLock: ContentControlLock;
  /** `w:showingPlcHdr` is present on the control's properties. */
  readonly placeholder: boolean;
  /** `w:dataBinding` is present — content edits are refused as bound. */
  readonly bound: boolean;
  /** 0 for a top-level control; increments through nested wrappers under the shared nesting bound. */
  readonly nestingDepth: number;
  readonly level: ContentControlLevel;
  readonly fragments: readonly ContentControlGeometryFragment[];
}

/**
 * One laid-out page: the sheet, the content area, and everything that landed on it.
 *
 * Page identity is REUSED across incremental passes — a pass that changes nothing returns the
 * previous records by reference, which is what lets paint skip untouched pages entirely.
 */
export interface PageRecord {
  readonly id: string;
  readonly index: number;
  /** The whole sheet. */
  readonly box: LayoutBox;
  /** The area inside the margins that content flows into. */
  readonly contentBox: LayoutBox;
  readonly fragments: readonly BlockFragmentRecord[];
  /** Layout-owned vertical rules requested by `w:cols/@w:sep`, content-box relative. */
  readonly columnSeparators?: readonly LayoutBox[];
  /** Page-content anchored drawings on this sheet, absent when there are none. */
  readonly anchoredDrawings?: readonly AnchoredDrawingRecord[];
  /** Page furniture for this page's variant, absent when the document declares none. */
  readonly header?: HeaderFooterStoryRecord;
  readonly footer?: HeaderFooterStoryRecord;
  /** Footnotes reserved on this page (pageBottom / beneathText / continuations). */
  readonly footnotes?: NoteAreaRecord;
  /** Endnotes collected on this page (sectEnd / docEnd). */
  readonly endnotes?: NoteAreaRecord;
  /**
   * Ownership of note-only overflow sheets. Absent on ordinary body pages.
   * Layout pagination sets this so endnote hosting does not treat footnote drain
   * pages as free body space.
   */
  readonly noteStream?: PageNoteStream;
  /**
   * Section-local PAGE/SECTIONPAGES inputs for finalize. Absent → physical page index and
   * document-wide section count (empty `w:pgNumType` behaviour).
   */
  readonly pageFieldSource?: {
    readonly pageNumber: number;
    readonly sectionPageCount: number;
    readonly format?: string;
  };
  /**
   * `true` when this page's body flow (or a body table) carries a PAGE/NUMPAGES/SECTIONPAGES
   * placeholder that document finalize must substitute. Set when the page is assembled, so it
   * rides the record through incremental reuse. `false` lets `finalizePageFieldProjection` skip
   * the substitution walk; `undefined` (a page built by a path that does not stamp it) still
   * walks, which is safe.
   */
  readonly hasBodyPageFields?: boolean;
  /**
   * Content-control boundaries whose geometry intersects this page.
   *
   * Carried on the page so a consumer that only holds a page record still sees current
   * metadata; identity reuse of an unchanged page keeps the same array only when the
   * control-context token matches.
   */
  readonly contentControls?: readonly ContentControlBoundaryRecord[];
}

/**
 * A complete layout pass: every page, plus the document-wide indexes derived alongside them.
 *
 * Stamped with the store `revision` it was laid out from, so anything holding geometry can tell
 * whether the document has moved underneath it — which is how stale pointer gestures and
 * overlays are refused rather than applied to coordinates that no longer describe anything.
 */
export interface SemanticLayout {
  /** The store revision these records were laid out from. */
  readonly revision: number;
  /** Revision projection already applied to every published record. */
  readonly displayMode?: import('./revision-projection.ts').RevisionDisplayMode;
  readonly pages: readonly PageRecord[];
  /**
   * Every content-control boundary in document order, including multi-page fragment lists.
   *
   * Always recomputed when a document layout pass finishes, so incremental page-identity
   * reuse cannot publish stale alias/tag/lock metadata.
   */
  readonly contentControls?: readonly ContentControlBoundaryRecord[];
  /**
   * Fingerprint of wrapper-only control metadata (alias, tag, lock, type, placeholder, binding).
   *
   * Folded into the layout producer / session context so a metadata-only edit invalidates
   * reuse paths that would otherwise return previous pages by identity with stale boundaries.
   */
  readonly controlContextToken?: string;
}

/** Page geometry, in points. */
export interface PageGeometry {
  readonly width: number;
  readonly height: number;
  readonly margin: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  /** `w:pgMar/@header` — sheet edge to header top, in points. Defaults to 36 (720 twips). */
  readonly headerDistance?: number;
  /** `w:pgMar/@footer` — sheet edge to footer bottom, in points. Defaults to 36. */
  readonly footerDistance?: number;
}

/** US Letter with one-inch margins, in points. */
export const DEFAULT_PAGE_GEOMETRY: PageGeometry = Object.freeze({
  width: 612,
  height: 792,
  margin: Object.freeze({ top: 72, right: 72, bottom: 72, left: 72 }),
});

/**
 * Text measurement, injected.
 *
 * A real implementation shapes with the resolved font; the tests supply a deterministic one.
 * Layout never reads the DOM, so this is the only way width and height enter it.
 */
export interface TextMeasurer {
  /** Advance width of `text` in the resolved style. */
  measure(text: string, style: ResolvedRunStyle): number;
  /** Line height and baseline for the resolved style. */
  lineMetrics(style: ResolvedRunStyle): { height: number; baseline: number };
}

export {
  anchoredDrawingsOf,
  contentControlsOfLayout,
  effectiveContentControlLock,
  forEachStoryDrawing,
  forEachStoryParagraphFragment,
  fragmentsOfParagraph,
  lineAtPosition,
  linesOf,
  paragraphFragmentsOf,
  paragraphFragmentsOfBlocks,
  unionLayoutBoxes,
} from './semantic-record-queries.ts';
export type { StoryDrawingHost } from './semantic-record-queries.ts';
