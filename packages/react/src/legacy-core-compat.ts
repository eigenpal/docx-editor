// Legacy React compatibility layer (GOAL-legacy-react-port.md).
//
// Adapter controls consume compatibility types and helpers through this boundary.
// paths (`@docx-editor.dev/core/types/document`, `/utils/fontOptions`, …), which do not
// exist in the greenfield package. Rather than rewrite the controls — the whole point of
// the port is that they are copied verbatim — this module supplies exactly the symbols
// they name, so only their IMPORT PATHS change.
// Shared adapter presentation and compatibility behavior.
// need engine data are honest stubs: they return the empty answer and say what deriving
// them requires. A stub must never guess.
//
// This module is temporary. Each symbol moves to the engine as the corresponding
// capability lands; nothing here should acquire behavior of its own.

export type NumberFormat =
  | 'decimal'
  | 'upperRoman'
  | 'lowerRoman'
  | 'upperLetter'
  | 'lowerLetter'
  | 'ordinal'
  | 'cardinalText'
  | 'ordinalText'
  | 'hex'
  | 'chicago'
  | 'ideographDigital'
  | 'japaneseCounting'
  | 'aiueo'
  | 'iroha'
  | 'decimalFullWidth'
  | 'decimalHalfWidth'
  | 'japaneseLegal'
  | 'japaneseDigitalTenThousand'
  | 'decimalEnclosedCircle'
  | 'decimalFullWidth2'
  | 'aiueoFullWidth'
  | 'irohaFullWidth'
  | 'decimalZero'
  // Synthetic in-memory formats for Word's `w:numFmt w:val="custom"` with an
  // XSLT-style zero-padded format string ("001, 002, ...", "0001, ...",
  // "00001, ..."). Not OOXML enum values — never serialized (numbering.xml is
  // preserved as-is on save); they exist so the render pipeline can carry the
  // pad width through the existing NumberFormat plumbing.
  | 'decimalZero3'
  | 'decimalZero4'
  | 'decimalZero5'
  | 'bullet'
  | 'ganada'
  | 'chosung'
  | 'decimalEnclosedFullstop'
  | 'decimalEnclosedParen'
  | 'decimalEnclosedCircleChinese'
  | 'ideographEnclosedCircle'
  | 'ideographTraditional'
  | 'ideographZodiac'
  | 'ideographZodiacTraditional'
  | 'taiwaneseCounting'
  | 'ideographLegalTraditional'
  | 'taiwaneseCountingThousand'
  | 'taiwaneseDigital'
  | 'chineseCounting'
  | 'chineseLegalSimplified'
  | 'chineseCountingThousand'
  | 'koreanDigital'
  | 'koreanCounting'
  | 'koreanLegal'
  | 'koreanDigital2'
  | 'vietnameseCounting'
  | 'russianLower'
  | 'russianUpper'
  | 'none'
  | 'numberInDash'
  | 'hebrew1'
  | 'hebrew2'
  | 'arabicAlpha'
  | 'arabicAbjad'
  | 'hindiVowels'
  | 'hindiConsonants'
  | 'hindiNumbers'
  | 'hindiCounting'
  | 'thaiLetters'
  | 'thaiNumbers'
  | 'thaiCounting';

export type ParagraphAlignment =
  | 'left'
  | 'center'
  | 'right'
  | 'both'
  | 'distribute'
  | 'mediumKashida'
  | 'highKashida'
  | 'lowKashida'
  | 'thaiDistribute';

export interface FontOption {
  name: string;
  fontFamily: string;
  category?: 'sans-serif' | 'serif' | 'monospace' | 'other';
}
/** Compatibility contract for the shared adapter surface. */
export type StyleType = 'paragraph' | 'character' | 'numbering' | 'table';

/** Minimal shapes the ported controls read. Widened as real engine types land. */
/** Compatibility contract for the shared adapter surface.
 *  `type` is REQUIRED there; the interim version made it optional and StylePicker
 *  failed against it. */
export interface Style {
  /** Style ID */
  styleId: string;
  /** Style type */
  type: StyleType;
  /** Display name */
  name?: string;
  /** Based on style ID */
  basedOn?: string;
  /** Next style after Enter (for paragraph styles) */
  next?: string;
  /** Linked style (paragraph/character pair) */
  link?: string;
  /** Run properties the ported `stylePreview` reads to build its preview CSS. */
  rPr?: TextFormatting;
  /** Whether the style is surfaced in the styles gallery (`w:qFormat`). */
  qFormat?: boolean;
  hidden?: boolean;
  semiHidden?: boolean;
  uiPriority?: number;
  [key: string]: unknown;
}
/** The theme fields the ported colour resolver reads. */
export interface Theme {
  colorScheme?: ThemeColorScheme;
  [key: string]: unknown;
}
/** Compatibility contract for the shared adapter surface. */
export interface ThemeColorScheme {
  dk1?: string;
  lt1?: string;
  dk2?: string;
  lt2?: string;
  accent1?: string;
  accent2?: string;
  accent3?: string;
  accent4?: string;
  accent5?: string;
  accent6?: string;
  hlink?: string;
  folHlink?: string;
}
/** Compatibility contract for the shared adapter surface. */
export type ThemeColorSlot = string;
export interface ThemeMatrixCell {
  /** Resolved hex color (6 chars, no #) */
  hex: string;
  /** Theme color slot */
  themeSlot: ThemeColorSlot;
  /** Tint hex modifier if applicable (e.g., "CC") */
  tint?: string;
  /** Shade hex modifier if applicable (e.g., "BF") */
  shade?: string;
  /** Human-readable label (e.g., "Accent 1, Lighter 60%") */
  label: string;
}
/** Includes the theme tint and shade fields consumed by ColorPicker. */
export interface ColorValue {
  /** RGB hex value without # (e.g., "FF0000") */
  rgb?: string;
  /** Theme color slot reference */
  themeColor?: ThemeColorSlot;
  /** Tint modifier (0-255 as hex string, e.g., "80") - makes color lighter */
  themeTint?: string;
  /** Shade modifier (0-255 as hex string) - makes color darker */
  themeShade?: string;
  /** Auto color - context-dependent (usually black for text) */
  auto?: boolean;
}

