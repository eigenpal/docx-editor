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
  [key: string]: unknown;
}
export interface Theme {
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

/** Copied verbatim from the legacy core. */
export function halfPointsToPoints(halfPoints: number): number {
  return halfPoints / 2;
}

/** STUB — the engine exposes no theme colour scheme yet, so the picker shows its
 *  standard palette and no theme row, rather than a fabricated one. */
export function generateThemeTintShadeMatrix(_scheme?: ThemeColorScheme | null): ThemeMatrixCell[][] {
  return [];
}

/** STUB — no style preview data on the engine yet; the picker falls back to plain text. */
export function getStylePreviewProps(_style?: { styleId: string } | null): Record<string, unknown> {
  return {};
}

// List state. The engine exposes no list state, so every predicate answers "not a list"
// and the constructors produce inert values. The list buttons therefore render inactive
// instead of claiming a list the document may not have.
export const createDefaultListState = (): ListState => ({ type: 'none', level: 0, isInList: false });
export const createBulletListState = (): ListState => ({ type: 'bullet', level: 0, isInList: true });
export const createNumberedListState = (): ListState => ({ type: 'numbered', level: 0, isInList: true });
export const isAnyListState = (s?: ListState | null): boolean => !!s?.isInList;
export const isBulletListState = (s?: ListState | null): boolean => s?.type === 'bullet';
export const isNumberedListState = (s?: ListState | null): boolean => s?.type === 'numbered';

/** STUB — no colour resolution against the document theme yet; a bare hex passes
 *  through and a themed reference yields its rgb, never a guessed theme colour. */
/** Compatibility contract for the shared adapter surface.
 *  makes the return non-optional — my one-arg version returned `string | undefined` and
 *  the ported ColorPicker failed against it. */
export function resolveColor(
  color: ColorValue | undefined | null,
  _theme?: Theme | null,
  defaultColor: string = '000000',
): string {
  if (!color || color.auto) return defaultColor;
  return color.rgb ?? defaultColor;
}

// `TranslationKey` deliberately NOT declared here. Aliasing it to `string` shadowed the
// real union derived from `en.json` and broke every `t(labelKey)` call; the keys the
// ported controls use (alignment.*, lineSpacing.*) already exist in the catalogue, so
// controls import the real type from `../../i18n`.
export const getNextIndentLevel = (level?: number): number => Math.min((level ?? 0) + 1, 8);
export const getPreviousIndentLevel = (level?: number): number => Math.max((level ?? 0) - 1, 0);

/** Compatibility contract for the shared adapter surface. */
export function pointsToHalfPoints(points: number): number {
  return Math.round(points * 2);
}

/** STUB — the engine exposes no highlight palette resolution; the raw value passes
 *  through so a document colour is never replaced by a guessed one. */
export function resolveHighlightColor(value?: string | null): string | undefined {
  return value ?? undefined;
}

/**
 * Signature copied from the legacy core (`color`, `theme`). STUB body: with no theme
 * resolution on the engine, a literal colour passes through and a theme-bound one yields
 * its rgb — never a colour invented from a theme we cannot read.
 */
export function resolveColorToHex(
  color: ColorValue | undefined | null,
  _theme?: Theme | null,
): string | undefined {
  if (!color || color.auto) return undefined;
  return color.rgb;
}

/** STUB — no document style inventory on the engine yet, so the style picker shows
 *  whatever the caller passes and nothing is synthesized. */
/** Compatibility contract for the shared adapter surface.
 *  `StyleOption[]` depends on; returning the raw `Style` (optional name) broke it. */
export interface ResolvedStyleOption {
  styleId: string;
  name: string;
  priority: number;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
}

/** Signature copied from the legacy core; filters to paragraph styles as it does. */
export function resolveParagraphStyleOptions(styles: Style[] | undefined): ResolvedStyleOption[] {
  if (!styles || styles.length === 0) return [];
  return styles
    .filter((s) => s.type === 'paragraph')
    .map((s, i) => ({ styleId: s.styleId, name: s.name ?? s.styleId, priority: i }));
}

/** Copied shape from the legacy core: cycles a list type without engine state. */
export function toggleListType(state: ListState, type: ListType): ListState {
  return state.type === type
    ? { ...state, type: 'none', isInList: false }
    : { ...state, type, isInList: true };
}
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
export interface TabMark { [key: string]: unknown }
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
