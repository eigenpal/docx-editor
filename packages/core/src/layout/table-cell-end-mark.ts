import type { SemanticTableCell } from './semantic-table.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';
import { cellParagraphInputs } from './cell-paragraph-inputs.ts';
import {
  cascadeParagraphFormatting,
  type ParagraphLayoutInputs,
  type StyleCascadeTable,
} from './style-cascade.ts';
import { lineBoxStyleOf } from './paragraph-mark-metrics.ts';
import { markRunPropertiesWithoutCharacterStyle } from './paragraph-mark-run.ts';
import { DEFAULT_RUN_STYLE, resolveRunStyle } from './run-style.ts';
import { measuresWithAdmittedFace } from './text-measurer.ts';
import { applyLineSpacing, type ParagraphSpacing } from './paragraph-style.ts';
import { hasShownRunContent } from './cell-end-paragraph-content.ts';
import { cellHidesEndMark } from './table-cell-terminator.ts';

const markStyles = new WeakMap<
  ParagraphLayoutInputs['markRunProperties'],
  {
    readonly theme: StyleCascadeTable['themeFonts'] | undefined;
    readonly style: ReturnType<typeof resolveRunStyle>;
  }
>();

function endMarkStyle(inputs: ParagraphLayoutInputs, deps: TableFlowDeps) {
  const mark = markRunPropertiesWithoutCharacterStyle(inputs.markRunProperties);
  if (mark.length === 0) return DEFAULT_RUN_STYLE;
  const theme = deps.styleCascade?.themeFonts;
  const known = markStyles.get(mark);
  if (known && known.theme === theme) return known.style;
  // A superscript or subscript mark keeps the line of its full size (ECMA-376 17.3.2.42).
  const style = lineBoxStyleOf(resolveRunStyle(mark, theme));
  markStyles.set(mark, { theme, style });
  return style;
}

/** The end-of-cell paragraph's own line box and the gaps it asks for around it. */
interface EndMarkBox {
  readonly linePt: number;
  readonly spacing: ParagraphSpacing;
}

/**
 * The line the end-of-cell glyph occupies, with the paragraph spacing that frames it.
 *
 * `null` when the mark contributes nothing: `w:hideMark` excludes it from row height by
 * definition (17.4.21), a `w:vanish` mark is not measured, and a face that did not resolve
 * cannot be measured at all.
 */
function endMarkBox(
  cell: SemanticTableCell,
  width: number,
  deps: TableFlowDeps
): EndMarkBox | null {
  if (cellHidesEndMark(cell, deps.documentFirstParagraphId)) return null;
  const paragraph = cell.blocks.at(-1);
  if (paragraph?.kind !== 'paragraph') return null;
  const inputs = cellParagraphInputs(
    paragraph,
    width,
    deps.styleCascade,
    deps.listItems?.get(paragraph.id),
    cell.styleFormatting,
    deps.paragraphLineUnitPt
  );
  // The floor also stands under a cell with content, so it reads the mark WITHOUT its
  // character style (`paragraph-mark-run.ts`). An empty end paragraph's own line has it.
  const style = endMarkStyle(inputs, deps);
  if (style.hidden || measuresWithAdmittedFace(deps.measurer, style) === false) return null;
  const metrics = deps.measurer.lineMetrics(style);
  return {
    linePt: applyLineSpacing(inputs.lineSpacing, metrics.height, metrics.baseline).height,
    spacing: inputs.spacing,
  };
}

/**
 * The row minimum an ordinary cell's end-of-cell mark sets: its line, but only when the end
 * paragraph holds nothing else. Under text the mark sets no minimum. Measured with a 20pt
 * mark under 5pt text and a 10pt mark under 1pt text, in left-to-right and right-to-left
 * paragraphs, in compatibility modes 14 and 15 and with no mode: each row was as tall as its
 * text line. An empty end paragraph takes the mark's line, 24pt for the 20pt mark, and so
 * does one that holds only hidden or deleted runs.
 */