/** Compatibility contract for the shared adapter surface. */
/** Compatibility contract for the shared adapter surface. */
export type ListType = 'bullet' | 'numbered' | 'none';
export interface ListState {
  type: ListType;
  level: number;
  isInList: boolean;
  numId?: number;
}

/**
 * STUB. The legacy helper filtered a font list against names the document cannot use.
 * The engine exposes no font inventory yet (`Editor` has no font query), so this returns
 * the input unchanged rather than silently dropping fonts a user asked for.
 */
export function excludeFontsByName<T extends { name: string }>(
  fonts: readonly T[] | undefined,
  _exclude?: readonly string[],
): T[] {
  return fonts ? [...fonts] : [];
}

// --- Helpers the ported controls call -------------------------------------------------
// Shared adapter presentation and compatibility behavior.
// not have yet is a stub returning the empty answer, per the port goal.

/** Copied verbatim from the legacy core's `utils/units.ts`. */
export function halfPointsToPoints(halfPoints: number): number {
  return halfPoints / 2;
}

/** Copied verbatim from the legacy core's `utils/units.ts`. */
export function pointsToHalfPoints(points: number): number {
  return Math.round(points * 2);
}


// `getStylePreviewProps`, `resolveParagraphStyleOptions` and `ResolvedStyleOption` are
// NOT declared here — they come from the ported `./lib/stylePreview`, re-exported below.
//
// The interim stubs for them used to live at this spot, and a local declaration SHADOWS a
// `export *`, so the ported implementations were being silently ignored: the style picker
// still got `{}` from a preview function that had been real for several commits. Nothing
// failed loudly, which is why it survived — the same class of defect as the icon swap
// that reported success while leaving nine controls hand-drawn.

export interface TextFormatting {
  // Basic formatting
  /** Bold (w:b) */
  bold?: boolean;
  /** Bold complex script (w:bCs) */
  boldCs?: boolean;
  /** Italic (w:i) */
  italic?: boolean;
  /** Italic complex script (w:iCs) */
  italicCs?: boolean;

  // Underline & strikethrough
  /** Underline style and color (w:u) */
  underline?: {
    style: UnderlineStyle;
    color?: ColorValue;
  };
  /** Strikethrough (w:strike) */
  strike?: boolean;
  /** Double strikethrough (w:dstrike) */
  doubleStrike?: boolean;

  // Vertical alignment
  /** Superscript/subscript (w:vertAlign) */
  vertAlign?: 'baseline' | 'superscript' | 'subscript';

  // Capitalization
  /** Small caps (w:smallCaps) */
  smallCaps?: boolean;
  /** All caps (w:caps) */
  allCaps?: boolean;

  // Visibility
  /** Hidden text (w:vanish) */
  hidden?: boolean;

  // Colors and highlighting
  /** Text color (w:color) */
  color?: ColorValue;
  /** Highlight/background color (w:highlight) */
  highlight?:
    | 'black'
    | 'blue'
    | 'cyan'
    | 'darkBlue'
    | 'darkCyan'
    | 'darkGray'
    | 'darkGreen'
    | 'darkMagenta'
    | 'darkRed'
    | 'darkYellow'
    | 'green'
    | 'lightGray'
    | 'magenta'
    | 'none'
    | 'red'
    | 'white'
    | 'yellow';
  /** Character shading (w:shd) */
  shading?: ShadingProperties;

  // Font properties
  /** Font size in half-points (w:sz) - e.g., 24 = 12pt */
  fontSize?: number;
  /** Font size complex script (w:szCs) */
  fontSizeCs?: number;
  /** Font family (w:rFonts) */
  fontFamily?: {
    ascii?: string;
    hAnsi?: string;
    eastAsia?: string;
    cs?: string;
    /** Theme font reference */
    asciiTheme?:
      | 'majorAscii'
      | 'majorHAnsi'
      | 'majorEastAsia'
      | 'majorBidi'
      | 'minorAscii'
      | 'minorHAnsi'
      | 'minorEastAsia'
      | 'minorBidi';
    hAnsiTheme?: string;
    eastAsiaTheme?: string;
    csTheme?: string;
  };

