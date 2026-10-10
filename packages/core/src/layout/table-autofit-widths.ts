import { cachedAutofitCellWidths, widenedCellInsets } from './table-autofit-cell-cache.ts';
import { rowForWidenedMeasurement } from './legacy-table-side-rules.ts';
import { autofitReuseScope } from './autofit-context-reuse.ts';
import { withDefaultTabInterval } from './paragraph-tabs.ts';
import {
  cellSpacingGapPt,
  cellSpacingScale,
  columnsAroundCells,
  spacedCellWidths,
  spacingGapsPt,
} from './table-cell-spacing.ts';
import {
  MIN_COLUMN_PT,
  contentSizedWidths,
  spanAdjustedMinimums,
  type SpanRequirement,
} from './table-autofit-distribution.ts';
// Autofit column minimums: a column is never narrower than the widest unbreakable segment
// its cells hold.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { PAGE_BREAK_CHAR } from '../store/package/hard-break.ts';
import { bidiSourceBoundaries } from './bidi-piece-coalescing.ts';
import { bidiPieces, paragraphIsRtl } from './rtl-paragraph.ts';
import {
  BREAK_AFTER_DASH,
  ENDS_WITH_BREAKING_SPACE,
  STARTS_WITH_BREAKING_SPACE,
  wordBoundaries,
} from './cjk-line-break.ts';
import { measureInlineDrawing, type InlineDrawingLayoutContext } from './drawing-layout.ts';
import { createEquationLayouter } from './equation-layout.ts';
import type { DocumentProperties } from '@docx-editor.dev/core/store';
import type { FieldCodeRanges } from './field-code-toc.ts';
import type { BodyPageFieldContext } from './field-page-furniture.ts';
import type { FieldPageContext } from './field-projection.ts';
import type { RefFieldContext } from './field-ref.ts';
import type { NoteMarkContext } from './note-projection.ts';
import type { TocLinkRanges } from './toc-link-formatting.ts';
import { cellStyleKey } from './autofit-value-token.ts';
import { piecesOfParagraphForDisplay } from './field-projection-display.ts';
import type { ResolvedListItem } from './list-resolve.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';
import { measureDisplayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { TextMeasurer } from './semantic-records.ts';
import type { SemanticTableCell, SemanticTableStructure } from './semantic-table.ts';
import {
  cascadeRunProperties,
  resolveParagraphLayoutInputs,
  type StyleCascadeTable,
} from './style-cascade.ts';
import { cellContentInsets } from './table-cell-geometry.ts';
import { preferredSpreadWidths } from './table-autofit-spread.ts';
import type { PreferredWidth } from './table-widths.ts';
import { withoutTrailingSpaces } from './trailing-spaces.ts';

/**
 * What autofit needs from layout to measure each cell the way layout paints it.
 * @public
 */
export interface TableAutofitContext {
  /** Measures text exactly as line breaking does. */
  readonly measurer: TextMeasurer;
  /** List items by paragraph id: a list level indents its paragraph. */
  readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
  /** Resolves inline pictures, so a picture column keeps the width the picture paints at. */
  readonly inlineDrawingLayout?: InlineDrawingLayoutContext;
  /** Field and note context, so the minimum measures the text layout paints. */
  readonly fields?: AutofitFieldContext;
  /** The document's default tab interval, where an unwrapped line's tabs advance to. */
  readonly defaultTabStopPt?: number;
  /**
   * A token that changes whenever a paragraph's projected text can change: the same tokens
   * the paragraph break cache keys on. Minimums are cached only when this and
   * {@link TableAutofitContext.passToken} are both given.
   */
  readonly paragraphToken?: (paragraph: OoxmlElement) => string;
  /**
   * A token over every other input the minimum reads: the drawing context and every member of
   * {@link TableAutofitContext.fields}. It must change when any of them changes. List state is
   * not part of it: {@link TableAutofitContext.paragraphToken} must carry each paragraph's
   * list tokens.
   */
  readonly passToken?: string;
}

/**
 * The field and note context cell layout projects paragraphs with.
 * @public
 */
export interface AutofitFieldContext {
  /** The page a header or footer paints on, for its PAGE and NUMPAGES results. */
  readonly pageContext?: FieldPageContext;
  /** Footnote and endnote reference marks, as numbered for this pass. Treated as immutable. */
  readonly noteMarks?: NoteMarkContext;
  /** Package properties that AUTHOR, TITLE, and similar fields paint. */
  readonly documentProperties?: DocumentProperties;
  /** Body page-field placeholders; `false` paints cached results instead. */
  readonly bodyPageFields?: BodyPageFieldContext | false;
  /** Refreshed cross-reference results. */
  readonly refFields?: RefFieldContext;
  /** Paint field instructions instead of results. */
  readonly showFieldCodes?: boolean;
  /** Field-code ranges by paragraph id, when instructions are shown. */
  readonly fieldCodeRanges?: FieldCodeRanges;
  /** Table-of-contents link styling by paragraph id. */
  readonly tocLinkStyleRanges?: TocLinkRanges;
}

export { autofitContextOf, carryTableAutofitScope } from './table-autofit-context.ts';

/** The view a structure was read in: the cascade, display mode, and author filter. */
export interface AutofitView {
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly displayMode: RevisionDisplayMode;
  readonly authorFilter: RevisionAuthorFilter | undefined;
  /** How deep the table being measured sits; nested tables read one level deeper. */
  readonly depth?: number;
  /**
   * Reads a nested table in the same view in the narrowest cell, at its own depth; null past
   * the nesting limit, where layout paints nothing either. See {@link narrowNestedReader}.
   */
  readonly readNested: (table: OoxmlElement, depth: number) => SemanticTableStructure | null;
}

/** Below this a column is already as wide as its content needs. */
const WIDTH_EPSILON_PT = 0.01;

interface MinimumInputs {
  readonly context: TableAutofitContext;
  readonly view: AutofitView;
  readonly tableCellStyle: SemanticTableCell['styleFormatting'] | undefined;
}

/** What a cached minimum was measured under: view identities and string tokens only. */
interface MinimumKey {
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly displayMode: RevisionDisplayMode;
  readonly authorFilter: string;
  readonly cellStyle: string;
  /** Shared by every paragraph of a pass, so it usually compares by pointer. */
  readonly passToken: string;
  readonly paragraphToken: string;
}

/**
 * The last minimum per measurer and paragraph node, so an edit re-measures only the paragraphs
 * it changed. Keyed by the measurer first and holding only tokens in its values: neither a
 * disposed export measurer nor an earlier pass's field and drawing contexts live on through
 * the document's nodes.
 */
const paragraphMinimums = new WeakMap<
  TextMeasurer,
  WeakMap<
    OoxmlElement,
    { readonly key: MinimumKey; readonly widths: ContentWidths; scope?: object }
  >
>();

/** A paragraph's narrowest and widest width: unbreakable segments, and lines left unwrapped. */
export interface ContentWidths {
  readonly min: number;
  readonly max: number;
}

function minimumKey(paragraph: OoxmlElement, inputs: MinimumInputs): MinimumKey | null {
  const { context, view } = inputs;
  // Both tokens or no cache: a paragraph token alone cannot see the pass inputs change.
  if (!context.paragraphToken || context.passToken === undefined) return null;
  return {
    styleCascade: view.styleCascade,
    displayMode: view.displayMode,
    authorFilter: view.authorFilter?.cacheKey ?? '',
    cellStyle: cellStyleKey(inputs.tableCellStyle),
    passToken: context.passToken,
    paragraphToken: context.paragraphToken(paragraph),
  };
}

function sameKey(a: MinimumKey, b: MinimumKey): boolean {
  return (
    a.styleCascade === b.styleCascade &&
    a.displayMode === b.displayMode &&
    a.authorFilter === b.authorFilter &&
    a.cellStyle === b.cellStyle &&
    a.passToken === b.passToken &&
    a.paragraphToken === b.paragraphToken
  );
}

/**
 * The widest segment of a paragraph that no line break may split, plus its indents.
 *
 * Break opportunities are spaces, tabs, line breaks, and the dash rule of
 * {@link wordBoundaries}. An ideographic run counts as one segment here: an autofit column
 * widens to keep it whole, although line breaking may still wrap it inside the column. A
 * segment runs across source runs, field results, and hidden text, measured in the face each
 * piece paints. A positive first-line indent counts against the first segment.
 */
export function paragraphMinimumWidthPt(paragraph: OoxmlElement, inputs: MinimumInputs): number {
  return paragraphContentWidthsPt(paragraph, inputs).min;
}

/**
 * {@link paragraphMinimumWidthPt} together with the paragraph's widest line when nothing wraps:
 * every line between hard breaks at its full width, trailing spaces hung, plus its indents.
 */
export function paragraphContentWidthsPt(
  paragraph: OoxmlElement,
  inputs: MinimumInputs
): ContentWidths {
  const { context, view } = inputs;
  const { measurer } = context;
  const { styleCascade, displayMode } = view;
  const scope = autofitReuseScope(context);
  let byParagraph = paragraphMinimums.get(measurer);
  if (!byParagraph) paragraphMinimums.set(measurer, (byParagraph = new WeakMap()));
  const cached = byParagraph.get(paragraph);
  if (
    scope &&
    cached?.scope === scope &&
    cached.key.styleCascade === view.styleCascade &&
    cached.key.displayMode === view.displayMode &&
    cached.key.authorFilter === (view.authorFilter?.cacheKey ?? '') &&
    cached.key.cellStyle === cellStyleKey(inputs.tableCellStyle)
  )
    return cached.widths;
  const key = minimumKey(paragraph, inputs);
  if (key && cached && sameKey(cached.key, key)) {
    cached.scope = scope;
    return cached.widths;
  }
  const layoutInputs = resolveParagraphLayoutInputs(
    paragraph,
    Number.MAX_SAFE_INTEGER,
    styleCascade,
    context.listItems?.get(paragraph.id),
    inputs.tableCellStyle,
    true
  );
  const fields = context.fields;
  const projected = piecesOfParagraphForDisplay(
    paragraph,
    layoutInputs.inheritedRunProperties,
    fields?.pageContext,
    styleCascade
      ? (inherited, direct) => cascadeRunProperties(inherited, direct, styleCascade)
      : undefined,
    undefined,
    fields?.noteMarks,
    displayMode,
    undefined,
    context.inlineDrawingLayout,
    styleCascade?.themeFonts,
    undefined,
    fields?.documentProperties,
    fields?.bodyPageFields ?? false,
    fields?.refFields,
    view.authorFilter,
    fields?.showFieldCodes,
    fields?.fieldCodeRanges?.get(paragraph.id),
    fields?.tocLinkStyleRanges?.get(paragraph.id)
  );
  // The bidi pass gives each piece the shaping and joining context line breaking measures with;
  // an unshaped complex-script word measures far wider than it paints.
  const pieces = bidiPieces(
    projected,
    paragraphIsRtl(layoutInputs.props),
    bidiSourceBoundaries(paragraph),
    true
  );
  const { left, right, firstLine, hanging } = layoutInputs.indent;
  const tabs = withDefaultTabInterval(layoutInputs.tabStops, context.defaultTabStopPt);
  // Tab stops count from the leading indent, which is the right one in right-to-left text.
  // The line breaker clamps a negative leading indent at the content edge.
  const leading = Math.max(0, paragraphIsRtl(layoutInputs.props) ? right : left);
  // Where a tab at `at` lands: the next stop the paragraph states, else the default grid.
  const nextTabStop = (at: number): number => {
    for (const stop of tabs.stops)
      if (!stop.numberingOnly && stop.positionPt > at + 1e-6) return stop.positionPt;
    const interval = tabs.defaultIntervalPt;
    return (Math.floor(at / interval + 1e-6) + 1) * interval;
  };
  // Where each line starts: the first one shifted by its first-line indent or hanging. A list
  // item's hanging slot belongs to its marker; its text starts back at the left indent.
  const listItem = context.listItems?.get(paragraph.id);
  const firstShift = listItem ? Math.max(0, firstLine) : hanging > 0 ? -hanging : firstLine;
  let widest = 0;
  let segment = 0;
  let first = true;
  // The unwrapped line: its full width so far, and the spaces it would hang at its end.
  let line = 0;
  let hung = 0;
  let longest = 0;
  let onFirstLine = true;
  const endLine = (): void => {
    const width = line - hung + Math.max(0, left + right + (onFirstLine ? firstShift : 0));
    if (line > 0 && width > longest) longest = width;
    line = 0;
    hung = 0;
    onFirstLine = false;
  };
  const advance = (width: number, spaces = 0): void => {
    line += width;
    hung = spaces < width ? spaces : hung + spaces;
  };
  const close = (): void => {
    if (segment > 0) {
      // Indents are physical sides; the first-line shift moves whichever one leads.
      const width = segment + Math.max(0, left + right + (first ? firstShift : 0));
      if (width > widest) widest = width;
      first = false;
    }
    segment = 0;
  };
  // Spaces that open a line are placed before its first word, so they count toward it.
  let lineStart = true;
  let lead = 0;
  let layoutEquation: ReturnType<typeof createEquationLayouter> | undefined;
  // A dash that ends a run breaks only if the next run does not open with another dash.
  let dashPending = false;
  for (const piece of pieces) {
    if (piece.style.hidden) continue;
    // A drawing that is not an inline atom (anchored, hidden, unresolved) takes no width in
    // the line, exactly as the line breaker skips its placeholder.
    if (piece.projected && !piece.inlineDrawing && !piece.equation && piece.text === '\uFFFC')
      continue;
    if (dashPending && !BREAK_AFTER_DASH.has(piece.text[0] ?? '')) close();
    dashPending = false;
    // A table cell lays out as though page breaks were absent: the words around one join.
    if (piece.text === PAGE_BREAK_CHAR) continue;
    if (piece.text === '\n') {
      // A break ends the first line, and with it the first-line indent.
      endLine();
      close();
      first = false;
      lineStart = true;
      lead = 0;
      continue;
    }
    // A picture or an equation is one box with a break opportunity on each side.
    const atomWidth = piece.inlineDrawing
      ? measureInlineDrawing(piece.inlineDrawing.projection).totalWidth
      : piece.equation
        ? (layoutEquation ??= createEquationLayouter(measurer))(piece.equation, piece.style)
            .geometry.box.width
        : undefined;
    if (atomWidth !== undefined) {
      advance(atomWidth);
      close();
      segment = (lineStart ? lead : 0) + atomWidth;
      close();
      lineStart = false;
      lead = 0;
      continue;
    }
    // A run that opens with a breaking space breaks before it, as the line breaker does.
    if (STARTS_WITH_BREAKING_SPACE.test(piece.text)) close();
    const style = styleForFontSlot(piece.style, piece.fontSlot);
    const measure = (text: string): number => measureDisplayText(text, style, measurer);
    if (piece.measureText !== undefined) {
      advance(measure(piece.measureText));
      segment += lead + measure(piece.measureText);
      lineStart = false;
      lead = 0;
      continue;
    }
    let from = 0;
    for (const to of wordBoundaries(piece.text, false)) {
      const candidate = piece.text.slice(from, to);
      from = to;
      if (candidate.length === 0) continue;
      if (candidate === '\t') {
        // A tab uses up the first-line indent, and spaces after it no longer open the line.
        const at = line + leading + (onFirstLine ? firstShift : 0);
        advance(Math.max(0, nextTabStop(at) - at));
        close();
        first = false;
        lineStart = false;
        lead = 0;
        continue;
      }
      // Measured as line breaking measures it, so the advance comes from the same cache;
      // the trailing spaces it hangs are priced on their own.
      const ink = withoutTrailingSpaces(candidate);
      const full = measure(candidate);
      advance(full, ink.length === candidate.length ? 0 : full - (ink ? measure(ink) : 0));
      if (lineStart && ink.length === 0) {
        lead += measure(candidate);
        continue;
      }
      if (lineStart && ink.length > 0) {
        segment += lead;
        lineStart = false;
        lead = 0;
      }
      if (ink.length === candidate.length) segment += measure(candidate);
      else if (ink.length > 0) segment += measure(candidate) - measure(candidate.slice(ink.length));
      // A space or a dash ends the segment, including a dash that ends its run; a plain run
      // seam does not.
      if (
        ink.length < candidate.length ||
        to < piece.text.length ||
        ENDS_WITH_BREAKING_SPACE.test(candidate)
      )
        close();
      else dashPending = BREAK_AFTER_DASH.has(candidate.at(-1)!);
    }
  }
  close();
  endLine();
  // An empty paragraph still keeps its first line's indents (a list item's marker slot).
  const min = widest > 0 ? widest : Math.max(0, left + right + firstShift);
  const widths = { min, max: Math.max(min, longest) };
  if (key) byParagraph.set(paragraph, { key, widths, scope });
  return widths;
}

/** The width a nested table needs from the column that holds it. */
function nestedTableMinimumPt(
  table: OoxmlElement,
  context: TableAutofitContext,
  view: AutofitView
): number {
  const depth = (view.depth ?? 0) + 1;
  const nested = view.readNested(table, depth);
  // Past the nesting limit layout paints nothing, so nothing needs room.
  if (!nested) return 0;
  // A fixed table counts the words it holds, not its stated width, so the column narrows to
  // its content and the table with it, though a cell of vertical text keeps its width.
  const nestedView = { ...view, depth };
  let minimums = spacingGapsPt(nested);
  if (nested.layoutFixed) {
    for (const minimum of fixedTableCellMinimums(nested, context, nestedView)) minimums += minimum;
    return minimums + leadingIndentPt(nested);
  }
  // An autofit table paints at its resolved width in the narrowest cell: a stated absolute
  // width keeps it, a cell-relative width shrinks with the cell, and the resolver decides both.
  let width = 0;
  for (const column of nested.columnWidthsPt) width += column;
  const ifWidened: number[] = [];
  const content = emptyColumnContent();
  autofitColumnMinimumsPt(nested, context, nestedView, ifWidened, content);
  // A spanning cell of the nested table asks the outer column for its room too.
  const held = spanAdjustedMinimums(
    spacedCellWidths(nested),
    ifWidened,
    content.maximums,
    content.spans
  );
  // Every column keeps a hairline, as the widths it settles at do.
  for (const minimum of held) minimums += Math.max(minimum, MIN_COLUMN_PT);
  return Math.max(width, minimums) + leadingIndentPt(nested);
}

function emptyColumnContent(): AutofitColumnContent {
  return {
    maximums: [],
    sizedByContent: [],
    preferredWidths: [],
    spans: [],
    measured: [],
    verticalHolds: [],
  };
}

/**
 * A fixed table's cell minimums when it must narrow inside a cell: the content each column
 * holds, raised for its spanning cells. A column only spanning cells cover asks for nothing
 * of its own, since the table gives up its stated widths.
 */
function fixedTableCellMinimums(
  structure: SemanticTableStructure,
  context: TableAutofitContext,
  view: AutofitView
): readonly number[] {
  const ifWidened: number[] = [];
  const content = emptyColumnContent();
  autofitColumnMinimumsPt(structure, context, view, ifWidened, content);
  // A column with no horizontal text of its own asks for no more than a hairline, while a cell
  // of vertical text keeps the width it has: one column's minimum, or a span's requirement.
  const own = ifWidened.map((minimum, column) =>
    Math.max(content.measured[column] ? minimum : 0, MIN_COLUMN_PT)
  );
  const spans = [...content.spans];
  for (const hold of content.verticalHolds) {
    if (hold.count > 1) spans.push(hold);
    else own[hold.from] = Math.max(own[hold.from]!, hold.minimum);
  }
  return spanAdjustedMinimums(own, own, own, spans);
}

/**
 * A nested fixed table's columns once they give way to fit the cell's room: each down to its
 * own content, measured as cells with any spacing gaps outside them.
 */
function fixedNestedWidths(
  structure: SemanticTableStructure,
  roomPt: number,
  minimumsOf: () => readonly number[]
): readonly number[] {
  const columns = structure.columnWidthsPt;
  let total = 0;
  for (const width of columns) total += width;
  if (!(roomPt > 0) || total <= roomPt + WIDTH_EPSILON_PT) return columns;
  const minimums = minimumsOf();
  const gaps = spacingGapsPt(structure);
  const room = Math.max(0, roomPt - gaps);
  // No column is sized by content here: every one gives way from its stated width.
  const sizedByContent = columns.map(() => false);
  const cells = contentSizedWidths(
    spacedCellWidths(structure),
    sizedByContent,
    minimums,
    minimums,
    room,
    room,
    room
  );
  return gaps > 0 ? columnsAroundCells(cells, gaps) : cells;
}

/** How often a table settles again for spans its settled columns no longer hold. */
const MAX_SPAN_ROUNDS = 3;

/** The table indent, which moves only a table aligned to its leading edge. */
function leadingIndentPt(structure: SemanticTableStructure): number {
  const leading = structure.bidiVisual ? 'right' : 'left';
  // A negative indent moves a top-level table into the margin, which adds room. A floating
  // table is placed by its own position, so its indent moves nothing.
  if (structure.float) return 0;
  return structure.alignment === leading ? structure.indentPt : 0;
}

/** The narrowest cell a nested table can be given. */
const NARROW_CELL_PT = 1;

type StructureReader = (
  table: OoxmlElement,
  contentWidthPt: number,
  depth: number,
  styleCascade?: StyleCascadeTable,
  displayMode?: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter,
  compatibilityMode?: number
) => SemanticTableStructure | null;

/** One narrow read per nested node and view, apart from the cell-width read layout memoizes. */
const narrowReads = new WeakMap<
  object,
  {
    readonly key: string;
    readonly styleCascade: StyleCascadeTable | undefined;
    readonly structure: SemanticTableStructure | null;
  }
>();

/**
 * A nested-table reader for {@link AutofitView.readNested}: the nested structure in the
 * narrowest cell, memoized per node apart from the cell-width structure layout reads. Its
 * first read also refills the reader's own per-node slot once; later reads come from here.
 */
export function narrowNestedReader(
  read: StructureReader,
  styleCascade: StyleCascadeTable | undefined,
  displayMode: RevisionDisplayMode,
  authorFilter: RevisionAuthorFilter | undefined,
  compatibilityMode: number | undefined
): (table: OoxmlElement, depth: number) => SemanticTableStructure | null {
  return (table, depth) => {
    const key = `${depth}|${displayMode}|${authorFilter?.cacheKey ?? ''}|${compatibilityMode ?? ''}`;
    const memo = narrowReads.get(table);
    if (memo && memo.key === key && memo.styleCascade === styleCascade) return memo.structure;
    const structure = read(
      table,
      NARROW_CELL_PT,
      depth,
      styleCascade,
      displayMode,
      authorFilter,
      compatibilityMode
    );
    narrowReads.set(table, { key, styleCascade, structure });
    return structure;
  };
}

/**
 * Each physical column's autofit minimum, as a cell width: its widest single-column cell
 * content plus that cell's horizontal content insets, so an empty cell keeps them. A cell that
 * continues a vertical merge or sets its text vertically sets no minimum; a cell that spans
 * columns reports its own requirement in `content` instead.
 */
export function autofitColumnMinimumsPt(
  structure: SemanticTableStructure,
  context: TableAutofitContext,
  view: AutofitView,
  /** Filled with each column's minimum should it have to widen (see widenedCellInsets). */
  ifWidened?: number[],
  /** Filled with what the cells say beyond their minimums (see {@link AutofitColumnContent}). */
  content?: AutofitColumnContent
): number[] {
  const columnCount = structure.columnWidthsPt.length;
  // -1 marks a column no single-column cell measured; a measured empty column may be 0.
  const minimums = new Array<number>(columnCount).fill(-1);
  const wide = new Array<number>(columnCount).fill(-1);
  const widest = new Array<number>(columnCount).fill(-1);
  const preferred = new Array<boolean>(columnCount).fill(false);
  const collapsed = structure.cellSpacingPt === 0;
  // Measured as cell widths: a spaced table's gaps sit between its cells, outside them.
  const gapPt = cellSpacingGapPt(structure.cellSpacingPt);
  const cellWidths = spacedCellWidths(structure);
  for (const row of structure.rows) {
    const widenedRow =
      structure.outerRuleOffsetPt !== undefined && !structure.legacyContentAlignment
        ? rowForWidenedMeasurement(row, columnCount, content !== undefined)
        : undefined;
    for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex += 1) {
      const cell = row.cells[cellIndex]!;
      if (cell.vMergeContinue) continue;
      if (cell.gridColumn < 0 || cell.gridColumn >= columnCount) continue;
      if (cell.gridSpan === 1 && cell.preferredWidth.value > 0) {
        const stated = cell.preferredWidth;
        if (stated.type === 'dxa' || stated.type === 'pct') preferred[cell.gridColumn] = true;
        if (content && stated.type === 'dxa') {
          const points = stated.value;
          const known = content.preferredWidths[cell.gridColumn];
          if (known === undefined || points > known)
            content.preferredWidths[cell.gridColumn] = points;
        }
      }
      if (cell.textDirection !== 'horizontal') {
        // Vertical text runs along the row, not across the column: it sets no autofit minimum.
        // It does record the width it has, which a table giving up its stated widths keeps.
        const end = Math.min(cell.gridColumn + cell.gridSpan, columnCount);
        let held = 0;
        for (let column = cell.gridColumn; column < end; column++) held += cellWidths[column]!;
        const count = end - cell.gridColumn;
        content?.verticalHolds.push({ from: cell.gridColumn, count, minimum: held });
        continue;
      }
      if (cell.gridSpan !== 1 && !content) continue;
      const measured = cachedAutofitCellWidths(cell, collapsed, context, view, () => {
        let least = -1;
        let most = -1;
        const insets = cellContentInsets(cell, collapsed);
        for (const block of cell.blocks) {
          if (block.kind === 'table') {
            const nested = nestedTableMinimumPt(block, context, view);
            least = Math.max(least, nested);
            most = Math.max(most, nested);
          }
          if (block.kind !== 'paragraph') continue;
          const widths = paragraphContentWidthsPt(block, {
            context,
            view,
            tableCellStyle: cell.styleFormatting,
          });
          least = Math.max(least, widths.min);
          most = Math.max(most, widths.max);
        }
        const widened = widenedCellInsets(cell, collapsed, insets, widenedRow?.cells[cellIndex]);
        return {
          least,
          most,
          left: insets.left,
          right: insets.right,
          wideLeft: widened.left,
          wideRight: widened.right,
        };
      });
      const { least, most } = measured;
      if (least < 0) continue;
      const around = measured.wideLeft + measured.wideRight;
      if (cell.gridSpan !== 1) {
        // A spanning cell also covers the gaps between the columns it spans.
        const covered = (cell.gridSpan - 1) * gapPt;
        content?.spans.push({
          from: cell.gridColumn,
          count: cell.gridSpan,
          minimum: Math.max(0, least + around - covered),
          current: Math.max(0, least + measured.left + measured.right - covered),
        });
        continue;
      }
      const needed = least + measured.left + measured.right;
      if (needed > minimums[cell.gridColumn]!) minimums[cell.gridColumn] = needed;
      if (least + around > wide[cell.gridColumn]!) wide[cell.gridColumn] = least + around;
      if (most + around > widest[cell.gridColumn]!) widest[cell.gridColumn] = most + around;
    }
  }
  // A column only spanning cells cover has no minimum of its own; it keeps its width.
  for (const [column, minimum] of minimums.entries()) {
    if (content) content.measured[column] = minimum >= 0;
    if (minimum < 0) minimums[column] = cellWidths[column]!;
    if (ifWidened) ifWidened[column] = wide[column]! < 0 ? minimums[column]! : wide[column]!;
    if (content) {
      content.maximums[column] = widest[column]! < 0 ? minimums[column]! : widest[column]!;
      // A column with no measured cell of its own keeps its width, as a preferred one does.
      content.sizedByContent[column] = !preferred[column] && widest[column]! >= 0;
    }
  }
  return minimums;
}