export function cellEndMarkHeight(
  cell: SemanticTableCell,
  width: number,
  deps: TableFlowDeps
): number {
  const paragraph = cell.blocks.at(-1);
  if (paragraph?.kind === 'paragraph' && hasShownRunContent(paragraph, deps.styleCascade)) return 0;
  return endMarkBox(cell, width, deps)?.linePt ?? 0;
}

/**
 * The end-of-cell paragraph box of a `w:vMerge` continuation cell, which a row asks for when
 * NOTHING ELSE can size it.
 *
 * A continuation cell is excluded from its row's height, the same way it is excluded from
 * painting: `vmerge-continuation-control.docx` t8 puts a continuation authoring 18pt of
 * `w:after` beside a plain one-line cell, and the reference row is 15.60pt — the plain
 * cell's line, with the continuation's box contributing nothing.
 *
 * A row whose cells are ALL continuations has nothing left to size it, and the reference
 * then sizes it from the END-OF-CELL paragraph's box: spacing before, the mark's line, and
 * spacing after. Same control, same capture, row-2 content between the painted rules:
 *
 *   t1 bare `w:p` inheriting Normal `w:after="120"`   21.60 = 15.60 line + 6
 *   t2 `w:after="0"`                                  15.60 = the line alone
 *   t3 `w:before="240" w:after="360"`                 45.60 = 15.60 + 12 + 18
 *   t4 THREE paragraphs of text, `w:after="0"`        15.36 - the mark, NOT the content
 *   t5 mark at `w:sz="32"`                            22.32 = the 16pt line
 *   t7 two continuation rows                          21.36 and 21.60 - per row, not per span
 *
 * t4 is why this reads the end mark rather than flowing the cell: three paragraphs of text
 * that the cell does not paint measure the same as one empty paragraph.
 *
 * t8 cannot separate "contributes nothing" from "contributes its bare mark line", because
 * there the two are both 15.60. This takes the first reading, which is the one that leaves
 * every mixed row in the corpus where it already is.
 *
 * A row of continuations, alone or with waiting `btLr` cells, takes this box from its FIRST
 * cell, and a first cell with `w:hideMark` takes a default line instead
 * ({@link mergedRowFirstCellHeight}). A row with a cell that has no end paragraph (a head
 * that a merged-text carry emptied, or an invalid empty `w:tc`) still takes the largest box
 * of its cells (not measured). t6 gives a continuation `w:hideMark` and its row is 23.52pt,
 * which that rule does not derive; later controls varied the mark size, its spacing, and the
 * paragraph styles, and each gave the default line.
 */
export function cellContinuationHeight(
  cell: SemanticTableCell,
  width: number,
  deps: TableFlowDeps
): number {
  const box = endMarkBox(cell, width, deps);
  if (box === null) return 0;
  return Math.max(0, box.spacing.before) + box.linePt + Math.max(0, box.spacing.after);
}

/**
 * The two heights an end-of-cell paragraph can reserve, resolved together.
 *
 * `markFloor` is what an ordinary cell reserves for its own end mark. `continuation` is
 * what a row reserves when every one of its cells continues a vertical merge or holds
 * `btLr` text that waits for the row (`waitsForRowHeight`), so no other content sizes it.
 * They are mutually exclusive by construction. A `btLr` cell reserves no mark floor: its
 * text runs along the row, so only a row that nothing else sizes takes its end mark.
 *
 * A row of continuations (`onlyContinuations`), alone or with waiting `btLr` cells, takes
 * the box of its first cell, as a row of merge heads does ({@link mergedRowFirstCellHeight}):
 * measured with two and three cells of different end-paragraph boxes, in a `w:bidiVisual`
 * table, in a nested table, in a header, and with a `btLr` cell before or after a
 * continuation, the row was as tall as the first cell's box in document order. Every cell then
 * pads that box with its own margins, so the largest top and bottom margins in the row count.
 * `firstCellPt` is null for the first cell, which measures the box, and that box afterwards.
 */