  // Spacing and position
  /** Character spacing in twips (w:spacing) */
  spacing?: number;
  /** Raised/lowered text position in half-points (w:position) */
  position?: number;
  /** Horizontal text scale percentage (w:w) */
  scale?: number;
  /** Kerning threshold in half-points (w:kern) */
  kerning?: number;

  // Effects
  /** Text effect animation (w:effect) */
  effect?: TextEffect;
  /** Emphasis mark (w:em) */
  emphasisMark?: EmphasisMark;
  /** Emboss effect (w:emboss) */
  emboss?: boolean;
  /** Imprint/engrave effect (w:imprint) */
  imprint?: boolean;
  /** Outline effect (w:outline) */
  outline?: boolean;
  /** Shadow effect (w:shadow) */
  shadow?: boolean;

  // Complex script
  /** Right-to-left text (w:rtl) */
  rtl?: boolean;
  /** Complex script formatting (w:cs) */
  cs?: boolean;

  // Style reference
  /** Character style ID (w:rStyle) */
  styleId?: string;
}

export interface ParagraphFormatting {
  // Alignment
  /** Paragraph alignment (w:jc) */
  alignment?: ParagraphAlignment;
  /** Text direction (w:bidi) */
  bidi?: boolean;

  // Spacing
  /** Spacing before in twips (w:spacing/@w:before) */
  spaceBefore?: number;
  /** Spacing after in twips (w:spacing/@w:after) */
  spaceAfter?: number;
  /** Line spacing value (w:spacing/@w:line) */
  lineSpacing?: number;
  /** Line spacing rule (w:spacing/@w:lineRule) */
  lineSpacingRule?: LineSpacingRule;
  /** Auto space before (w:spacing/@w:beforeAutospacing) */
  beforeAutospacing?: boolean;
  /** Auto space after (w:spacing/@w:afterAutospacing) */
  afterAutospacing?: boolean;
  /**
   * Paragraph-authored spacing sides. Layout keeps this provenance separate
   * because direct values and inherited defaults follow different placement rules.
   */
  spacingOverrides?: ParagraphSpacingOverrides;

  // Indentation
  /** Left indent in twips (w:ind/@w:left) */
  indentLeft?: number;
  /** Right indent in twips (w:ind/@w:right) */
  indentRight?: number;
  /** First line indent in twips - positive for indent, negative for hanging (w:ind/@w:firstLine or @w:hanging) */
  indentFirstLine?: number;
  /** Whether first line is hanging indent */
  hangingIndent?: boolean;
  /**
   * Clone-safe parser/PM provenance for indentation. The OOXML serializer
   * deliberately ignores this envelope, and fromProseDoc strips it from its
   * returned public Document.
   * @internal
   */
  _indentProvenance?: {
    source?: {
      left?: string;
      start?: string;
      right?: string;
      end?: string;
      firstLine?: string;
      hanging?: string;
    };
    sourceValues?: {
      indentLeft?: number;
      indentRight?: number;
      indentFirstLine?: number;
      hangingIndent?: boolean;
    };
    resolvedNumbering?: {
      sourceIdentity: {
        styleId?: string;
        numPr?: {
          numId?: number;
          ilvl?: number;
        };
        numPrFromStyle?: {
          numId?: number;
          ilvl?: number;
        };
        indentLeft?: number;
        indentRight?: number;
        indentFirstLine?: number;
        hangingIndent?: boolean;
        sourceIndent?: {
          left?: string;
          start?: string;
          right?: string;
          end?: string;
          firstLine?: string;
          hanging?: string;
        };
      };
      indentLeft?: number;
      indentRight?: number;
      indentFirstLine?: number;
      hangingIndent?: boolean;
    };
    baseline?: {
      indentLeft?: number;
      indentRight?: number;
      indentFirstLine?: number;
      hangingIndent?: boolean;
    };
  };

  // Borders
  /** Paragraph borders (w:pBdr) */
  borders?: {
    top?: BorderSpec;
    bottom?: BorderSpec;
    left?: BorderSpec;
    right?: BorderSpec;
    between?: BorderSpec;
    bar?: BorderSpec;
  };

  // Background
  /** Paragraph shading (w:shd) */
  shading?: ShadingProperties;

  // Tab stops
  /** Custom tab stops (w:tabs) */
  tabs?: TabMark[];

  // Page break control
  /** Keep with next paragraph (w:keepNext) */
  keepNext?: boolean;
  /** Keep lines together (w:keepLines) */
  keepLines?: boolean;
  /** Widow/orphan control (w:widowControl) */
  widowControl?: boolean;
  /** Page break before (w:pageBreakBefore) */
  pageBreakBefore?: boolean;
  /** Contextual spacing — suppress space between paragraphs of the same style (w:contextualSpacing) */
  contextualSpacing?: boolean;