/** What a table's cells say about its columns beyond their minimums. */
export interface AutofitColumnContent {
  /** Each column's widest unwrapped content, with the insets of the widened geometry. */
  readonly maximums: number[];
  /** Columns no single-column cell gives a preferred width: sized by their content. */
  readonly sizedByContent: boolean[];
  /** The widest absolute preferred width a single-column cell states, where one does. */
  readonly preferredWidths: (number | undefined)[];
  /** Columns a single-column cell of horizontal text measured. */
  readonly measured: boolean[];
  /** The width each cell of vertical text has across the columns it covers. */
  readonly verticalHolds: SpanRequirement[];
  /** What each cell spanning several columns needs across them. */
  readonly spans: SpanRequirement[];
}

/**
 * Widen autofit columns that are narrower than their minimum.
 *
 * A column below its minimum grows to it, and the table settles at `targetPt`: its own width
 * for an absolute `w:tblW`, the room it has in the text column for an automatic width, its
 * share of that room for a percentage. A table already narrower than an automatic target
 * grows only as far as its content needs. The other columns give the difference in
 * proportion to how far each one sits above its own minimum. When they reach their minimums,
 * the table grows past its target; when the minimums together are wider than `availablePt`,
 * every column is its minimum scaled down by the same factor. Widths that already hold their
 * content come back unchanged, by identity.
 */
