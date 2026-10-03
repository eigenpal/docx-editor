// Autofit column minimums: a column is never narrower than the widest unbreakable segment
// its cells hold.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { PAGE_BREAK_CHAR } from '../store/package/hard-break.ts';
import { BREAK_AFTER_DASH, wordBoundaries } from './cjk-line-break.ts';
import { measureInlineDrawing, type InlineDrawingLayoutContext } from './drawing-layout.ts';
import { createEquationLayouter } from './equation-layout.ts';
import type { DocumentProperties } from '@docx-editor.dev/core/store';
import type { FieldCodeRanges } from './field-code-toc.ts';
import type { BodyPageFieldContext } from './field-page-furniture.ts';
import type { FieldPageContext } from './field-projection.ts';
import type { RefFieldContext } from './field-ref.ts';
import type { NoteMarkContext } from './note-projection.ts';
import { piecesOfParagraphForDisplay } from './field-projection-display.ts';
import type { ResolvedListItem } from './list-resolve.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';
import { displayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { TextMeasurer } from './semantic-records.ts';
import type { SemanticTableCell, SemanticTableStructure } from './semantic-table.ts';
import {
  cascadeRunProperties,
  resolveParagraphLayoutInputs,
  type StyleCascadeTable,
} from './style-cascade.ts';
import { cellContentInsets } from './table-cell-geometry.ts';
import { gridColumnElements, gridColumnWidthsPt, type PreferredWidth } from './table-widths.ts';
import { withoutTrailingSpaces } from './trailing-spaces.ts';

/**
 * What autofit needs from layout: its measurer, and the list items that indent paragraphs.
 * @public
 */
export interface TableAutofitContext {
  readonly measurer: TextMeasurer;
  readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
  /** Resolves inline pictures, so a picture column keeps the width the picture paints at. */
  readonly inlineDrawingLayout?: InlineDrawingLayoutContext;
  /** The text layout gives fields and note marks, so the minimum measures what paints. */
  readonly fields?: AutofitFieldContext;
}

/** What cell layout projects fields and note marks with; compared field by field. */
export interface AutofitFieldContext {
  readonly pageContext?: FieldPageContext;
  readonly noteMarks?: NoteMarkContext;
  readonly documentProperties?: DocumentProperties;
  readonly bodyPageFields?: BodyPageFieldContext | false;
  readonly refFields?: RefFieldContext;
  readonly showFieldCodes?: boolean;
  readonly fieldCodeRanges?: FieldCodeRanges;
}

const FIELD_KEYS = [
  'pageContext',
  'noteMarks',
  'documentProperties',
  'bodyPageFields',
  'refFields',
  'showFieldCodes',
  'fieldCodeRanges',
] as const;

function sameFields(a: AutofitFieldContext | undefined, b: AutofitFieldContext | undefined) {
  return FIELD_KEYS.every((key) => a?.[key] === b?.[key]);
}

/** The autofit inputs a table flow already carries, so every reader widens alike. */
export function autofitContextOf(
  deps: {
    readonly measurer: TextMeasurer;
    readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
    readonly inlineDrawingLayout?: InlineDrawingLayoutContext;
  } & AutofitFieldContext
): TableAutofitContext {
  const fields: AutofitFieldContext = {};
  for (const key of FIELD_KEYS)
    if (deps[key] !== undefined) (fields as Record<string, unknown>)[key] = deps[key];
  return {
    measurer: deps.measurer,
    ...(deps.listItems ? { listItems: deps.listItems } : {}),
    ...(deps.inlineDrawingLayout ? { inlineDrawingLayout: deps.inlineDrawingLayout } : {}),
    fields,
  };
}

/** The view a structure was read in: the cascade, display mode, and author filter. */
export interface AutofitView {
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly displayMode: RevisionDisplayMode;
  readonly authorFilter: RevisionAuthorFilter | undefined;
}

/**
 * The last widths per measurer and base structure. A base structure is built for one view, so
 * it stands for the view. Keyed by the measurer first, never holding it in a value, for the
 * same reason as {@link paragraphMinimums}.
 */
const widthMemos = new WeakMap<
  TextMeasurer,
  WeakMap<
    SemanticTableStructure,
    {
      readonly listItems: ReadonlyMap<string, ResolvedListItem> | undefined;
      readonly inlineDrawingLayout: InlineDrawingLayoutContext | undefined;
      readonly fields: AutofitFieldContext | undefined;
      readonly contentWidthPt: number;
      readonly widths: readonly number[];
    }
  >
>();

/** Below this a column is already as wide as its content needs. */
const WIDTH_EPSILON_PT = 0.01;
/** No column collapses below a hairline, whatever its content. */
const MIN_COLUMN_PT = 1;

interface MinimumInputs {
  readonly measurer: TextMeasurer;
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly tableCellStyle: SemanticTableCell['styleFormatting'] | undefined;
  readonly displayMode: RevisionDisplayMode;
  readonly authorFilter: RevisionAuthorFilter | undefined;
  readonly listItem: ResolvedListItem | undefined;
  readonly inlineDrawingLayout: InlineDrawingLayoutContext | undefined;
  readonly fields: AutofitFieldContext | undefined;
}

/**
 * The last minimum per measurer and paragraph node, so an edit re-measures only the paragraphs
 * it changed. Keyed by the measurer first and never holding it in a value: a disposed export
 * measurer, and the shaping caches it owns, must not live on through the document's nodes.
 */
const paragraphMinimums = new WeakMap<
  TextMeasurer,
  WeakMap<OoxmlElement, { readonly inputs: MinimumKey; readonly width: number }>
>();

type MinimumKey = Omit<MinimumInputs, 'measurer'>;

/**
 * A table style's cell formatting, by content. A structure read builds new formatting objects
 * for every cell, so identity would miss the cache on every edit of a styled table.
 */
const cellStyleKeys = new WeakMap<object, string>();
function cellStyleKey(style: SemanticTableCell['styleFormatting'] | undefined): string {
  if (!style) return '';
  let key = cellStyleKeys.get(style);
  if (key === undefined) {
    key = JSON.stringify([style.paragraphProperties, style.runProperties]);
    cellStyleKeys.set(style, key);
  }
  return key;
}

function sameInputs(a: MinimumKey, b: MinimumInputs): boolean {
  return (
    a.styleCascade === b.styleCascade &&
    cellStyleKey(a.tableCellStyle) === cellStyleKey(b.tableCellStyle) &&
    a.inlineDrawingLayout === b.inlineDrawingLayout &&
    sameFields(a.fields, b.fields) &&
    a.displayMode === b.displayMode &&
    a.authorFilter === b.authorFilter &&
    a.listItem === b.listItem
  );
}

/**
 * The widest segment of a paragraph that no line break may split, plus its indents.
 *
 * Break opportunities are spaces, tabs, hard breaks, and the dash rule of
 * {@link wordBoundaries}. An ideographic run counts as one segment here: an autofit column
 * widens to keep it whole, although line breaking may still wrap it inside the column. A
 * segment runs across source runs, field results, and hidden text, measured in the face each
 * piece paints. A positive first-line indent counts against the first segment.
 */
export function paragraphMinimumWidthPt(paragraph: OoxmlElement, inputs: MinimumInputs): number {
  let byParagraph = paragraphMinimums.get(inputs.measurer);
  if (!byParagraph) paragraphMinimums.set(inputs.measurer, (byParagraph = new WeakMap()));
  const cached = byParagraph.get(paragraph);
  if (cached && sameInputs(cached.inputs, inputs)) return cached.width;
  const { measurer, styleCascade, displayMode } = inputs;
  const layoutInputs = resolveParagraphLayoutInputs(
    paragraph,
    Number.MAX_SAFE_INTEGER,
    styleCascade,
    inputs.listItem,
    inputs.tableCellStyle,
    true
  );
  const fields = inputs.fields;
  const pieces = piecesOfParagraphForDisplay(
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
    inputs.inlineDrawingLayout,
    styleCascade?.themeFonts,
    undefined,
    fields?.documentProperties,
    fields?.bodyPageFields ?? false,
    fields?.refFields,
    inputs.authorFilter,
    fields?.showFieldCodes,
    fields?.fieldCodeRanges?.get(paragraph.id)
  );
  const { left, right, firstLine } = layoutInputs.indent;
  let widest = 0;
  let segment = 0;
  let first = true;
  const close = (): void => {
    if (segment > 0) {
      const width = segment + (first ? Math.max(0, firstLine) : 0);
      if (width > widest) widest = width;
      first = false;
    }
    segment = 0;
  };
  let layoutEquation: ReturnType<typeof createEquationLayouter> | undefined;
  // A dash that ends a run breaks only if the next run does not open with another dash.
  let dashPending = false;
  for (const piece of pieces) {
    if (piece.style.hidden) continue;
    if (dashPending && !BREAK_AFTER_DASH.has(piece.text[0] ?? '')) close();
    dashPending = false;
    if (piece.text === '\n' || piece.text === PAGE_BREAK_CHAR) {
      // A break ends the first line, and with it the first-line indent.
      close();
      first = false;
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
      close();
      segment = atomWidth;
      close();
      continue;
    }
    const style = styleForFontSlot(piece.style, piece.fontSlot);
    const measure = (text: string): number => measurer.measure(displayText(text, style), style);
    if (piece.measureText !== undefined) {
      segment += measure(piece.measureText);
      continue;
    }
    let from = 0;
    for (const to of wordBoundaries(piece.text, false)) {
      const candidate = piece.text.slice(from, to);
      from = to;
      if (candidate.length === 0) continue;
      if (candidate === '\t') {
        // A tab uses up the first-line indent, whatever follows it.
        close();
        first = false;
        continue;
      }
      // Measured as line breaking measures it, so the advance comes from the same cache;
      // the trailing spaces it hangs are priced on their own.
      const ink = withoutTrailingSpaces(candidate);
      if (ink.length === candidate.length) segment += measure(candidate);
      else if (ink.length > 0) segment += measure(candidate) - measure(candidate.slice(ink.length));
      // A space or a dash ends the segment, including a dash that ends its run; a plain run
      // seam does not.
      if (ink.length < candidate.length || to < piece.text.length) close();
      else dashPending = BREAK_AFTER_DASH.has(candidate.at(-1)!);
    }
  }
  close();
  const width = widest + Math.max(0, left) + Math.max(0, right);
  const { styleCascade: cascade, tableCellStyle, listItem, authorFilter } = inputs;
  byParagraph.set(paragraph, {
    inputs: {
      styleCascade: cascade,
      tableCellStyle,
      displayMode,
      authorFilter,
      listItem,
      inlineDrawingLayout: inputs.inlineDrawingLayout,
      fields: inputs.fields,
    },
    width,
  });
  return width;
}

/** A nested table needs at least the width its own grid states. */
function nestedTableMinimumPt(table: OoxmlElement): number {
  let width = 0;
  for (const column of gridColumnWidthsPt(gridColumnElements(table))) width += column ?? 0;
  return width;
}

/**
 * Each physical column's autofit minimum: its widest single-column cell content plus that
 * cell's horizontal content insets and cell spacing, so an empty cell keeps them. A cell that
 * spans columns, continues a vertical merge, or sets its text vertically sets no minimum.
 */
export function autofitColumnMinimumsPt(
  structure: SemanticTableStructure,
  context: TableAutofitContext,
  view: AutofitView
): number[] {
  const { styleCascade, displayMode, authorFilter } = view;
  const columnCount = structure.columnWidthsPt.length;
  const minimums = new Array<number>(columnCount).fill(0);
  const collapsed = structure.cellSpacingPt === 0;
  for (const row of structure.rows) {
    for (const cell of row.cells) {
      // Vertical text runs along the row, not across the column.
      if (cell.gridSpan !== 1 || cell.vMergeContinue || cell.textDirection !== 'horizontal')
        continue;
      if (cell.gridColumn < 0 || cell.gridColumn >= columnCount) continue;
      let content = -1;
      for (const block of cell.blocks) {
        if (block.kind === 'table') content = Math.max(content, nestedTableMinimumPt(block));
        if (block.kind !== 'paragraph') continue;
        const width = paragraphMinimumWidthPt(block, {
          measurer: context.measurer,
          styleCascade,
          tableCellStyle: cell.styleFormatting,
          displayMode,
          authorFilter,
          listItem: context.listItems?.get(block.id),
          inlineDrawingLayout: context.inlineDrawingLayout,
          fields: context.fields,
        });
        content = Math.max(content, width);
      }
      if (content < 0) continue;
      const insets = cellContentInsets(cell, collapsed);
      const needed = content + insets.left + insets.right + structure.cellSpacingPt;
      if (needed > minimums[cell.gridColumn]!) minimums[cell.gridColumn] = needed;
    }
  }
  // A column only spanning cells cover has no minimum of its own; it keeps its width.
  for (const [column, minimum] of minimums.entries())
    if (minimum === 0) minimums[column] = structure.columnWidthsPt[column]!;
  return minimums;
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
  const slack = widths.map((width, index) =>
    minimums[index]! > width ? 0 : width - minimums[index]!
  );
  const totalSlack = slack.reduce((sum, value) => sum + value, 0);
  if (need <= totalSlack) {
    return grown.map((width, index) => width - (need * slack[index]!) / totalSlack);
  }
  const floor = minimums.map((minimum) => Math.max(minimum, MIN_COLUMN_PT));
  const needed = floor.reduce((sum, value) => sum + value, 0);
  // Never narrower than the table already was: an indent can leave the text column no room.
  const room = Math.max(
    availablePt,
    widths.reduce((sum, width) => sum + width, 0)
  );
  if (!Number.isFinite(room) || needed <= room) return floor;
  const scale = room / needed;
  return floor.map((width) => width * scale);
}

/** The total an autofit table settles at once a column has to widen, in points. */
export function autofitTargetPt(
  tableWidth: PreferredWidth,
  totalPt: number,
  availablePt: number
): number {
  if (tableWidth.type === 'dxa' && tableWidth.value > 0) return totalPt;
  if (tableWidth.type === 'pct' && tableWidth.value > 0)
    return (availablePt * tableWidth.value) / 100;
  return availablePt;
}

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
  let byStructure = widthMemos.get(context.measurer);
  if (!byStructure) widthMemos.set(context.measurer, (byStructure = new WeakMap()));
  const memo = byStructure.get(structure);
  if (
    memo &&
    memo.listItems === context.listItems &&
    memo.inlineDrawingLayout === context.inlineDrawingLayout &&
    sameFields(memo.fields, context.fields) &&
    memo.contentWidthPt === contentWidthPt
  )
    return memo.widths;
  const minimums = autofitColumnMinimumsPt(structure, context, view);
  // The table indent moves a leading-aligned table into the text column's room.
  const leading = structure.bidiVisual ? 'right' : 'left';
  const indent = structure.alignment === leading ? Math.max(0, structure.indentPt) : 0;
  const availablePt = Math.max(0, contentWidthPt - indent);
  const widths = widenAutofitColumns(
    structure.columnWidthsPt,
    minimums,
    autofitTargetPt(
      structure.tableWidth,
      structure.columnWidthsPt.reduce((sum, width) => sum + width, 0),
      availablePt
    ),
    availablePt
  );
  byStructure.set(structure, {
    listItems: context.listItems,
    inlineDrawingLayout: context.inlineDrawingLayout,
    fields: context.fields,
    contentWidthPt,
    widths,
  });
  return widths;
}