  // Numbering/List
  /** Numbering properties (w:numPr) */
  numPr?: {
    /** Numbering definition ID (w:numId) */
    numId?: number;
    /** List level (0-8) (w:ilvl) */
    ilvl?: number;
  };
  /**
   * When `numPr` was resolved from the paragraph STYLE's pPr rather than the
   * paragraph's own `<w:numPr>`, this records the style-sourced value. The
   * serializer omits `numPr` while it still equals this value — writing it as
   * direct formatting would flip Word's indent precedence (a directly
   * referenced level's indents beat the style's; a style-referenced level's
   * do not) and break the document on save/reload. Cleared the moment the
   * user changes the numbering (values diverge).
   */
  numPrFromStyle?: {
    numId?: number;
    ilvl?: number;
  };

  // Outline level (for TOC)
  /** Outline level 0-9 (w:outlineLvl) */
  outlineLevel?: number;

  // Style reference
  /** Paragraph style ID (w:pStyle) */
  styleId?: string;

  // Frame properties
  /** Text frame properties (w:framePr) */
  frame?: {
    width?: number;
    height?: number;
    hAnchor?: 'text' | 'margin' | 'page';
    vAnchor?: 'text' | 'margin' | 'page';
    x?: number;
    y?: number;
    xAlign?: 'left' | 'center' | 'right' | 'inside' | 'outside';
    yAlign?: 'top' | 'center' | 'bottom' | 'inside' | 'outside' | 'inline';
    wrap?: 'around' | 'auto' | 'none' | 'notBeside' | 'through' | 'tight';
  };

  // Suppress
  /** Suppress line numbers (w:suppressLineNumbers) */
  suppressLineNumbers?: boolean;
  /** Suppress auto hyphens (w:suppressAutoHyphens) */
  suppressAutoHyphens?: boolean;

  // Default run properties for this paragraph
  /** Run properties to apply to all runs (w:rPr) */
  runProperties?: TextFormatting;
}
// --- Table shapes and helpers ---------------------------------------------------------
//
// The engine models tables but does not expose an editing surface for them, and this
// change explicitly must not claim table editing. These are the shapes the ported table
// controls name, with STUB helpers: they compute nothing and return empty, so the table
// toolbar renders inert rather than appearing to work.

/** Table rows and cells are required by the adapter operations. */
export interface Table {
  type: 'table';
  /** Table formatting */
  formatting?: TableFormatting;
  /** Table-level tracked property changes (w:tblPrChange) */
  propertyChanges?: TablePropertyChange[];
  /** Column widths in twips */
  columnWidths?: number[];
  /** Table rows */
  rows: TableRow[];
  /**
   * Block-level bookmark markers that sit as direct children of the parent
   * block container immediately BEFORE this table's `w:tbl`, i.e.
   * `<w:bookmarkStart/><w:tbl>`. See {@link Paragraph.leadingBlockMarkers}.
   */
  leadingBlockMarkers?: (BookmarkStart | BookmarkEnd)[];
  /**
   * Block-level bookmark markers that sit immediately AFTER this table's
   * `w:tbl` (e.g. `<w:tbl></w:tbl><w:bookmarkEnd/>`). See
   * {@link Paragraph.leadingBlockMarkers}.
   */
  trailingBlockMarkers?: (BookmarkStart | BookmarkEnd)[];
}

export interface TableRow {
  type: 'tableRow';
  /** Row formatting */
  formatting?: TableRowFormatting;
  /** Row-level tracked property changes (w:trPrChange) */
  propertyChanges?: TableRowPropertyChange[];
  /** Tracked structural changes (row insert/delete) */
  structuralChange?: TableStructuralChangeInfo;
  /** Cells in this row */
  cells: TableCell[];
}

export interface TableCell {
  type: 'tableCell';
  /** Cell formatting */
  formatting?: TableCellFormatting;
  /** Cell-level tracked property changes (w:tcPrChange) */
  propertyChanges?: TableCellPropertyChange[];
  /** Tracked structural changes (cell insert/delete/merge) */
  structuralChange?: TableStructuralChangeInfo;
  /** Cell content (paragraphs, tables, etc.) */
  content: BlockContent[];
}
// --- Table split geometry ---------------------------------------------------------------
//
// The engine exposes no table mutation surface. Keep this compatibility API typed but
// inert so the toolbar cannot compute or imply an edit that Editor.exec cannot apply.
export interface CellAnchor<T> {
  data: T;
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
}

export interface SplitLayoutResult<T> {
  anchors: CellAnchor<T>[];
  deltaRows: number;
  deltaCols: number;
  newRowCount: number;
}

export function buildAnchorMaps<T>(_anchors: CellAnchor<T>[]): {
  byStart: Map<string, CellAnchor<T>>;
  byCoveredSlot: Map<string, CellAnchor<T>>;
} {
  return { byStart: new Map(), byCoveredSlot: new Map() };
}

export function computeSplitDialogDefaults(rowspan: number, colspan: number): TableSplitConfig {
  return {
    minRows: Math.max(1, rowspan),
    minCols: Math.max(1, colspan),
    initialRows: Math.max(1, rowspan),
    initialCols: Math.max(1, colspan),
  };
}