export function widenAutofitColumns(
  widths: readonly number[],
  minimums: readonly number[],
  targetPt: number,
  availablePt: number
): readonly number[] {
  let deficit = 0;
  for (const [index, width] of widths.entries()) {
    deficit += Math.max(0, minimums[index]! - width);
  }
  if (deficit <= WIDTH_EPSILON_PT) return widths;
  const grown = widths.map((width, index) => Math.max(width, minimums[index]!));
  const need = grown.reduce((sum, width) => sum + width, 0) - targetPt;
  if (need <= WIDTH_EPSILON_PT) return grown;
  // No column gives up its last hairline.
  const slack = widths.map((width, index) =>
    Math.max(0, width - Math.max(minimums[index]!, MIN_COLUMN_PT))
  );
  const totalSlack = slack.reduce((sum, value) => sum + value, 0);
  if (need <= totalSlack) {
    return grown.map((width, index) => width - (need * slack[index]!) / totalSlack);
  }
  // Every column keeps a hairline: a zero-width column would give its cell no box at all.
  const floor = minimums.map((minimum) => Math.max(minimum, MIN_COLUMN_PT));
  const needed = floor.reduce((sum, value) => sum + value, 0);
  // Never narrower than the table already was: an indent can leave the text column no room.
  const room = Math.max(
    availablePt,
    widths.reduce((sum, width) => sum + width, 0)
  );
  if (!Number.isFinite(room) || needed <= room) return floor;
  // Scale only what each column holds above its hairline, so every hairline survives whole.
  const hairlines = floor.length * MIN_COLUMN_PT;
  const scale = Math.max(0, room - hairlines) / Math.max(needed - hairlines, WIDTH_EPSILON_PT);
  return floor.map((width) => MIN_COLUMN_PT + (width - MIN_COLUMN_PT) * scale);
}