export function cellReservedMarkHeights(
  cell: SemanticTableCell,
  widthPt: number,
  deps: TableFlowDeps,
  options: {
    readonly vertical: boolean;
    readonly markSizedRow: boolean;
    /** Set when the row takes its first cell's box (`mergedRowSizing`). */
    readonly onlyContinuations?: { readonly firstCellPt: number | null };
  }
): { readonly markFloor: number; readonly continuation: number } {
  if (!cell.vMergeContinue && !options.vertical)
    return { markFloor: cellEndMarkHeight(cell, widthPt, deps), continuation: 0 };
  if (!options.markSizedRow) return { markFloor: 0, continuation: 0 };
  const only = options.onlyContinuations;
  if (only !== undefined)
    return {
      markFloor: 0,
      continuation: only.firstCellPt ?? mergedRowFirstCellHeight(cell, widthPt, deps),
    };
  return { markFloor: 0, continuation: cellContinuationHeight(cell, widthPt, deps) };
}

const defaultLineStyles = new WeakMap<StyleCascadeTable, ReturnType<typeof resolveRunStyle>>();

/**
 * The run properties of a paragraph that names no style: the document defaults under the
 * default paragraph style. Resolved once per style table, which also holds the theme.
 */
function defaultParagraphRunStyle(deps: TableFlowDeps): ReturnType<typeof resolveRunStyle> {
  const table = deps.styleCascade;
  if (table === undefined) return DEFAULT_RUN_STYLE;
  const known = defaultLineStyles.get(table);
  if (known) return known;
  const properties = cascadeParagraphFormatting(table, undefined).runProperties;
  const style =
    properties.length === 0 ? DEFAULT_RUN_STYLE : resolveRunStyle(properties, table.themeFonts);
  defaultLineStyles.set(table, style);
  return style;
}

/**
 * The height a row asks of its FIRST cell when no ordinary cell sizes it
 * (`unsizedRowFloorPt`). The merged text belongs to the span, so it does not count.
 *
 * Measured with two cells of different end-paragraph boxes in either order, heads and
 * continuations mixed, and in a `w:bidiVisual` table: only the first cell in document order
 * set the row, never the larger of the two. A merge head gives its mark's line and its spacing
 * after, but not its spacing before: a one-paragraph head with 4pt before still gave the bare
 * line. A continuation gives its whole box, as {@link cellContinuationHeight} does, and so
 * does a `btLr` cell (`w:textDirection`, 17.4.72), a merge head or not: 6pt before counted.
 * A head whose first line is 12pt over an 8pt end paragraph gave the 8pt line.
 *
 * A first cell with `w:hideMark` (17.4.21), a head or a continuation, gave one line of the
 * default paragraph style's run properties over the document defaults, whatever the other
 * cells held. Its own paragraph style, mark size, and spacing did not count. A hidden or
 * unmeasurable mark takes that line too (not measured), and a default face that does not
 * resolve takes the fallback line.
 */
export function mergedRowFirstCellHeight(
  cell: SemanticTableCell,
  widthPt: number,
  deps: TableFlowDeps
): number {
  const box = endMarkBox(cell, widthPt, deps);
  if (box === null) {
    const style = defaultParagraphRunStyle(deps);
    if (style.hidden) return 0;
    // A face that did not resolve cannot be measured: take the fallback line instead.
    const measured =
      measuresWithAdmittedFace(deps.measurer, style) === false ? DEFAULT_RUN_STYLE : style;
    return deps.measurer.lineMetrics(measured).height;
  }
  const whole = cell.vMergeContinue || cell.textDirection === 'btLr';
  const before = whole ? Math.max(0, box.spacing.before) : 0;
  return before + box.linePt + Math.max(0, box.spacing.after);
}