export function computeSplitLayout<T>(
  _anchors: CellAnchor<T>[],
  _target: CellAnchor<T>,
  _rows: number,
  _cols: number,
  _totalRows: number,
  _createSplitCellData: (isOriginal: boolean, rowOffset: number, colOffset: number) => T
): SplitLayoutResult<T> {
  return { anchors: [], deltaRows: 0, deltaCols: 0, newRowCount: 0 };
}

export function redistributeColumnWidths(
  existing: number[],
  _startCol: number,
  _currentSpan: number,
  _targetSpan: number
): number[] {
  return [...existing];
}

/** Compatibility contract for the shared adapter surface. */
export interface TableSplitConfig {
  initialCols: number;
  initialRows: number;
  minCols: number;
  minRows: number;
}

/** Compatibility contract for the shared adapter surface.
 *  named highlight. The map itself is empty until the engine exposes highlight state. */
export const HIGHLIGHT_COLORS: Readonly<Record<string, string>> = {};
export function mapHexToHighlightName(_hex?: string | null): string | undefined {
  return undefined;
}

/** Compatibility contract for the shared adapter surface.
 *  `FontOption[]`. Kept here so the ported controls resolve it from one place. */
export function normalizeFontFamilies(
  fonts?: readonly (string | FontOption)[] | null,
): FontOption[] | undefined {
  if (!fonts) return undefined;
  return fonts.map((f) => (typeof f === 'string' ? { name: f, fontFamily: f } : f));
}


// --- Opaque siblings ------------------------------------------------------------------
//
// `TextFormatting` and `ParagraphFormatting` are copied verbatim above and reference these
// sibling types. The ported controls only pass such values through, so they are declared
// opaque here rather than dragging the legacy core's whole type graph across. Each gets a
// real shape when the corresponding capability lands.
export type UnderlineStyle = string;
export type TextEffect = string;
export type EmphasisMark = string;
export type LineSpacingRule = string;
export interface ShadingProperties { [key: string]: unknown }
export interface BorderSpec { [key: string]: unknown }
/** Compatibility contract for the shared adapter surface. */
export interface TabMark {
  /** Position in twips from left margin */
  position: number;
  /** Alignment at tab stop */
  alignment: TabJustify;
  /** Leader character */
  leader?: TabLeader;
}
export interface ParagraphSpacingOverrides { [key: string]: unknown }

/** Alias under the name `toolbarUtils` imports it. */
export const HIGHLIGHT_HEX_TO_NAME: Readonly<Record<string, string>> = HIGHLIGHT_COLORS;


// Opaque siblings named by the shared table interfaces; the table controls pass them
// through without inspecting them.
/** Table formatting fields consumed by adapter operations. */
export interface TableFormatting {
  /** Table width */
  width?: TableMeasurement;
  /** Table justification */
  justification?: 'left' | 'center' | 'right';
  /** Cell spacing */
  cellSpacing?: TableMeasurement;
  /** Table indent from left margin */
  indent?: TableMeasurement;
  /** Table borders */
  borders?: TableBorders;
  /** Default cell margins */
  cellMargins?: CellMargins;
  /** Table layout */
  layout?: 'fixed' | 'autofit';
  /** Table style ID */
  styleId?: string;
  /** Table look (conditional formatting flags) */
  look?: TableLook;
  /** Shading/background */
  shading?: ShadingProperties;
  /** Overlap for floating tables */
  overlap?: 'never' | 'overlap';
  /** Floating table properties */
  floating?: FloatingTableProperties;
  /** Right to left table */
  bidi?: boolean;
}

export interface TableRowFormatting {
  /** Row height */
  height?: TableMeasurement;
  /** Height rule */
  heightRule?: 'auto' | 'atLeast' | 'exact';
  /** Header row (repeats on each page) */
  header?: boolean;
  /** Allow row to break across pages */
  cantSplit?: boolean;
  /** Row justification */
  justification?: 'left' | 'center' | 'right';
  /** Hidden row */
  hidden?: boolean;
  /** Conditional format style */
  conditionalFormat?: ConditionalFormatStyle;
}

export interface TableCellFormatting {
  /** Cell width */
  width?: TableMeasurement;
  /** Cell borders */
  borders?: TableBorders;
  /** Cell margins (override table default) */
  margins?: CellMargins;
  /** Cell shading/background */
  shading?: ShadingProperties;
  /** Vertical alignment */
  verticalAlign?: 'top' | 'center' | 'bottom';
  /** Text direction */
  textDirection?: 'lr' | 'lrV' | 'rl' | 'rlV' | 'tb' | 'tbV' | 'tbRl' | 'tbRlV' | 'btLr';
  /** Grid span (horizontal merge) */
  gridSpan?: number;
  /** Vertical merge */
  vMerge?: 'restart' | 'continue';
  /** Fit text to cell width */
  fitText?: boolean;
  /** Wrap text */
  noWrap?: boolean;
  /** Hide cell marker */
  hideMark?: boolean;
  /** Conditional format style */
  conditionalFormat?: ConditionalFormatStyle;
}