/** The total an autofit table settles at once a column has to widen, in points. */
export function autofitTargetPt(
  tableWidth: PreferredWidth,
  totalPt: number,
  availablePt: number,
  legacyContentAlignment = false,
  /** What a percentage is a share of: the text column, as the width resolver reads it. */
  percentBasisPt = availablePt
): number {
  // A legacy content-aligned table already spans the text column plus its outer margins.
  if (legacyContentAlignment) return totalPt;
  if (tableWidth.type === 'dxa' && tableWidth.value > 0) return totalPt;
  if (tableWidth.type === 'pct' && tableWidth.value > 0)
    // Never below the resolved total, so a column widening by a little never narrows the table.
    return Math.max(totalPt, Math.min(availablePt, (percentBasisPt * tableWidth.value) / 100));
  return availablePt;
}

/**
 * Widths per context and structure. A context belongs to one pass of one flow, during which
 * no token can change, so the memo is exact; it dies with the pass.
 */
const passWidths = new WeakMap<
  object,
  WeakMap<
    SemanticTableStructure,
    { readonly contentWidthPt: number; readonly widths: readonly number[] }
  >
>();

/**
 * A structure's physical column widths after autofit widening, or the structure's own array
 * by identity when every column already holds its content.
 */
export function autofitColumnWidthsPt(
  structure: SemanticTableStructure,
  contentWidthPt: number,
  context: TableAutofitContext,
  view: AutofitView
): readonly number[] {
  const owner = autofitReuseScope(context) ?? context;
  let byStructure = passWidths.get(owner);
  if (!byStructure) passWidths.set(owner, (byStructure = new WeakMap()));
  const known = byStructure.get(structure);
  if (known && known.contentWidthPt === contentWidthPt) return known.widths;
  if (structure.layoutFixed) {
    // A nested fixed table paints no wider than the cell that holds it, after its indent: its
    // columns give way down to their own minimums. A top-level fixed table never reaches here.
    // A percentage above 100 extends it past the cell instead.
    const { tableWidth } = structure;
    const overflow =
      tableWidth.type === 'pct' && tableWidth.value > 100
        ? (contentWidthPt * tableWidth.value) / 100
        : 0;
    const room = Math.max(0, contentWidthPt - Math.max(0, leadingIndentPt(structure)), overflow);
    const widths = fixedNestedWidths(structure, room, () =>
      fixedTableCellMinimums(structure, context, view)
    );
    byStructure.set(structure, { contentWidthPt, widths });
    return widths;
  }
  // Whether the table widens is decided in its current geometry. Widening rebuilds every
  // cell, which can change every cell's insets, so once it widens every column is sized for
  // the geometry widening can bring.
  const ifWidened: number[] = [];
  const content = emptyColumnContent();
  const minimumsNow = autofitColumnMinimumsPt(structure, context, view, ifWidened, content);
  // Everything below works on cell widths; a spaced table's gaps come back at the end.
  const cellWidths = spacedCellWidths(structure);
  const scale = cellSpacingScale(structure.columnWidthsPt, structure.cellSpacingPt);
  const gaps = spacingGapsPt(structure);
  // A column a cell gives a preferred width starts from that width, not from the grid.
  const preferredWidths = cellWidths.map((width, column) =>
    content.preferredWidths[column] === undefined ? width : content.preferredWidths[column]! * scale
  );
  // Whether the table widens is decided with the insets it has now, spans included.
  // Spans are held against the widths the table paints at now, not the ones its cells ask.
  const current = spanAdjustedMinimums(
    cellWidths,
    minimumsNow,
    content.maximums,
    content.spans.map((span) => ({ ...span, minimum: span.current ?? span.minimum }))
  );
  const sizedByContent = content.sizedByContent.some(Boolean);
  const widens = current.some(
    (minimum, column) => minimum > cellWidths[column]! + WIDTH_EPSILON_PT
  );
  // Widening may end shared grid lines, but not legacy content alignment, whose minimums hold.
  const spread = sizedByContent
    ? undefined
    : preferredSpreadWidths(
        structure,
        content,
        widens && !structure.legacyContentAlignment ? ifWidened : minimumsNow,
        contentWidthPt,
        view.depth ?? 0
      );
  if (spread || (!widens && !sizedByContent)) {
    const widths = spread ? sameOrComputed(structure, spread) : structure.columnWidthsPt;
    byStructure.set(structure, { contentWidthPt, widths });
    return widths;
  }
  let minimums = spanAdjustedMinimums(preferredWidths, ifWidened, content.maximums, content.spans);
  // The table indent moves a leading-aligned table into the text column's room; a legacy
  // content-aligned table owns the room its own width already spans.
  const totalPt = structure.columnWidthsPt.reduce((sum, width) => sum + width, 0);
  const legacy = structure.legacyContentAlignment === true;
  const availablePt = legacy
    ? Math.max(totalPt, contentWidthPt)
    : Math.max(0, contentWidthPt - leadingIndentPt(structure));
  const targetPt =
    autofitTargetPt(structure.tableWidth, totalPt, availablePt, legacy, contentWidthPt) - gaps;
  const roomPt = Math.max(0, availablePt - gaps);
  const ownWidth = structure.tableWidth.value > 0 && structure.tableWidth.type !== 'auto';
  const settle = (): readonly number[] =>
    sizedByContent
      ? contentSizedWidths(
          preferredWidths,
          content.sizedByContent,
          minimums,
          content.maximums,
          // A table with no width of its own takes what its content asks, up to its room.
          ownWidth ? targetPt : undefined,
          roomPt,
          cellWidths.reduce((sum, width) => sum + width, 0)
        )
      : widenAutofitColumns(cellWidths, minimums, targetPt, roomPt);
  let cells = settle();
  // A span the preferred widths held may lose its room as columns settle: hold it against
  // the settled widths and settle again.
  for (let round = 0; round < MAX_SPAN_ROUNDS; round++) {
    const short = content.spans.filter((span) => {
      let held = 0;
      for (let column = span.from; column < span.from + span.count; column++)
        held += cells[column] ?? 0;
      return held < span.minimum - WIDTH_EPSILON_PT;
    });
    if (short.length === 0) break;
    const raised = spanAdjustedMinimums(cells, minimums, content.maximums, short);
    // Overflowing tables scale every column below its minimum; raising cannot help there.
    if (raised.every((minimum, column) => minimum === minimums[column])) break;
    minimums = raised;
    cells = settle();
  }
  const widths = sameOrComputed(structure, gaps > 0 ? columnsAroundCells(cells, gaps) : cells);
  byStructure.set(structure, { contentWidthPt, widths });
  return widths;
}

/** Widths that match the resolved ones come back by identity, so the shared base stays. */
function sameOrComputed(
  structure: SemanticTableStructure,
  computed: readonly number[]
): readonly number[] {
  return computed.every(
    (width, column) => Math.abs(width - structure.columnWidthsPt[column]!) <= WIDTH_EPSILON_PT
  )
    ? structure.columnWidthsPt
    : computed;
}
