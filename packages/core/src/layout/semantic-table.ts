import {
  revisionCellMetadata,
  wmlRevisionChild,
  wmlRevisionAttribute,
} from './revision-cell-shading.ts';
import { readTableAlignment } from './table-alignment.ts';
import { withSharedGridLineSideRules } from './legacy-table-side-rules.ts';
import { withRowMinimumContentInsets } from './table-row-minimum-insets.ts';
// Bounded table structure over the typed canonical tree.
//
// Reads `w:tbl`/`w:tr`/`w:tc` into the bounded structure consumed by table layout. All widths
// leave in POINTS, matching `geometryOfSection` and `paragraphIndent`.
//
// Every value is attacker-controlled. Clamp before allocation, and never spread or pass an
// attacker-sized collection as varargs: either can trigger unbounded allocation or arity failure.
//
// Width reconciliation lives in `table-widths.ts`: settling one column depends on every cell
// covering it across every row, not any one node visited here.
import {
  flattenContentControls,
  type OoxmlElement,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import {
  readFlag,
  readGridSkip,
  readGridSpan,
  readRowHeight,
  readShading,
  readVMerge,
} from './table-row-properties.ts';
import { readTableFloatPosition, type TableFloatPosition } from './table-float-properties.ts';
export type {
  TableFloatAnchor,
  TableFloatPosition,
  TableFloatXSpec,
  TableFloatYSpec,
} from './table-float-properties.ts';
import {
  revisionNodeIncluded,
  revisionNodeProjectionMode,
  type RevisionAttribution,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from './revision-projection.ts';
import { mergedFlowBlocks } from './story-roots.ts';
import {
  EMPTY_TABLE_CELL_STYLE_FORMATTING,
  EMPTY_TABLE_FORMATTING,
  cascadeTableFormatting,
  tableStyleAffectsCells,
  tableCellStyleFormatting,
  type StyleCascadeTable,
  type TableCellStyleFormatting,
} from './style-cascade.ts';
import { mergeCellBorders, mergeTableBorders } from './table-border-cascade.ts';
import {
  EMPTY_CELL_BORDER_BOX,
  EMPTY_TABLE_BORDER_BOX,
  readCellBorders,
  readTableBorders,
  type CellBorderBox,
  type TableBorderBox,
} from './table-borders.ts';
import {
  AUTO_PREFERRED_WIDTH,
  MAX_TABLE_COLUMNS,
  gridColumnElements,
  preferredLengthPt,
  readPreferredWidth,
  readTableIndentPt,
  readTablePreferredWidth,
  resolveColumnWidthsPt,
  type CellWidthClaim,
  type PreferredWidth,
} from './table-widths.ts';
import {
  CELL_PAD,
  DEFAULT_CELL_MARGINS,
  MAX_CELL_MARGIN_PT,
  mergeMargins,
  readMarginSides,
  type CellMarginsPt,
} from './table-cell-margins.ts';
import { readCellTextDirection } from './table-cell-text-direction.ts';
import { readCellVerticalAlign, type CellVerticalAlign } from './table-cell-vertical-align.ts';
import { tableRowIsHeader } from './table-row-header-style.ts';
import { cellIgnoresEndMark } from './table-cell-hide-mark.ts';
import { resolveTableWidthPlacement } from './table-width-placement.ts';
import { legacyFixedTableContentOffset } from './legacy-fixed-table-content.ts';
import { withLegacyTableSideRules } from './legacy-table-side-rules.ts';
import { conditionalTypesFor, readTableLook } from './table-conditional-formats.ts';
import {
  autofitColumnWidthsPt,
  narrowNestedReader,
  type TableAutofitContext,
} from './table-autofit-widths.ts';
export { tableOriginX, tableFloatOriginX } from './table-origin.ts';
// Cell padding is its own unit (`table-cell-margins.ts`); re-exported here because this is
// where the published table surface lives.
export {
  CELL_PAD,
  DEFAULT_CELL_MARGINS,
  MAX_CELL_MARGIN_PT,
  mergeMargins,
  readMarginSides,
  type CellMarginsPt,
};

export {
  AUTO_PREFERRED_WIDTH,
  MAX_TABLE_COLUMNS,
  type PreferredWidth,
  type PreferredWidthType,
} from './table-widths.ts';
export type { CellVerticalAlign } from './table-cell-vertical-align.ts';

/**
 * Layout-time nesting ceiling. Parse-time depth (MAX_DEPTH = 256 XML levels) alone still
 * admits ~80 levels of `w:tbl` recursion into the layout walk; deeper tables render as an
 * empty cell box rather than recursing.
 */
export const MAX_TABLE_NESTING = 16;

/**
 * Soft ceiling on an authored `w:trHeight` (~22"). Hostile `w:val` otherwise becomes a
 * multi-page row that every pagination preflight and cell box inherits.
 */
export const MAX_TABLE_ROW_HEIGHT_PT = 31_680 / 20;

/**
 * `w:trPr/w:trHeight` (17.4.81) resolved for layout. Points leave the reader already —
 * twips convert once here, matching every other table geometry boundary.
 *
 * Word quirk (matches Form025U and Word's UI export): a present `@w:val` with an omitted
 * `@w:hRule` is treated as `atLeast`, not ECMA's `auto`. Explicit `auto` still ignores val.
 */
export type TableRowHeightRule = 'auto' | 'atLeast' | 'exact';

/**
 * `w:trHeight` — a row's height rule and its value.
 *
 * `auto` carries no value at all, which is why this is a union rather than a rule plus an
 * optional number.
 */
export type TableRowHeight =
  | { readonly rule: 'auto' }
  | { readonly rule: 'atLeast' | 'exact'; readonly valuePt: number };

/** Highest grid column a cell may start on; keeps a row's total span bounded. */
const LAST_GRID_COLUMN = MAX_TABLE_COLUMNS - 1;

/** Distinct conditional-format combinations memoized per table; see `styleFormattingFor`. */
const MAX_CELL_CONDITION_SETS = 256;

/** `w:tblPr/w:jc` (17.4.29, ST_JcTable): where the table sits within the text column. */
export type TableAlignment = 'left' | 'center' | 'right';

/**
 * Bound on the size of `w:tblInd` in either direction. The indent is signed and has its own
 * reader (`readTableIndentPt`); the table widths and margins stay unsigned.
 */
const MAX_TABLE_INDENT_PT = 31_680 / 20;

/** One anchor box, in the same coordinates layout reports fragment boxes in. */
export interface TableAnchorFrame {
  readonly left: number;
  readonly width: number;
}

/** The three boxes `w:horzAnchor` can name, resolved for the region being laid out. */
export interface TableAnchorFrames {
  /** The text column the table was authored in. */
  readonly text: TableAnchorFrame;
  /** The page's text area between the left and right margins. */
  readonly margin: TableAnchorFrame;
  /** The whole sheet, margins included. */
  readonly page: TableAnchorFrame;
}

/**
 * One cell in the resolved table structure.
 *
 * `gridSpan` is clamped at READ time and layout never re-derives it — the value comes from a file
 * and would otherwise be a loop bound an attacker controls.
 */
export interface SemanticTableCell {
  readonly revisionShading?: 'inserted' | 'deleted' | 'merged' | 'split';
  readonly revisionShadingAuthor?: string;
  readonly id: string;
  /** Derived content-edge geometry for a verified legacy percentage-width parent table. */
  readonly legacyContentAlignment?: true;
  /** Resolved simple side rules centered on a legacy absolute-width table grid. */
  readonly centeredSideRules?: true;
  /** Simple side rules painted centered on the grid line, without moving the content edge. */
  readonly centeredSidePaint?: true;
  /** Clamped to [1, MAX_TABLE_COLUMNS] at read time; layout never re-derives it. */
  readonly gridSpan: number;
  /** Physical grid column after width/style resolution and the bidiVisual projection. */
  readonly gridColumn: number;
  /** Stored grid index when bidiVisual maps this cell into a physical RTL grid. */
  readonly logicalGridColumn?: number;
  /** Canonical `w:gridCol` node id for this cell's start column, when the grid is authored. */
  readonly gridColumnId?: string;
  /** A vMerge cell that is not the restart continues the cell above: box, no content. */
  readonly vMergeContinue: boolean;
  /** `w:hideMark` excludes the end-of-cell glyph from row sizing. */
  readonly hideEndMark?: boolean;
  /** `w:vAlign` — defaults to top when omitted/unrecognised. */
  readonly vAlign: CellVerticalAlign;
  /** `w:textDirection`; unsupported values keep horizontal layout. */
  readonly textDirection: 'horizontal' | 'btLr';
  /** Resolved per-side margins (tcMar over tblCellMar over the table style over Word's default). */
  readonly margins: CellMarginsPt;
  /** Three-state authored `tcBorders` (omitted / none / edge). */
  readonly borders: CellBorderBox;
  /** Resolved incident edges used for content clearance, preserving authored border provenance. */
  readonly contentBorders?: CellBorderBox;
  /** The resolved cell (including a vertical merge) ends at the authored table bottom. */
  readonly contentBottomIsOuter?: boolean;
  /** Clearance this AUTHORED ROW reserves above its content for its own top rule, in points. */
  readonly topBandClearancePt?: number;
  /** The CELL declares `w:tcBorders/w:top` as `nil`, rather than a table style doing so. */
  readonly suppressesTopBand?: true;
  /** Row-local clearance in points for authored minima, before vMerge combines content boxes. */
  readonly minimumContentInsets?: { readonly top: number; readonly bottom: number };
  /** Validated 6-hex shading fill, absent for none/auto. */
  readonly shading?: string;
  /**
   * `w:tcW` — the width this cell asked for, as authored.
   *
   * Published for consumers that need the cell's own statement (a column-resize handle has
   * to write back to it). Column geometry is NOT derived from this field: the resolver works
   * from a flat claim list built in the same pass, because resolving a column means looking
   * at every cell that covers it across every row, not at one cell at a time. Read
   * `columnWidthsPt` for what the table actually laid out.
   */
  readonly preferredWidth: PreferredWidth;
  /**
   * What the table style says about this cell's paragraphs and runs (17.7.6.6) — a header
   * row's bold and centring live here, not in the cell's own properties.
   */
  readonly styleFormatting: TableCellStyleFormatting;
  /** Block children in reading order, with content-control wrappers flattened. */
  readonly blocks: readonly OoxmlElement[];
}

/** One row in the resolved structure: its cells, its height rule, and any row-level revision. */
export interface SemanticTableRow {
  readonly id: string;
  /** Pending Word row insertion/deletion authored in `w:trPr`. */
  readonly revisionKind?: 'insert' | 'delete';
  /**
   * The `w:trPr/w:ins|w:del` attribution, carried with the kind so a painted row can say
   * WHOSE pending decision it is — the review model addresses the decision by exactly this
   * `(id, author, date)` triple, and a surface with only the kind could highlight the row
   * but never open its card.
   */
  readonly revisionId?: string;
  readonly revisionAuthor?: string;
  readonly revisionDate?: string;
  /** The row insertion a resolved view kept the row through; see the fragment record. */
  readonly changeSites?: readonly RevisionAttribution[];
  /** `w:trPr/w:tblHeader` — the row repeats atop each page the table continues onto. */
  readonly isHeader: boolean;
  /**
   * `w:trPr/w:cantSplit` — the row must stay on one page. When no page can hold it, the
   * row starts on a fresh page and splits there, so its content is kept.
   */
  readonly cantSplit: boolean;
  /** `w:trPr/w:trHeight` — auto / atLeast floor / exact (clipped) row height. */
  readonly height: TableRowHeight;
  readonly cells: readonly SemanticTableCell[];
}

/**
 * A table resolved into a rectangular grid: column widths, rows, and the widths it asked for.
 *
 * The grid is normalized here so layout never has to reconcile `w:gridCol` against actual cell
 * spans — vertical merges and column spans are already accounted for.
 */
export interface SemanticTableStructure {
  /** Whether stored columns and horizontal table properties display right to left. */
  readonly bidiVisual?: true;
  readonly columnWidthsPt: readonly number[];
  readonly rows: readonly SemanticTableRow[];
  /** Verified pre-2013 percentage-width inline table; derived, never serialized. */
  readonly legacyContentAlignment?: true;
  /** A legacy content-aligned table whose outer trailing edge, not its content, meets the
   * trailing text edge: a top-level table in a text box. Derived, never serialized. */
  readonly legacyTrailingOuterEdge?: true;
  /**
   * Derived, never serialized: how far the grid moves from the aligned table edge, in points.
   * A supported mode-14 fixed table shifts by its leading cell margin in the other direction.
   * A compatibility-mode-15 left- or right-aligned table puts the outer edge of its side rule
   * on that edge, so its first grid line sits half a rule inward. Positive moves right.
   */
  readonly outerRuleOffsetPt?: number;
  /** `w:tblPr/w:tblW` — the width the table asked for. */
  readonly tableWidth: PreferredWidth;
  /**
   * `w:tblInd` (17.4.50) in points — "this indentation should shift the table into the text
   * margin by the specified amount". Applies to a left-aligned table; `w:jc` decides the
   * placement outright for the other two. Negative on a top-level table, which the indent
   * pulls into the leading margin; never negative on a nested table.
   */
  readonly indentPt: number;
  /** `w:tblPr/w:jc` (17.4.29) — where the table sits in the text column. */
  readonly alignment: TableAlignment;
  /**
   * `w:tblPr/w:tblpPr` (17.4.57) — present when the table is positioned against an anchor
   * box. Placement then comes from {@link tableFloatOriginX} rather than `w:jc`/`w:tblInd`.
   */
  readonly float?: TableFloatPosition;
  /**
   * `w:tblCellSpacing` (17.4.45) in points: the space on each side of every cell. Cells sit
   * twice this apart and from the table edge; the gaps come out of the table width, and each
   * column gives up its share in proportion (`table-cell-spacing.ts`). Rows do not yet get
   * the matching gaps above and below them, so a spaced table's rows stay as tall as they
   * would be without it.
   */
  readonly cellSpacingPt: number;
  /**
   * `w:tblPr/w:tblLayout/@w:type="fixed"` (17.4.52 — 17.4.53 is the `w:tblPrEx` exception
   * variant, not this element). Fixed layout takes the grid as final;
   * anything else is autofit, which in Word never renders wider than the text column.
   */
  readonly layoutFixed: boolean;
  /** Table-level `tblBorders` (three-state, including insideH/insideV). */
  readonly tableBorders: TableBorderBox;
  /** Table-level `tblCellMar` defaults (per-side, Word's own default when a side is omitted). */
  readonly defaultMargins: CellMarginsPt;
}

function childNamed(node: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of node.children) {
    if (child.kind !== 'textValue' && child.localName === localName) return child;
  }
  return undefined;
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

interface TableStructureMemo {
  readonly contentWidthPt: number;
  readonly depth: number;
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly displayMode: RevisionDisplayMode;
  readonly authorFilter: RevisionAuthorFilter | undefined;
  readonly compatibilityMode: number | undefined;
  readonly textBox: boolean;
  readonly structure: SemanticTableStructure | null;
}

/** The last unfiltered structure for each immutable table node. */
const tableStructureMemos = new WeakMap<object, TableStructureMemo>();

/**
 * The last filtered structure for each immutable table node. A separate cache lets save-time
 * canonical layout keep both projections warm without slowing the common unfiltered lookup.
 */
const filteredTableStructureMemos = new WeakMap<object, TableStructureMemo>();

/**
 * Widened structures per base, by their widths. Readers that widen one base differently (two
 * measurers, two field contexts) keep separate entries instead of evicting each other.
 */
const widenedStructureMemos = new WeakMap<
  SemanticTableStructure,
  Map<string, SemanticTableStructure>
>();
const MAX_WIDENED_PER_BASE = 4;

/**
 * Read one typed table node into a bounded structure, or null when the node is not a
 * typed table or sits beyond the nesting ceiling.
 */
export function readTableStructure(
  table: OoxmlNode,
  contentWidthPt: number,
  depth: number,
  styleCascade?: StyleCascadeTable,
  /** Which revisions the view resolves away; only the proposed result performs the join. */
  displayMode: RevisionDisplayMode = 'all-markup',
  authorFilter?: RevisionAuthorFilter,
  compatibilityMode?: number,
  /** Widens autofit columns to their content minimums; layout passes its measurer. */
  autofit?: TableAutofitContext,
  /** The table is a top-level table of a text box story. */
  textBox = false
): SemanticTableStructure | null {
  const memoStore = authorFilter ? filteredTableStructureMemos : tableStructureMemos;
  const memo = memoStore.get(table);
  let base: SemanticTableStructure | null;
  if (
    memo &&
    memo.contentWidthPt === contentWidthPt &&
    memo.depth === depth &&
    // Identity compare is sound because a cascade table is built once per styles part and
    // never mutated; a fresh-but-equal cascade only misses the memo, never lies to it.
    memo.styleCascade === styleCascade &&
    memo.displayMode === displayMode &&
    memo.authorFilter === authorFilter &&
    memo.compatibilityMode === compatibilityMode &&
    memo.textBox === textBox
  ) {
    base = memo.structure;
  } else {
    base = readTableStructureUncached(
      table,
      contentWidthPt,
      depth,
      styleCascade,
      displayMode,
      authorFilter,
      compatibilityMode,
      undefined,
      textBox
    );
    memoStore.set(table, {
      contentWidthPt,
      depth,
      styleCascade,
      displayMode,
      authorFilter,
      compatibilityMode,
      textBox,
      structure: base,
    });
  }
  if (!autofit || !base || (base.layoutFixed && depth === 0)) return base;
  // Most tables already hold their content: they come back as the shared base structure.
  const widths = autofitColumnWidthsPt(base, contentWidthPt, autofit, {
    styleCascade,
    displayMode,
    authorFilter,
    depth,
    readNested: narrowNestedReader(
      readTableStructure,
      styleCascade,
      displayMode,
      authorFilter,
      compatibilityMode
    ),
  });
  if (widths === base.columnWidthsPt) return base;
  const widthsKey = widths.join(',');
  let widened = widenedStructureMemos.get(base);
  const known = widened?.get(widthsKey);
  if (known) return known;
  const structure = readTableStructureUncached(
    table,
    contentWidthPt,
    depth,
    styleCascade,
    displayMode,
    authorFilter,
    compatibilityMode,
    base.bidiVisual ? [...widths].reverse() : widths,
    textBox
  );
  if (structure) {
    if (!widened) widenedStructureMemos.set(base, (widened = new Map()));
    if (widened.size >= MAX_WIDENED_PER_BASE) widened.delete(widened.keys().next().value!);
    widened.set(widthsKey, structure);
  }
  return structure;
}

function readTableStructureUncached(
  table: OoxmlNode,
  contentWidthPt: number,
  depth: number,
  styleCascade: StyleCascadeTable | undefined,
  displayMode: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter,
  compatibilityMode?: number,
  /** Logical column widths that replace the resolved ones (autofit widening). */
  columnWidthsOverridePt?: readonly number[],
  textBox = false
): SemanticTableStructure | null {
  if (depth >= MAX_TABLE_NESTING) return null;
  if (table.kind !== 'table') return null;

  const tblPr = childNamed(table, 'tblPr');
  // A table's appearance mostly lives in its STYLE. Word writes
  // `<w:tblStyle w:val="TableGrid"/>` and keeps the grid in styles.xml, so reading the
  // table's own `w:tblPr` alone draws a borderless table where Word draws a full grid.
  const styleId =
    tblPr && childNamed(tblPr, 'tblStyle')
      ? attributeValue(childNamed(tblPr, 'tblStyle')!, 'val')
      : undefined;
  const tableStyle = styleCascade
    ? cascadeTableFormatting(styleCascade, styleId)
    : EMPTY_TABLE_FORMATTING;
  const look = readTableLook(tblPr);
  let bidiVisual = false;
  for (const node of tableStyle.tablePropertyNodes) {
    if (childNamed(node, 'bidiVisual')) bidiVisual = readFlag(node, 'bidiVisual');
  }
  if (tblPr && childNamed(tblPr, 'bidiVisual')) bidiVisual = readFlag(tblPr, 'bidiVisual');

  // A missing margin resolves to 10 twips, including legacy documents. The
  // familiar 108-twip inset belongs to the authored default table style, not
  // this application fallback. Styles, table properties and cells override
  // each side independently, including explicit zero.
  let styleMargins: CellMarginsPt = { top: 0, right: 0.5, bottom: 0, left: 0.5 };
  let styleBorders = EMPTY_TABLE_BORDER_BOX;
  for (const node of tableStyle.tablePropertyNodes) {
    styleMargins = mergeMargins(styleMargins, readMarginSides(childNamed(node, 'tblCellMar')));
    styleBorders = mergeTableBorders(styleBorders, readTableBorders(node));
  }
  const defaultMargins = mergeMargins(
    styleMargins,
    readMarginSides(tblPr && childNamed(tblPr, 'tblCellMar'))
  );
  const tableBorders = mergeTableBorders(
    styleBorders,
    tblPr ? readTableBorders(tblPr) : EMPTY_TABLE_BORDER_BOX
  );

  // Cells under the same conditions resolve to the same paragraph/run material, and a table
  // has few distinct condition sets. Memoized per table so a 10k-cell table flattens the
  // style chain a handful of times, not once per cell. A hostile `w:cnfStyle` can still name
  // up to 4096 distinct sets, so the memo stops growing at the ceiling and later cells simply
  // resolve unmemoized — same bounded per-cell work either way.
  const styleByConditions = new Map<string, TableCellStyleFormatting>();
  // Word's `TableNormal` states `w:tblPr` and nothing else, and every table now resolves it,
  // so the identity check against `EMPTY_TABLE_FORMATTING` that used to short-circuit here
  // stopped firing — every cell of every unstyled table flattened a chain that could only
  // ever answer "nothing". Ask what the style actually contributes to a CELL instead.
  const cellStyleMaterial = tableStyleAffectsCells(tableStyle);
  const styleFormattingFor = (conditions: readonly string[]): TableCellStyleFormatting => {
    if (!cellStyleMaterial) return EMPTY_TABLE_CELL_STYLE_FORMATTING;
    const key = conditions.join('|');
    const cached = styleByConditions.get(key);
    if (cached) return cached;
    const resolved = tableCellStyleFormatting(tableStyle, conditions);
    if (styleByConditions.size < MAX_CELL_CONDITION_SETS) styleByConditions.set(key, resolved);
    return resolved;
  };

  // Grid pass. Every cell's absolute grid column, and the table's column count, are settled
  // before any conditional format is derived — both key on the grid, not on cell order. A
  // cell may start no later than the last column and may not span past it, which is what
  // bounds a ROW's total span: per-cell `w:gridSpan` is already clamped, but a row of
  // thousands of maximum-span cells would otherwise walk millions of grid intervals in the
  // border pass. Fails closed like the ownership and vMerge budgets: the overflow cells
  // pile onto the last column instead of extending the grid.
  interface RowPlan {
    readonly node: OoxmlElement;
    readonly revision: OoxmlElement | undefined;
    readonly changeSites: readonly RevisionAttribution[] | undefined;
    /** The row's cells with any `CT_SdtCell` wrapper unwrapped, so both passes see one list. */
    readonly cells: readonly OoxmlNode[];
    readonly properties: OoxmlElement | undefined;
    readonly starts: readonly number[];
    readonly spans: readonly number[];
    readonly preferred: readonly PreferredWidth[];
    readonly gridColumns: number;
  }
  const plans: RowPlan[] = [];
  const claims: CellWidthClaim[] = [];
  let hasOmittedRows = false;
  let derivedColumns = 1;
  // A content control may sit between the table and its rows (`CT_SdtRow`) or between a row and
  // its cells (`CT_SdtCell`). It is a label on that row or cell, not a box around it, so it is
  // unwrapped HERE — before the kind filter — and the grid pass, the cell pass and pagination all
  // see the same row and cell lists they would see in a table that carried no controls at all.
  for (const rowNode of flattenContentControls(table.children)) {
    if (rowNode.kind !== 'tableRow') continue;
    const properties = wmlRevisionChild(rowNode, 'trPr');
    const authoredRevision = properties
      ? (wmlRevisionChild(properties, 'ins') ?? wmlRevisionChild(properties, 'del'))
      : undefined;
    const revisionKind = authoredRevision?.localName;
    const revisionAuthor = authoredRevision
      ? (wmlRevisionAttribute(authoredRevision, 'author') ?? '')
      : undefined;
    const projectedMode =
      authoredRevision && revisionAuthor !== undefined && authorFilter
        ? revisionNodeProjectionMode(authorFilter, authoredRevision.id, revisionAuthor, displayMode)
        : displayMode;
    if (
      (projectedMode === 'proposed' && revisionKind === 'del') ||
      (projectedMode === 'original' && revisionKind === 'ins')
    ) {
      hasOmittedRows = true;
      continue;
    }
    const revision = projectedMode === 'all-markup' ? authoredRevision : undefined;
    // A resolved view that KEEPS a tracked row (an accepted insertion) still owes the reader
    // a change bar beside it, unless the reviewer filter hides the decision.
    const changeSites =
      authoredRevision &&
      projectedMode !== 'all-markup' &&
      revisionAuthor !== undefined &&
      (!authorFilter || revisionNodeIncluded(authorFilter, authoredRevision.id, revisionAuthor))
        ? [
            {
              kind: revisionKind === 'ins' ? ('insert' as const) : ('delete' as const),
              id: wmlRevisionAttribute(authoredRevision, 'id') ?? '',
              author: revisionAuthor,
              ...(wmlRevisionAttribute(authoredRevision, 'date') === undefined
                ? {}
                : { date: wmlRevisionAttribute(authoredRevision, 'date')! }),
              nodeId: authoredRevision.id,
            },
          ]
        : undefined;
    const starts: number[] = [];
    const spans: number[] = [];
    const preferred: PreferredWidth[] = [];
    const gridBefore = Math.min(readGridSkip(properties, 'gridBefore'), LAST_GRID_COLUMN);
    // 17.18.87: "the initial number of grid units before the row starts is skipped. The
    // width of the skipped grid columns is set using the wBefore property." Without this the
    // skipped band is a column nothing states, and it absorbs the leftover as a phantom
    // gutter wider than the cells it precedes.
    if (gridBefore > 0) {
      claims.push({
        start: 0,
        span: gridBefore,
        preferred: readPreferredWidth(properties && childNamed(properties, 'wBefore')),
      });
    }
    let cursor = gridBefore;
    const rowCells = flattenContentControls(rowNode.children);
    for (const cellNode of rowCells) {
      if (cellNode.kind !== 'tableCell') continue;
      const cellPr = childNamed(cellNode, 'tcPr');
      const start = Math.min(cursor, LAST_GRID_COLUMN);
      const span = Math.min(
        readGridSpan(cellPr),
        MAX_TABLE_COLUMNS - start // ≥ 1: `start` never exceeds the last column
      );
      const width = readPreferredWidth(cellPr && childNamed(cellPr, 'tcW'));
      starts.push(start);
      spans.push(span);
      preferred.push(width);
      claims.push({ start, span, preferred: width });
      cursor = start + span;
    }
    const gridAfter = readGridSkip(properties, 'gridAfter');
    const gridColumns = Math.min(cursor + gridAfter, MAX_TABLE_COLUMNS);
    // 17.4.85, the trailing counterpart of `w:wBefore`.
    if (gridAfter > 0 && cursor < MAX_TABLE_COLUMNS) {
      claims.push({
        start: cursor,
        span: Math.min(gridAfter, MAX_TABLE_COLUMNS - cursor),
        preferred: readPreferredWidth(properties && childNamed(properties, 'wAfter')),
      });
    }
    if (gridColumns > derivedColumns) derivedColumns = gridColumns;
    plans.push({
      node: rowNode,
      revision,
      changeSites,
      cells: rowCells,
      properties,
      starts,
      spans,
      preferred,
      gridColumns,
    });
  }

  const gridCols = gridColumnElements(table);
  const columnCount = gridCols.length > 0 ? gridCols.length : derivedColumns;
  const bodyRows = plans.length;

  const rows: SemanticTableRow[] = [];
  // Grid columns where the previous row has a cell with `w:vMerge`. A continuation only
  // continues such a cell (17.4.85). Below an unmerged cell, or in the first row, it has
  // nothing to continue, so it starts its own merge and paints its own content.
  let mergedAbove = new Set<number>();
  for (let rowIndex = 0; rowIndex < plans.length; rowIndex += 1) {
    const plan = plans[rowIndex]!;
    const rowNode = plan.node;
    const rowProperties = plan.properties;
    const rowConditions = conditionalTypesFor({
      look,
      rowIndex,
      rowCount: bodyRows,
      gridColumn: 0,
      gridSpan: Math.max(1, columnCount),
      columnCount: Math.max(1, columnCount),
      rowProperties,
      cellProperties: undefined,
    });
    const isHeader = tableRowIsHeader(tableStyle, rowConditions, rowProperties);
    let cellIndex = 0;
    const cells: SemanticTableCell[] = [];
    const mergedHere = new Set<number>();
    for (const cellNode of plan.cells) {
      if (cellNode.kind !== 'tableCell') continue;
      const cellProperties = childNamed(cellNode, 'tcPr');
      const gridColumn = plan.starts[cellIndex]!;
      const gridSpan = plan.spans[cellIndex]!;
      // Read alongside its siblings, before `cellIndex` moves on — the plan loop and this
      // one skip the same non-cell children, and the indices must stay in lockstep.
      const preferredWidth = plan.preferred[cellIndex] ?? AUTO_PREFERRED_WIDTH;
      const conditions = conditionalTypesFor({
        look,
        rowIndex,
        rowCount: bodyRows,
        gridColumn,
        gridSpan,
        columnCount,
        // A producer may state the conditions itself rather than leave them to be derived.
        rowProperties,
        cellProperties,
      });
      cellIndex += 1;
      let conditionalShading: string | undefined;
      let conditionalBorders = EMPTY_CELL_BORDER_BOX;
      for (const conditionType of conditions) {
        const format = tableStyle.conditional.get(conditionType);
        if (!format) continue;
        const conditionTcPr = childNamed(format, 'tcPr');
        conditionalShading = readShading(conditionTcPr) ?? conditionalShading;
        conditionalBorders = mergeCellBorders(conditionalBorders, readCellBorders(conditionTcPr));
      }
      const shading = readShading(cellProperties) ?? conditionalShading;
      const cellMargins = mergeMargins(
        defaultMargins,
        readMarginSides(cellProperties && childNamed(cellProperties, 'tcMar'))
      );
      // Content controls inside a cell flatten transparently — same rule as body
      // `storyBlocks`. Without this a `w:sdt` wrapping the cell's paragraphs leaves the
      // cell empty in layout while the tree still holds the text.
      // Through the shared collector: a cell is a story like any other, so a tracked mark
      // merges inside it and a paragraph a revision removed leaves no blank line behind.
      const blocks = mergedFlowBlocks(cellNode.children, displayMode, authorFilter);
      const ownBorders = cellProperties ? readCellBorders(cellProperties) : EMPTY_CELL_BORDER_BOX;
      const vMerge = readVMerge(cellProperties);
      if (vMerge !== 'none') mergedHere.add(gridColumn);
      cells.push({
        id: cellNode.id,
        ...revisionCellMetadata(cellProperties, displayMode, authorFilter, plan.revision),
        gridSpan,
        gridColumn,
        ...(gridCols[gridColumn]?.id ? { gridColumnId: gridCols[gridColumn]!.id } : {}),
        vMergeContinue: vMerge === 'continue' && mergedAbove.has(gridColumn),
        hideEndMark: cellIgnoresEndMark(tableStyle, conditions, cellProperties),
        vAlign: readCellVerticalAlign(cellProperties),
        textDirection: readCellTextDirection(cellProperties),
        margins: cellMargins,
        borders: mergeCellBorders(conditionalBorders, ownBorders),
        ...(ownBorders.top.state === 'none' ? { suppressesTopBand: true as const } : {}),
        ...(shading === undefined ? {} : { shading }),
        preferredWidth,
        styleFormatting: styleFormattingFor(conditions),
        blocks,
      });
    }
    mergedAbove = mergedHere;
    const rowRevision = plan.revision;
    const rowRevisionKind = rowRevision
      ? rowRevision.localName === 'ins'
        ? ('insert' as const)
        : ('delete' as const)
      : undefined;
    const rowRevisionId = rowRevision && wmlRevisionAttribute(rowRevision, 'id');
    const rowRevisionAuthor = rowRevision && wmlRevisionAttribute(rowRevision, 'author');
    const rowRevisionDate = rowRevision && wmlRevisionAttribute(rowRevision, 'date');
    rows.push({
      id: rowNode.id,
      ...(rowRevisionKind ? { revisionKind: rowRevisionKind } : {}),
      ...(rowRevisionId !== undefined ? { revisionId: rowRevisionId } : {}),
      ...(rowRevisionAuthor !== undefined ? { revisionAuthor: rowRevisionAuthor } : {}),
      ...(rowRevisionDate !== undefined ? { revisionDate: rowRevisionDate } : {}),
      ...(plan.changeSites ? { changeSites: plan.changeSites } : {}),
      isHeader,
      cantSplit: readFlag(rowProperties, 'cantSplit'),
      height: readRowHeight(rowProperties),
      cells,
    });
  }

  // `w:tblW` and `w:tblLayout` both live in CT_TblPrBase, which is what a table STYLE's
  // `w:tblPr` carries — the same reason `tblCellMar` and `tblBorders` cascade above. A style
  // that states "AutoFit to Window" or fixed layout is stating it for every table that names
  // it. 17.4.52: an absent `w:tblLayout` means autofit.
  let styleTableWidth = AUTO_PREFERRED_WIDTH;
  let styleLayoutFixed: boolean | undefined;
  let styleIndentPt: number | undefined;
  let styleAlignment: TableAlignment | undefined;
  let styleCellSpacingPt: number | undefined;
  let styleFloat: TableFloatPosition | undefined;
  for (const node of tableStyle.tablePropertyNodes) {
    const styleW = childNamed(node, 'tblW');
    if (styleW) styleTableWidth = readTablePreferredWidth(styleW);
    const styleLayout = childNamed(node, 'tblLayout');
    if (styleLayout) styleLayoutFixed = attributeValue(styleLayout, 'type') === 'fixed';
    styleIndentPt =
      readTableIndentPt(childNamed(node, 'tblInd'), MAX_TABLE_INDENT_PT) ?? styleIndentPt;
    styleAlignment = readTableAlignment(node) ?? styleAlignment;
    styleCellSpacingPt =
      preferredLengthPt(childNamed(node, 'tblCellSpacing'), MAX_CELL_MARGIN_PT) ??
      styleCellSpacingPt;
    styleFloat = readTableFloatPosition(node) ?? styleFloat;
  }
  const ownTblW = tblPr && childNamed(tblPr, 'tblW');
  const tableWidth = ownTblW ? readTablePreferredWidth(ownTblW) : styleTableWidth;
  const tblLayout = tblPr && childNamed(tblPr, 'tblLayout');
  const layoutFixed = tblLayout
    ? attributeValue(tblLayout, 'type') === 'fixed'
    : (styleLayoutFixed ?? false);
  const statedIndentPt =
    readTableIndentPt(tblPr && childNamed(tblPr, 'tblInd'), MAX_TABLE_INDENT_PT) ??
    styleIndentPt ??
    0;
  // Captured controls pull a top-level table (bidiVisual too) into the leading margin by a
  // negative indent, and leave a nested table where a zero indent puts it.
  const readIndentPt = depth === 0 ? statedIndentPt : Math.max(0, statedIndentPt);
  const alignment = readTableAlignment(tblPr) ?? styleAlignment ?? 'left';
  // A nested table's position is stated against its cell, not the page — `w:tblpPr` inside
  // one is honoured by Word only for the top-level table, so deeper tables stay in flow.
  const float = depth === 0 ? (readTableFloatPosition(tblPr) ?? styleFloat) : undefined;
  const cellSpacingPt =
    preferredLengthPt(tblPr && childNamed(tblPr, 'tblCellSpacing'), MAX_CELL_MARGIN_PT) ??
    styleCellSpacingPt ??
    0;

  const placement = resolveTableWidthPlacement({
    table,
    propertyNodes: tableStyle.tablePropertyNodes,
    rows,
    columnCount,
    contentWidthPt,
    compatibilityMode,
    depth,
    tableWidth,
    cellSpacingPt,
    floating: float !== undefined,
    layoutFixed,
    alignment,
    bidiVisual,
    indentPt: readIndentPt,
    indentStated: Boolean(tblPr && childNamed(tblPr, 'tblInd')) || styleIndentPt !== undefined,
    tableBorders,
    claims,
    gridCols,
    textBox,
  });
  const { legacy, indentPt } = placement;
  const legacyWidth = legacy?.widthPt;

  const columnWidthsPt =
    columnWidthsOverridePt ??
    resolveColumnWidthsPt({
      gridCols,
      claims: placement.claims,
      columnCount,
      contentWidthPt: placement.contentWidthPt,
      tableWidth: placement.tableWidth,
      layoutFixed,
      // A hidden revision row can still account for part of the authored grid.
      hasOmittedRows,
    });
  // Project the grid visually; cell arrays retain document order for keyboard traversal.
  const visualRows = physicalTableRows(rows, columnWidthsPt.length, bidiVisual);
  let contentRows = withTableContentBorders(
    visualRows,
    bidiVisual
      ? { ...tableBorders, left: tableBorders.right, right: tableBorders.left }
      : tableBorders,
    columnWidthsPt.length,
    cellSpacingPt === 0
  );
  contentRows = withRowMinimumContentInsets(
    contentRows,
    visualRows,
    bidiVisual
      ? { ...tableBorders, left: tableBorders.right, right: tableBorders.left }
      : tableBorders,
    columnWidthsPt.length,
    cellSpacingPt === 0
  );
  const sideRuleShape = {
    compatibilityMode,
    depth,
    bidiVisual,
    floating: float !== undefined,
    cellSpacingPt,
    widthType: tableWidth.type,
    alignment,
    layoutFixed,
    indentPt,
    columnWidthsPt,
    containerWidthPt: contentWidthPt,
  };
  const sideRules = withSharedGridLineSideRules(contentRows, sideRuleShape);
  const contentOffset = legacyFixedTableContentOffset(
    table,
    tableStyle.tablePropertyNodes,
    contentRows,
    sideRuleShape
  );
  contentRows =
    contentOffset !== undefined && tableWidth.type === 'auto'
      ? withLegacyTableSideRules(sideRules.rows)
      : sideRules.rows;
  const outerRuleOffsetPt =
    contentOffset ?? sideRules.outerRuleOffsetPt ?? placement.bidiRuleShiftPt;
  return {
    ...(bidiVisual ? { bidiVisual: true as const } : {}),
    columnWidthsPt: bidiVisual ? [...columnWidthsPt].reverse() : columnWidthsPt,
    rows:
      legacyWidth === undefined
        ? contentRows
        : contentRows.map((row) => ({
            ...row,
            cells: row.cells.map((cell) => ({ ...cell, legacyContentAlignment: true as const })),
          })),
    ...(legacyWidth === undefined ? {} : { legacyContentAlignment: true as const }),
    ...(legacy?.trailingOuterEdge ? { legacyTrailingOuterEdge: true as const } : {}),
    ...(outerRuleOffsetPt === undefined ? {} : { outerRuleOffsetPt }),
    tableWidth,
    layoutFixed,
    indentPt,
    alignment: bidiVisual
      ? alignment === 'left'
        ? 'right'
        : alignment === 'right'
          ? 'left'
          : alignment
      : alignment,
    ...(float ? { float } : {}),
    cellSpacingPt,
    tableBorders: bidiVisual
      ? { ...tableBorders, left: tableBorders.right, right: tableBorders.left }
      : tableBorders,
    defaultMargins: bidiVisual
      ? { ...defaultMargins, left: defaultMargins.right, right: defaultMargins.left }
      : defaultMargins,
  };
}
import { physicalTableRows, withTableContentBorders } from './table-content-borders.ts';