export interface TableMeasurement {
  /** Value in twips (for dxa) or fifths of a percent (for pct) */
  value: number;
  /** Measurement type */
  type: TableWidthType;
}

export interface TableBorders {
  top?: BorderSpec;
  bottom?: BorderSpec;
  left?: BorderSpec;
  right?: BorderSpec;
  insideH?: BorderSpec;
  insideV?: BorderSpec;
}

export interface TableLook {
  firstColumn?: boolean;
  firstRow?: boolean;
  lastColumn?: boolean;
  lastRow?: boolean;
  noHBand?: boolean;
  noVBand?: boolean;
}
export interface TablePropertyChange { [key: string]: unknown }
export interface TableRowPropertyChange { [key: string]: unknown }
export interface TableCellPropertyChange { [key: string]: unknown }

// Named by the shared table interfaces. Opaque: the ported table controls carry these
// values between engine calls without reading their contents.
export interface BlockContent { [key: string]: unknown }
export interface BookmarkStart { [key: string]: unknown }
export interface BookmarkEnd { [key: string]: unknown }
export interface TableStructuralChangeInfo { [key: string]: unknown }

// Siblings named by the copied table formatting types.
export interface CellMargins {
  top?: TableMeasurement;
  bottom?: TableMeasurement;
  left?: TableMeasurement;
  right?: TableMeasurement;
}

export interface ConditionalFormatStyle {
  /** First row */
  firstRow?: boolean;
  /** Last row */
  lastRow?: boolean;
  /** First column */
  firstColumn?: boolean;
  /** Last column */
  lastColumn?: boolean;
  /** Odd horizontal band */
  oddHBand?: boolean;
  /** Even horizontal band */
  evenHBand?: boolean;
  /** Odd vertical band */
  oddVBand?: boolean;
  /** Even vertical band */
  evenVBand?: boolean;
  /** Northwest corner */
  nwCell?: boolean;
  /** Northeast corner */
  neCell?: boolean;
  /** Southwest corner */
  swCell?: boolean;
  /** Southeast corner */
  seCell?: boolean;
}

export interface FloatingTableProperties {
  /** Horizontal anchor */
  horzAnchor?: 'margin' | 'page' | 'text';
  /** Vertical anchor */
  vertAnchor?: 'margin' | 'page' | 'text';
  /** Horizontal position */
  tblpX?: number;
  tblpXSpec?: 'left' | 'center' | 'right' | 'inside' | 'outside';
  /** Vertical position */
  tblpY?: number;
  tblpYSpec?: 'top' | 'center' | 'bottom' | 'inside' | 'outside' | 'inline';
  /** Distance from surrounding text */
  topFromText?: number;
  bottomFromText?: number;
  leftFromText?: number;
  rightFromText?: number;
}

export type TableWidthType = 'auto' | 'dxa' | 'nil' | 'pct';

// --- Shell shapes ---------------------------------------------------------------------

/** Compatibility contract for the shared adapter surface. */
export interface HeadingInfo {
  /** The text content of the heading */
  text: string;
  /** Outline level (0 = Heading 1, 1 = Heading 2, etc.) */
  level: number;
  /** ProseMirror document position of the paragraph node */
  pmPos: number;
}

/** Compatibility contract for the shared adapter surface.
 *  these fields (page width, margins), so an opaque shape produced 25 type errors — the
 *  fifth time in this port that a hand-written shape failed where the real one works. */
export interface SectionProperties {
  // Page size
  /** Page width in twips */
  pageWidth?: number;
  /** Page height in twips */
  pageHeight?: number;
  /** Page orientation */
  orientation?: PageOrientation;

  // Margins
  /** Top margin in twips */
  marginTop?: number;
  /** Bottom margin in twips */
  marginBottom?: number;
  /** Left margin in twips */
  marginLeft?: number;
  /** Right margin in twips */
  marginRight?: number;
  /** Header distance from top in twips */
  headerDistance?: number;
  /** Footer distance from bottom in twips */
  footerDistance?: number;
  /** Gutter margin in twips */
  gutter?: number;

  // Columns
  /** Number of columns */
  columnCount?: number;
  /** Space between columns in twips */
  columnSpace?: number;
  /** Equal width columns */
  equalWidth?: boolean;
  /** Separator line between columns */
  separator?: boolean;
  /** Individual column definitions */
  columns?: Column[];
  /**
   * Number of columns the footnote area is laid out in (`w15:footnoteColumns`).
   * Word's "Footnote layout → Columns" setting, independent of the body column
   * count above. Undefined/1 means the footnote area follows the body (single
   * column for a single-column section). See ECMA-376 + the w15 extension.
   */
  footnoteColumns?: number;

  // Section behavior
  /** Section start type */
  sectionStart?: SectionStart;
  /** Vertical alignment of text */
  verticalAlign?: VerticalAlign;
  /** Right-to-left section */
  bidi?: boolean;

  // Headers and footers
  /** Header references */
  headerReferences?: HeaderReference[];
  /** Footer references */
  footerReferences?: FooterReference[];
  /** Different first page header/footer */
  titlePg?: boolean;
  /** Different odd/even page headers/footers */
  evenAndOddHeaders?: boolean;

  // Line numbers
  /** Line numbering settings */
  lineNumbers?: {
    start?: number;
    countBy?: number;
    distance?: number;
    restart?: LineNumberRestart;
  };
  /** Page numbering settings (`w:pgNumType`). */
  pageNumbers?: {
    start?: number;
    format?: string;
    chapterStyle?: number;
    chapterSeparator?: string;
  };

  // Page borders
  /** Page borders */
  pageBorders?: {
    top?: BorderSpec;
    bottom?: BorderSpec;
    left?: BorderSpec;
    right?: BorderSpec;
    /** Display setting */
    display?: 'allPages' | 'firstPage' | 'notFirstPage';
    /** Offset from */
    offsetFrom?: 'page' | 'text';
    /** Z-order */
    zOrder?: 'front' | 'back';
  };

  // Background
  /** Page background */
  background?: {
    color?: ColorValue;
    themeColor?: ThemeColorSlot;
    themeTint?: string;
    themeShade?: string;
  };

  // Footnote/Endnote properties
  /** Footnote properties for this section */
  footnotePr?: FootnoteProperties;
  /** Endnote properties for this section */
  endnotePr?: EndnoteProperties;

  // Document grid
  /** Document grid */
  docGrid?: {
    type?: 'default' | 'lines' | 'linesAndChars' | 'snapToChars';
    linePitch?: number;
    charSpace?: number;
  };

  // Paper source
  /** First page paper source */
  paperSrcFirst?: number;
  /** Other pages paper source */
  paperSrcOther?: number;
}

/** STUB — tracked changes are not modelled by the engine, so the shell always receives
 *  an empty result and renders no tracked-change chrome. Shape follows the legacy
 *  `extractTrackedChanges` result. */
/** Compatibility contract for the shared adapter surface. */
export interface TrackedChangeEntry {
  /**
   * Revision shape. Inline shapes (`insertion`, `deletion`, `replacement`)
   * wrap text runs; the rest are structural revisions on node attrs.
   *
   * - `insertion` — text was added (`<w:ins>`).
   * - `deletion` — text was struck through but not removed (`<w:del>`).
   * - `replacement` — an adjacent deletion + insertion carrying the same
   *   revision identity; sidebar shows one combined card. `deletedText`
   *   and `insertionRevisionId` are set on this variant.
   * - `paragraphMarkInsertion` / `paragraphMarkDeletion` — Enter /
   *   Backspace produced a tracked paragraph break (`<w:pPr><w:rPr><w:ins/>` /
   *   `<w:del/>`).
   * - `paragraphPropertiesChanged` — formatting (alignment, spacing,
   *   etc.) on the paragraph was changed (`<w:pPrChange>`).
   * - `runPropertiesChanged` — formatting on an exact text run was changed
   *   (`<w:rPrChange>`).
   * - `rowInserted` / `rowDeleted` / `rowPropertiesChanged` — table
   *   row authored / removed / formatted (`<w:trPr><w:ins/>` / `<w:del/>`
   *   / `<w:trPrChange>`).
   * - `cellInserted` / `cellDeleted` / `cellMerged` /
   *   `cellPropertiesChanged` — per-cell revisions
   *   (`<w:cellIns>` / `<w:cellDel>` / `<w:cellMerge>` / `<w:tcPrChange>`).
   * - `tablePropertiesChanged` — table-level formatting
   *   (`<w:tblPrChange>`).
   */
  type:
    | 'insertion'
    | 'deletion'
    | 'replacement'
    | 'paragraphMarkInsertion'
    | 'paragraphMarkDeletion'
    | 'paragraphPropertiesChanged'
    | 'runPropertiesChanged'
    | 'rowInserted'
    | 'rowDeleted'
    | 'rowPropertiesChanged'
    | 'cellInserted'
    | 'cellDeleted'
    | 'cellMerged'
    | 'cellPropertiesChanged'
    | 'tableInserted'
    | 'tableDeleted'
    | 'tablePropertiesChanged';
  /**
   * Affected text. For inline types this is the run's text; for
   * structural types it's the surrounding paragraph / cell content
   * (truncated by the sidebar before display).
   */
  text: string;
  /**
   * Only set when `type === 'replacement'` — the text the user removed.
   * The inserted text lives in {@link TrackedChangeEntry.text}.
   */
  deletedText?: string;
  /** Author that minted the revision (`w:author`). */
  author: string;
  /** ISO timestamp the revision was minted (`w:date`). May be undefined for legacy imports. */
  date?: string;
  /**
   * Document position where the revision starts. For inline types this
   * is the start of the marked text run; for structural types it's the
   * containing paragraph / row / cell / table node's start position.
   * Used by the sidebar to anchor the card at the correct vertical
   * offset.
   */
  from: number;
  /**
   * Document position where the revision ends. For inline coalesced
   * runs that span multiple paragraphs, this is the END position of the
   * LAST run in the group; the intervening structural positions are not
   * preserved.
   */
  to: number;
  /**
   * The `w:id` of the revision. Pass to
   * {@link acceptChangeById} / {@link rejectChangeById} to resolve every
   * site sharing this id — including pPrIns paragraph attrs and
   * subsequent typed runs in the same editing session.
   */
  revisionId: number;
  /**
   * Only set when `type === 'replacement'`. Editor-authored replacements
   * normally share one id, but this remains available for explicitly linked
   * legacy replacements whose insertion half has a distinct id.
   */
  insertionRevisionId?: number;
  /**
   * Extra `w:id`s that map to the same logical revision as this card.
   * Populated only for structural revisions that intentionally group several
   * OOXML ids (for example, all rows of one inserted table). Inline revisions
   * remain independently actionable by `w:id`.
   */
  coalescedRevisionIds?: number[];
}

/** STUB result — tracked changes are not modelled by the engine, so the shell always
 *  receives an empty set and renders no tracked-change chrome. */
export interface TrackedChangesResult {
  entries: TrackedChangeEntry[];
  commentRevisions?: Map<string, string>;
}

// --- Unit conversion ------------------------------------------------------------------
//
// COPIED verbatim from the legacy core's `utils/units.ts`. The rulers convert twips to
// pixels on every tick, and an approximated constant here would misplace every mark on
// the scale.

/** Twips per inch (1 inch = 1440 twips) */
export const TWIPS_PER_INCH = 1440;
const STANDARD_DPI = 96;
export const PIXELS_PER_INCH = STANDARD_DPI;

export function twipsToPixels(twips: number): number {
  return (twips / TWIPS_PER_INCH) * PIXELS_PER_INCH;
}

export function pixelsToTwips(px: number): number {
  return (px / PIXELS_PER_INCH) * TWIPS_PER_INCH;
}

export function roundPixels(px: number, decimalPlaces: number = 2): number {
  const factor = Math.pow(10, decimalPlaces);
  return Math.round(px * factor) / factor;
}

export function formatPx(px: number): string {
  return `${roundPixels(px)}px`;
}

// Shared adapter presentation and compatibility behavior.
// types — the rulers read page size, orientation and margins through them.
export interface Column {
  /** Column width in twips */
  width?: number;
  /** Space after column in twips */
  space?: number;
}

export interface EndnoteProperties {
  position?: EndnotePosition;
  numFmt?: NumberFormat;
  numStart?: number;
  numRestart?: NoteNumberRestart;
}

export interface FooterReference {
  type: HeaderFooterType;
  rId: string;
}

export interface FootnoteProperties {
  position?: FootnotePosition;
  numFmt?: NumberFormat;
  numStart?: number;
  numRestart?: NoteNumberRestart;
}

export interface HeaderReference {
  type: HeaderFooterType;
  rId: string;
}

export type LineNumberRestart = 'continuous' | 'newPage' | 'newSection';

export type PageOrientation = 'portrait' | 'landscape';

export type SectionStart = 'continuous' | 'nextPage' | 'oddPage' | 'evenPage' | 'nextColumn';

export type VerticalAlign = 'top' | 'center' | 'both' | 'bottom';

// Siblings named by the shared section/footnote types.
export type EndnotePosition = 'sectEnd' | 'docEnd';
export type FootnotePosition = 'pageBottom' | 'beneathText' | 'sectEnd' | 'docEnd';
export type HeaderFooterType = 'default' | 'first' | 'even';
export type NoteNumberRestart = 'continuous' | 'eachSect' | 'eachPage';


// Named by the shared TabMark.
export type TabJustify = 'left' | 'center' | 'right' | 'decimal' | 'bar' | 'clear' | 'num';
export type TabLeader = 'none' | 'dot' | 'hyphen' | 'underscore' | 'heavy' | 'middleDot';


// --- Colour resolution: PORTED, not stubbed --------------------------------------------
//
// `utils/colorResolver.ts` from the legacy core is a pure function over theme data — its
// only import is type-only — so it is used directly rather than being stubbed. That
// restores real theme tint/shade matrices in the colour picker, real highlight mapping,
// and real hex resolution, none of which needed engine state after all.
export {
  resolveColor,
  resolveColorToHex,
  resolveHighlightColor,
  resolveShadingColor,
  getThemeTintShadeHex,
  generateThemeTintShadeMatrix,
  colorsEqual,
  parseColorString,
  ensureHexPrefix,
  resolveHighlightToCss,
} from './lib/colorResolver';


// --- List state: PORTED, not stubbed ---------------------------------------------------
//
// `utils/listState.ts` from the legacy core has NO imports at all — 58 lines of pure
// predicates and constructors — so it is used directly. The interim stubs answered "not a list"
// unconditionally; these answer correctly for whatever state the caller holds.
export * from './lib/listState';

// --- Ported pure modules ----------------------------------------------------------------
//
// These were stubbed until an audit against the legacy source showed each is pure — five
// of the six have NO imports at all. Re-exported here so the ported controls resolve the
// real implementations through the same module path they already import from.
//
// Order matters: a local declaration shadows a star-export, so nothing above may declare
// a name these modules provide.
export * from './lib/stylePreview';
export * from './lib/fontOptions';
export * from './lib/highlightColors';
export * from './lib/colorResolver';
