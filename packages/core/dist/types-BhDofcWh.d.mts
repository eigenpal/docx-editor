/**
 * Color & Styling Primitives
 *
 * Basic types used throughout OOXML for colors, borders, and shading.
 */
/**
 * Theme color slots from theme1.xml
 */
type ThemeColorSlot = 'dk1' | 'lt1' | 'dk2' | 'lt2' | 'accent1' | 'accent2' | 'accent3' | 'accent4' | 'accent5' | 'accent6' | 'hlink' | 'folHlink' | 'background1' | 'text1' | 'background2' | 'text2';
/**
 * Color value - can be direct RGB, theme reference, or auto
 */
interface ColorValue {
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
/**
 * Border specification for any border (paragraph, table, page)
 */
interface BorderSpec {
    /** Border style */
    style: 'none' | 'single' | 'double' | 'dotted' | 'dashed' | 'thick' | 'triple' | 'thinThickSmallGap' | 'thickThinSmallGap' | 'thinThickMediumGap' | 'thickThinMediumGap' | 'thinThickLargeGap' | 'thickThinLargeGap' | 'wave' | 'doubleWave' | 'dashSmallGap' | 'dashDotStroked' | 'threeDEmboss' | 'threeDEngrave' | 'outset' | 'inset' | 'nil';
    /** Color of the border */
    color?: ColorValue;
    /** Width in eighths of a point (1/8 pt) */
    size?: number;
    /** Spacing from text in points */
    space?: number;
    /** Shadow effect */
    shadow?: boolean;
    /** Frame effect */
    frame?: boolean;
}
/**
 * Shading/background properties
 */
interface ShadingProperties {
    /** Pattern fill color */
    color?: ColorValue;
    /** Background fill color */
    fill?: ColorValue;
    /** Shading pattern type */
    pattern?: 'clear' | 'solid' | 'horzStripe' | 'vertStripe' | 'reverseDiagStripe' | 'diagStripe' | 'horzCross' | 'diagCross' | 'thinHorzStripe' | 'thinVertStripe' | 'thinReverseDiagStripe' | 'thinDiagStripe' | 'thinHorzCross' | 'thinDiagCross' | 'pct5' | 'pct10' | 'pct12' | 'pct15' | 'pct20' | 'pct25' | 'pct30' | 'pct35' | 'pct37' | 'pct40' | 'pct45' | 'pct50' | 'pct55' | 'pct60' | 'pct62' | 'pct65' | 'pct70' | 'pct75' | 'pct80' | 'pct85' | 'pct87' | 'pct90' | 'pct95' | 'nil';
}

/**
 * Text, Paragraph, and Table Formatting Types
 *
 * Properties that control how text, paragraphs, and table structures
 * are formatted in OOXML (w:rPr, w:pPr, w:tblPr, etc.).
 */

/**
 * Underline style options
 */
type UnderlineStyle = 'none' | 'single' | 'words' | 'double' | 'thick' | 'dotted' | 'dottedHeavy' | 'dash' | 'dashedHeavy' | 'dashLong' | 'dashLongHeavy' | 'dotDash' | 'dashDotHeavy' | 'dotDotDash' | 'dashDotDotHeavy' | 'wave' | 'wavyHeavy' | 'wavyDouble';
/**
 * Text effect animations
 */
type TextEffect = 'none' | 'blinkBackground' | 'lights' | 'antsBlack' | 'antsRed' | 'shimmer' | 'sparkle';
/**
 * Emphasis mark type
 */
type EmphasisMark = 'none' | 'dot' | 'comma' | 'circle' | 'underDot';
/**
 * Complete text formatting properties (w:rPr)
 */
interface TextFormatting {
    /** Bold (w:b) */
    bold?: boolean;
    /** Bold complex script (w:bCs) */
    boldCs?: boolean;
    /** Italic (w:i) */
    italic?: boolean;
    /** Italic complex script (w:iCs) */
    italicCs?: boolean;
    /** Underline style and color (w:u) */
    underline?: {
        style: UnderlineStyle;
        color?: ColorValue;
    };
    /** Strikethrough (w:strike) */
    strike?: boolean;
    /** Double strikethrough (w:dstrike) */
    doubleStrike?: boolean;
    /** Superscript/subscript (w:vertAlign) */
    vertAlign?: 'baseline' | 'superscript' | 'subscript';
    /** Small caps (w:smallCaps) */
    smallCaps?: boolean;
    /** All caps (w:caps) */
    allCaps?: boolean;
    /** Hidden text (w:vanish) */
    hidden?: boolean;
    /** Text color (w:color) */
    color?: ColorValue;
    /** Highlight/background color (w:highlight) */
    highlight?: 'black' | 'blue' | 'cyan' | 'darkBlue' | 'darkCyan' | 'darkGray' | 'darkGreen' | 'darkMagenta' | 'darkRed' | 'darkYellow' | 'green' | 'lightGray' | 'magenta' | 'none' | 'red' | 'white' | 'yellow';
    /** Character shading (w:shd) */
    shading?: ShadingProperties;
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
        asciiTheme?: 'majorAscii' | 'majorHAnsi' | 'majorEastAsia' | 'majorBidi' | 'minorAscii' | 'minorHAnsi' | 'minorEastAsia' | 'minorBidi';
        hAnsiTheme?: string;
        eastAsiaTheme?: string;
        csTheme?: string;
    };
    /** Character spacing in twips (w:spacing) */
    spacing?: number;
    /** Raised/lowered text position in half-points (w:position) */
    position?: number;
    /** Horizontal text scale percentage (w:w) */
    scale?: number;
    /** Kerning threshold in half-points (w:kern) */
    kerning?: number;
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
    /** Right-to-left text (w:rtl) */
    rtl?: boolean;
    /** Complex script formatting (w:cs) */
    cs?: boolean;
    /** Character style ID (w:rStyle) */
    styleId?: string;
}
/**
 * Tab stop alignment
 */
type TabStopAlignment = 'left' | 'center' | 'right' | 'decimal' | 'bar' | 'clear' | 'num';
/**
 * Tab leader character
 */
type TabLeader = 'none' | 'dot' | 'hyphen' | 'underscore' | 'heavy' | 'middleDot';
/**
 * Tab stop definition
 */
interface TabStop {
    /** Position in twips from left margin */
    position: number;
    /** Alignment at tab stop */
    alignment: TabStopAlignment;
    /** Leader character */
    leader?: TabLeader;
}
/**
 * Line spacing rule
 */
type LineSpacingRule = 'auto' | 'exact' | 'atLeast';
/**
 * Paragraph alignment/justification
 */
type ParagraphAlignment = 'left' | 'center' | 'right' | 'both' | 'distribute' | 'mediumKashida' | 'highKashida' | 'lowKashida' | 'thaiDistribute';
/**
 * Complete paragraph formatting properties (w:pPr)
 */
interface ParagraphFormatting {
    /** Paragraph alignment (w:jc) */
    alignment?: ParagraphAlignment;
    /** Text direction (w:bidi) */
    bidi?: boolean;
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
    /** Left indent in twips (w:ind/@w:left) */
    indentLeft?: number;
    /** Right indent in twips (w:ind/@w:right) */
    indentRight?: number;
    /** First line indent in twips - positive for indent, negative for hanging (w:ind/@w:firstLine or @w:hanging) */
    indentFirstLine?: number;
    /** Whether first line is hanging indent */
    hangingIndent?: boolean;
    /** Paragraph borders (w:pBdr) */
    borders?: {
        top?: BorderSpec;
        bottom?: BorderSpec;
        left?: BorderSpec;
        right?: BorderSpec;
        between?: BorderSpec;
        bar?: BorderSpec;
    };
    /** Paragraph shading (w:shd) */
    shading?: ShadingProperties;
    /** Custom tab stops (w:tabs) */
    tabs?: TabStop[];
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
    /** Numbering properties (w:numPr) */
    numPr?: {
        /** Numbering definition ID (w:numId) */
        numId?: number;
        /** List level (0-8) (w:ilvl) */
        ilvl?: number;
    };
    /** Outline level 0-9 (w:outlineLvl) */
    outlineLevel?: number;
    /** Paragraph style ID (w:pStyle) */
    styleId?: string;
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
    /** Suppress line numbers (w:suppressLineNumbers) */
    suppressLineNumbers?: boolean;
    /** Suppress auto hyphens (w:suppressAutoHyphens) */
    suppressAutoHyphens?: boolean;
    /** Run properties to apply to all runs (w:rPr) */
    runProperties?: TextFormatting;
}
/**
 * Table width type
 */
type TableWidthType = 'auto' | 'dxa' | 'nil' | 'pct';
/**
 * Table measurement (width or height)
 */
interface TableMeasurement {
    /** Value in twips (for dxa) or fifths of a percent (for pct) */
    value: number;
    /** Measurement type */
    type: TableWidthType;
}
/**
 * Table borders
 */
interface TableBorders {
    top?: BorderSpec;
    bottom?: BorderSpec;
    left?: BorderSpec;
    right?: BorderSpec;
    insideH?: BorderSpec;
    insideV?: BorderSpec;
}
/**
 * Cell margins
 */
interface CellMargins {
    top?: TableMeasurement;
    bottom?: TableMeasurement;
    left?: TableMeasurement;
    right?: TableMeasurement;
}
/**
 * Table look flags (for table styles)
 */
interface TableLook {
    firstColumn?: boolean;
    firstRow?: boolean;
    lastColumn?: boolean;
    lastRow?: boolean;
    noHBand?: boolean;
    noVBand?: boolean;
}
/**
 * Floating table properties
 */
interface FloatingTableProperties {
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
/**
 * Table formatting properties (w:tblPr)
 */
interface TableFormatting {
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
/**
 * Table row formatting properties (w:trPr)
 */
interface TableRowFormatting {
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
/**
 * Conditional format style
 */
interface ConditionalFormatStyle {
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
/**
 * Table cell formatting properties (w:tcPr)
 */
interface TableCellFormatting {
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

/**
 * Lists & Numbering Types
 *
 * Types for bullet lists, numbered lists, and numbering definitions.
 */

/**
 * Number format type
 */
type NumberFormat = 'decimal' | 'upperRoman' | 'lowerRoman' | 'upperLetter' | 'lowerLetter' | 'ordinal' | 'cardinalText' | 'ordinalText' | 'hex' | 'chicago' | 'ideographDigital' | 'japaneseCounting' | 'aiueo' | 'iroha' | 'decimalFullWidth' | 'decimalHalfWidth' | 'japaneseLegal' | 'japaneseDigitalTenThousand' | 'decimalEnclosedCircle' | 'decimalFullWidth2' | 'aiueoFullWidth' | 'irohaFullWidth' | 'decimalZero' | 'bullet' | 'ganada' | 'chosung' | 'decimalEnclosedFullstop' | 'decimalEnclosedParen' | 'decimalEnclosedCircleChinese' | 'ideographEnclosedCircle' | 'ideographTraditional' | 'ideographZodiac' | 'ideographZodiacTraditional' | 'taiwaneseCounting' | 'ideographLegalTraditional' | 'taiwaneseCountingThousand' | 'taiwaneseDigital' | 'chineseCounting' | 'chineseLegalSimplified' | 'chineseCountingThousand' | 'koreanDigital' | 'koreanCounting' | 'koreanLegal' | 'koreanDigital2' | 'vietnameseCounting' | 'russianLower' | 'russianUpper' | 'none' | 'numberInDash' | 'hebrew1' | 'hebrew2' | 'arabicAlpha' | 'arabicAbjad' | 'hindiVowels' | 'hindiConsonants' | 'hindiNumbers' | 'hindiCounting' | 'thaiLetters' | 'thaiNumbers' | 'thaiCounting';
/**
 * Multi-level suffix (what follows the number)
 */
type LevelSuffix = 'tab' | 'space' | 'nothing';
/**
 * List level definition
 */
interface ListLevel {
    /** Level index (0-8) */
    ilvl: number;
    /** Starting number */
    start?: number;
    /** Number format */
    numFmt: NumberFormat;
    /** Level text (e.g., "%1." or "•") */
    lvlText: string;
    /** Justification */
    lvlJc?: 'left' | 'center' | 'right';
    /** Suffix after number */
    suffix?: LevelSuffix;
    /** Paragraph properties for this level */
    pPr?: ParagraphFormatting;
    /** Run properties for the number/bullet */
    rPr?: TextFormatting;
    /** Restart numbering from higher level */
    lvlRestart?: number;
    /** Is legal numbering style */
    isLgl?: boolean;
    /** Legacy settings */
    legacy?: {
        legacy?: boolean;
        legacySpace?: number;
        legacyIndent?: number;
    };
}
/**
 * Abstract numbering definition (w:abstractNum)
 */
interface AbstractNumbering {
    /** Abstract numbering ID */
    abstractNumId: number;
    /** Multi-level type */
    multiLevelType?: 'hybridMultilevel' | 'multilevel' | 'singleLevel';
    /** Numbering style link */
    numStyleLink?: string;
    /** Style link */
    styleLink?: string;
    /** Level definitions */
    levels: ListLevel[];
    /** Name */
    name?: string;
}
/**
 * Numbering instance (w:num)
 */
interface NumberingInstance {
    /** Numbering ID (referenced by paragraphs) */
    numId: number;
    /** Reference to abstract numbering */
    abstractNumId: number;
    /** Level overrides */
    levelOverrides?: Array<{
        ilvl: number;
        startOverride?: number;
        lvl?: ListLevel;
    }>;
}
/**
 * Computed list rendering info
 */
interface ListRendering {
    /** Computed marker text (e.g., "1.", "a)", "•") */
    marker: string;
    /** List level (0-8) */
    level: number;
    /** Numbering ID */
    numId: number;
    /** Whether this is a bullet or numbered list */
    isBullet: boolean;
    /** Number format type (decimal, lowerRoman, upperRoman, etc.) */
    numFmt?: NumberFormat;
    /** Whether the list marker is hidden (w:vanish on level rPr) */
    markerHidden?: boolean;
    /** Marker font family from numbering level rPr (ascii name) */
    markerFontFamily?: string;
    /** Marker font size from numbering level rPr, in points */
    markerFontSize?: number;
}
/**
 * Complete numbering definitions
 */
interface NumberingDefinitions {
    /** Abstract numbering definitions */
    abstractNums: AbstractNumbering[];
    /** Numbering instances */
    nums: NumberingInstance[];
}

/**
 * Document Content Model
 *
 * All content-bearing types: runs, hyperlinks, bookmarks, fields,
 * images, shapes, tables, lists, paragraphs, headers/footers,
 * footnotes/endnotes, and sections.
 *
 * These types form a deeply interrelated tree (Paragraph ↔ Table ↔ ShapeTextBody)
 * and are kept together to avoid circular import issues.
 */

/**
 * Plain text content
 */
interface TextContent {
    type: 'text';
    /** The text string */
    text: string;
    /** Preserve whitespace (xml:space="preserve") */
    preserveSpace?: boolean;
}
/**
 * Tab character
 */
interface TabContent {
    type: 'tab';
}
/**
 * Line break
 */
interface BreakContent {
    type: 'break';
    /** Break type */
    breakType?: 'page' | 'column' | 'textWrapping';
    /** Clear type for text wrapping break */
    clear?: 'none' | 'left' | 'right' | 'all';
}
/**
 * Symbol character (special font character)
 */
interface SymbolContent {
    type: 'symbol';
    /** Font name */
    font: string;
    /** Character code */
    char: string;
}
/**
 * Footnote or endnote reference
 */
interface NoteReferenceContent {
    type: 'footnoteRef' | 'endnoteRef';
    /** Note ID */
    id: number;
}
/**
 * Field character (begin/separate/end)
 */
interface FieldCharContent {
    type: 'fieldChar';
    /** Field character type */
    charType: 'begin' | 'separate' | 'end';
    /** Field is locked */
    fldLock?: boolean;
    /** Field is dirty (needs update) */
    dirty?: boolean;
}
/**
 * Field instruction text
 */
interface InstrTextContent {
    type: 'instrText';
    /** Field instruction */
    text: string;
}
/**
 * Soft hyphen
 */
interface SoftHyphenContent {
    type: 'softHyphen';
}
/**
 * Non-breaking hyphen
 */
interface NoBreakHyphenContent {
    type: 'noBreakHyphen';
}
/**
 * Drawing/image reference
 */
interface DrawingContent {
    type: 'drawing';
    /** Image data */
    image: Image;
}
/**
 * Shape reference
 */
interface ShapeContent {
    type: 'shape';
    /** Shape data */
    shape: Shape;
}
/**
 * All possible run content types
 */
type RunContent = TextContent | TabContent | BreakContent | SymbolContent | NoteReferenceContent | FieldCharContent | InstrTextContent | SoftHyphenContent | NoBreakHyphenContent | DrawingContent | ShapeContent;
/**
 * A run is a contiguous region of text with the same formatting
 */
interface Run {
    type: 'run';
    /** Text formatting properties */
    formatting?: TextFormatting;
    /** Run-level tracked property changes (w:rPrChange) */
    propertyChanges?: RunPropertyChange[];
    /** Run content (text, tabs, breaks, etc.) */
    content: RunContent[];
}
/**
 * Hyperlink (w:hyperlink)
 */
interface Hyperlink {
    type: 'hyperlink';
    /** Relationship ID for external link */
    rId?: string;
    /** Resolved URL (from relationships) */
    href?: string;
    /** Internal bookmark anchor */
    anchor?: string;
    /** Tooltip text */
    tooltip?: string;
    /** Target frame */
    target?: string;
    /** Link history tracking */
    history?: boolean;
    /** Document location */
    docLocation?: string;
    /** Child runs */
    children: (Run | BookmarkStart | BookmarkEnd)[];
}
/**
 * Bookmark start marker (w:bookmarkStart)
 */
interface BookmarkStart {
    type: 'bookmarkStart';
    /** Bookmark ID */
    id: number;
    /** Bookmark name */
    name: string;
    /** Column index for table bookmarks */
    colFirst?: number;
    colLast?: number;
}
/**
 * Bookmark end marker (w:bookmarkEnd)
 */
interface BookmarkEnd {
    type: 'bookmarkEnd';
    /** Bookmark ID */
    id: number;
}
/**
 * Known field types
 */
type FieldType = 'PAGE' | 'NUMPAGES' | 'NUMWORDS' | 'NUMCHARS' | 'DATE' | 'TIME' | 'CREATEDATE' | 'SAVEDATE' | 'PRINTDATE' | 'AUTHOR' | 'TITLE' | 'SUBJECT' | 'KEYWORDS' | 'COMMENTS' | 'FILENAME' | 'FILESIZE' | 'TEMPLATE' | 'DOCPROPERTY' | 'DOCVARIABLE' | 'REF' | 'PAGEREF' | 'NOTEREF' | 'HYPERLINK' | 'TOC' | 'TOA' | 'INDEX' | 'SEQ' | 'STYLEREF' | 'AUTONUM' | 'AUTONUMLGL' | 'AUTONUMOUT' | 'IF' | 'MERGEFIELD' | 'NEXT' | 'NEXTIF' | 'ASK' | 'SET' | 'QUOTE' | 'INCLUDETEXT' | 'INCLUDEPICTURE' | 'SYMBOL' | 'ADVANCE' | 'EDITTIME' | 'REVNUM' | 'SECTION' | 'SECTIONPAGES' | 'USERADDRESS' | 'USERNAME' | 'USERINITIALS' | 'UNKNOWN';
/**
 * Simple field (w:fldSimple)
 */
interface SimpleField {
    type: 'simpleField';
    /** Field instruction (e.g., "PAGE \\* MERGEFORMAT") */
    instruction: string;
    /** Parsed field type */
    fieldType: FieldType;
    /** Current display value */
    content: (Run | Hyperlink)[];
    /** Field is locked */
    fldLock?: boolean;
    /** Field is dirty */
    dirty?: boolean;
}
/**
 * Complex field (w:fldChar begin/separate/end with w:instrText)
 */
interface ComplexField {
    type: 'complexField';
    /** Field instruction */
    instruction: string;
    /** Parsed field type */
    fieldType: FieldType;
    /** Field code runs */
    fieldCode: Run[];
    /** Display result runs */
    fieldResult: Run[];
    /** Field is locked */
    fldLock?: boolean;
    /** Field is dirty */
    dirty?: boolean;
}
type Field = SimpleField | ComplexField;
/**
 * Image size specification
 */
interface ImageSize {
    /** Width in EMUs (English Metric Units) */
    width: number;
    /** Height in EMUs */
    height: number;
}
/**
 * Image wrap type for floating images
 */
interface ImageWrap {
    type: 'inline' | 'square' | 'tight' | 'through' | 'topAndBottom' | 'behind' | 'inFront';
    /** Wrap text direction */
    wrapText?: 'bothSides' | 'left' | 'right' | 'largest';
    /** Distance from text */
    distT?: number;
    distB?: number;
    distL?: number;
    distR?: number;
}
/**
 * Position for floating images
 */
interface ImagePosition {
    /** Horizontal positioning */
    horizontal: {
        relativeTo: 'character' | 'column' | 'insideMargin' | 'leftMargin' | 'margin' | 'outsideMargin' | 'page' | 'rightMargin';
        alignment?: 'left' | 'right' | 'center' | 'inside' | 'outside';
        posOffset?: number;
    };
    /** Vertical positioning */
    vertical: {
        relativeTo: 'insideMargin' | 'line' | 'margin' | 'outsideMargin' | 'page' | 'paragraph' | 'topMargin' | 'bottomMargin';
        alignment?: 'top' | 'bottom' | 'center' | 'inside' | 'outside';
        posOffset?: number;
    };
}
/**
 * Image transformation
 */
interface ImageTransform {
    /** Rotation in degrees */
    rotation?: number;
    /** Flip horizontal */
    flipH?: boolean;
    /** Flip vertical */
    flipV?: boolean;
}
/**
 * Image padding/margins
 */
interface ImagePadding {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
}
/**
 * Embedded image (w:drawing)
 */
interface Image {
    type: 'image';
    /** Unique ID */
    id?: string;
    /** Relationship ID for the image data */
    rId: string;
    /** Resolved image data (base64 or blob URL) */
    src?: string;
    /** Image MIME type */
    mimeType?: string;
    /** Original filename */
    filename?: string;
    /** Alt text for accessibility */
    alt?: string;
    /** Title/description */
    title?: string;
    /** Image size */
    size: ImageSize;
    /** Original size before any transforms */
    originalSize?: ImageSize;
    /** Wrap settings */
    wrap: ImageWrap;
    /** Position for floating images */
    position?: ImagePosition;
    /** Image transformations */
    transform?: ImageTransform;
    /** Padding around image */
    padding?: ImagePadding;
    /** Whether this is a decorative image */
    decorative?: boolean;
    /** Hyperlink URL for clickable image */
    hlinkHref?: string;
    /** Image outline/border */
    outline?: ShapeOutline;
    /** Image effects */
    effects?: {
        brightness?: number;
        contrast?: number;
        saturation?: number;
    };
}
/**
 * Shape types
 */
type ShapeType = 'rect' | 'roundRect' | 'ellipse' | 'triangle' | 'rtTriangle' | 'parallelogram' | 'trapezoid' | 'pentagon' | 'hexagon' | 'heptagon' | 'octagon' | 'decagon' | 'dodecagon' | 'star4' | 'star5' | 'star6' | 'star7' | 'star8' | 'star10' | 'star12' | 'star16' | 'star24' | 'star32' | 'line' | 'straightConnector1' | 'bentConnector2' | 'bentConnector3' | 'bentConnector4' | 'bentConnector5' | 'curvedConnector2' | 'curvedConnector3' | 'curvedConnector4' | 'curvedConnector5' | 'rightArrow' | 'leftArrow' | 'upArrow' | 'downArrow' | 'leftRightArrow' | 'upDownArrow' | 'quadArrow' | 'leftRightUpArrow' | 'bentArrow' | 'uturnArrow' | 'leftUpArrow' | 'bentUpArrow' | 'curvedRightArrow' | 'curvedLeftArrow' | 'curvedUpArrow' | 'curvedDownArrow' | 'stripedRightArrow' | 'notchedRightArrow' | 'homePlate' | 'chevron' | 'rightArrowCallout' | 'downArrowCallout' | 'leftArrowCallout' | 'upArrowCallout' | 'leftRightArrowCallout' | 'quadArrowCallout' | 'circularArrow' | 'flowChartProcess' | 'flowChartAlternateProcess' | 'flowChartDecision' | 'flowChartInputOutput' | 'flowChartPredefinedProcess' | 'flowChartInternalStorage' | 'flowChartDocument' | 'flowChartMultidocument' | 'flowChartTerminator' | 'flowChartPreparation' | 'flowChartManualInput' | 'flowChartManualOperation' | 'flowChartConnector' | 'flowChartOffpageConnector' | 'flowChartPunchedCard' | 'flowChartPunchedTape' | 'flowChartSummingJunction' | 'flowChartOr' | 'flowChartCollate' | 'flowChartSort' | 'flowChartExtract' | 'flowChartMerge' | 'flowChartOnlineStorage' | 'flowChartDelay' | 'flowChartMagneticTape' | 'flowChartMagneticDisk' | 'flowChartMagneticDrum' | 'flowChartDisplay' | 'wedgeRectCallout' | 'wedgeRoundRectCallout' | 'wedgeEllipseCallout' | 'cloudCallout' | 'borderCallout1' | 'borderCallout2' | 'borderCallout3' | 'accentCallout1' | 'accentCallout2' | 'accentCallout3' | 'callout1' | 'callout2' | 'callout3' | 'accentBorderCallout1' | 'accentBorderCallout2' | 'accentBorderCallout3' | 'actionButtonBlank' | 'actionButtonHome' | 'actionButtonHelp' | 'actionButtonInformation' | 'actionButtonBackPrevious' | 'actionButtonForwardNext' | 'actionButtonBeginning' | 'actionButtonEnd' | 'actionButtonReturn' | 'actionButtonDocument' | 'actionButtonSound' | 'actionButtonMovie' | 'irregularSeal1' | 'irregularSeal2' | 'frame' | 'halfFrame' | 'corner' | 'diagStripe' | 'chord' | 'arc' | 'bracketPair' | 'bracePair' | 'leftBracket' | 'rightBracket' | 'leftBrace' | 'rightBrace' | 'can' | 'cube' | 'bevel' | 'donut' | 'noSmoking' | 'blockArc' | 'foldedCorner' | 'smileyFace' | 'heart' | 'lightningBolt' | 'sun' | 'moon' | 'cloud' | 'snip1Rect' | 'snip2SameRect' | 'snip2DiagRect' | 'snipRoundRect' | 'round1Rect' | 'round2SameRect' | 'round2DiagRect' | 'plaque' | 'teardrop' | 'mathPlus' | 'mathMinus' | 'mathMultiply' | 'mathDivide' | 'mathEqual' | 'mathNotEqual' | 'gear6' | 'gear9' | 'funnel' | 'pieWedge' | 'pie' | 'leftCircularArrow' | 'leftRightCircularArrow' | 'swooshArrow' | 'textBox';
/**
 * Shape fill type
 */
interface ShapeFill {
    type: 'none' | 'solid' | 'gradient' | 'pattern' | 'picture';
    /** Solid fill color */
    color?: ColorValue;
    /** Gradient stops for gradient fill */
    gradient?: {
        type: 'linear' | 'radial' | 'rectangular' | 'path';
        angle?: number;
        stops: Array<{
            position: number;
            color: ColorValue;
        }>;
    };
}
/**
 * Shape outline/stroke
 */
interface ShapeOutline {
    /** Line width in EMUs */
    width?: number;
    /** Line color */
    color?: ColorValue;
    /** Line style */
    style?: 'solid' | 'dot' | 'dash' | 'lgDash' | 'dashDot' | 'lgDashDot' | 'lgDashDotDot' | 'sysDot' | 'sysDash' | 'sysDashDot' | 'sysDashDotDot';
    /** Line cap */
    cap?: 'flat' | 'round' | 'square';
    /** Line join */
    join?: 'bevel' | 'miter' | 'round';
    /** Head arrow */
    headEnd?: {
        type: 'none' | 'triangle' | 'stealth' | 'diamond' | 'oval' | 'arrow';
        width?: 'sm' | 'med' | 'lg';
        length?: 'sm' | 'med' | 'lg';
    };
    /** Tail arrow */
    tailEnd?: {
        type: 'none' | 'triangle' | 'stealth' | 'diamond' | 'oval' | 'arrow';
        width?: 'sm' | 'med' | 'lg';
        length?: 'sm' | 'med' | 'lg';
    };
}
/**
 * Text body inside a shape
 */
interface ShapeTextBody {
    /** Text direction */
    vertical?: boolean;
    /** Rotation */
    rotation?: number;
    /** Anchor/vertical alignment */
    anchor?: 'top' | 'middle' | 'bottom' | 'distributed' | 'justified';
    /** Anchor center */
    anchorCenter?: boolean;
    /** Auto fit */
    autoFit?: 'none' | 'normal' | 'shape';
    /** Text margins */
    margins?: {
        top?: number;
        bottom?: number;
        left?: number;
        right?: number;
    };
    /** Paragraphs inside the shape */
    content: Paragraph[];
}
/**
 * Shape/drawing object (wps:wsp)
 */
interface Shape {
    type: 'shape';
    /** Shape type preset */
    shapeType: ShapeType;
    /** Unique ID */
    id?: string;
    /** Name */
    name?: string;
    /** Size in EMUs */
    size: ImageSize;
    /** Position for floating shapes */
    position?: ImagePosition;
    /** Wrap settings */
    wrap?: ImageWrap;
    /** Fill */
    fill?: ShapeFill;
    /** Outline/stroke */
    outline?: ShapeOutline;
    /** Transform */
    transform?: ImageTransform;
    /** Text content inside the shape */
    textBody?: ShapeTextBody;
    /** Custom geometry points */
    customGeometry?: string;
}
/**
 * Text box (floating text container)
 */
interface TextBox {
    type: 'textBox';
    /** Unique ID */
    id?: string;
    /** Size */
    size: ImageSize;
    /** Position */
    position?: ImagePosition;
    /** Wrap settings */
    wrap?: ImageWrap;
    /** Fill */
    fill?: ShapeFill;
    /** Outline */
    outline?: ShapeOutline;
    /** Text content */
    content: Paragraph[];
    /** Internal margins */
    margins?: {
        top?: number;
        bottom?: number;
        left?: number;
        right?: number;
    };
}
/**
 * Table cell
 */
interface TableCell {
    type: 'tableCell';
    /** Cell formatting */
    formatting?: TableCellFormatting;
    /** Cell-level tracked property changes (w:tcPrChange) */
    propertyChanges?: TableCellPropertyChange[];
    /** Tracked structural changes (cell insert/delete/merge) */
    structuralChange?: TableStructuralChangeInfo;
    /** Cell content (paragraphs, tables, etc.) */
    content: (Paragraph | Table)[];
}
/**
 * Table row
 */
interface TableRow {
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
/**
 * Table (w:tbl)
 */
interface Table {
    type: 'table';
    /** Table formatting */
    formatting?: TableFormatting;
    /** Table-level tracked property changes (w:tblPrChange) */
    propertyChanges?: TablePropertyChange[];
    /** Column widths in twips */
    columnWidths?: number[];
    /** Table rows */
    rows: TableRow[];
}
/**
 * A comment (w:comment) from comments.xml
 */
interface Comment {
    /** Comment ID (matches commentRangeStart/End) */
    id: number;
    /** Author name */
    author: string;
    /** Author initials */
    initials?: string;
    /** Date */
    date?: string;
    /** Comment content (paragraphs) */
    content: Paragraph[];
    /** Parent comment ID (for replies) */
    parentId?: number;
    /** Whether the comment is resolved/done */
    done?: boolean;
}
/**
 * Comment range start marker in paragraph content
 */
interface CommentRangeStart {
    type: 'commentRangeStart';
    id: number;
}
/**
 * Comment range end marker in paragraph content
 */
interface CommentRangeEnd {
    type: 'commentRangeEnd';
    id: number;
}
/**
 * Math equation content (m:oMath or m:oMathPara)
 */
interface MathEquation {
    type: 'mathEquation';
    /** Whether this is a block (oMathPara) or inline (oMath) equation */
    display: 'inline' | 'block';
    /** Raw OMML XML for round-trip preservation */
    ommlXml: string;
    /** Plain text representation for accessibility/fallback */
    plainText?: string;
}
/**
 * Tracked change metadata (w:ins, w:del attributes)
 */
interface TrackedChangeInfo {
    /** Revision ID */
    id: number;
    /** Author who made the change */
    author: string;
    /** Date of the change */
    date?: string;
}
/**
 * Generic tracked property-change wrapper metadata (w:*PrChange)
 */
interface PropertyChangeInfo extends TrackedChangeInfo {
    /** Optional revision session ID */
    rsid?: string;
}
/**
 * Insertion wrapper (w:ins) — runs inserted by tracked changes
 */
interface Insertion {
    type: 'insertion';
    /** Tracked change metadata */
    info: TrackedChangeInfo;
    /** Inserted content */
    content: (Run | Hyperlink)[];
}
/**
 * Deletion wrapper (w:del) — runs deleted by tracked changes
 */
interface Deletion {
    type: 'deletion';
    /** Tracked change metadata */
    info: TrackedChangeInfo;
    /** Deleted content */
    content: (Run | Hyperlink)[];
}
/**
 * Move-from wrapper (w:moveFrom) â€” content moved away from this position
 */
interface MoveFrom {
    type: 'moveFrom';
    /** Tracked change metadata */
    info: TrackedChangeInfo;
    /** Moved content */
    content: (Run | Hyperlink)[];
}
/**
 * Move-to wrapper (w:moveTo) â€” content moved into this position
 */
interface MoveTo {
    type: 'moveTo';
    /** Tracked change metadata */
    info: TrackedChangeInfo;
    /** Moved content */
    content: (Run | Hyperlink)[];
}
/**
 * Move-from range start marker (w:moveFromRangeStart) — ECMA-376 §17.13.5.22
 * Pairs with moveFromRangeEnd to delimit the source of a move in the document.
 */
interface MoveFromRangeStart {
    type: 'moveFromRangeStart';
    id: number;
    name: string;
}
/**
 * Move-from range end marker (w:moveFromRangeEnd)
 */
interface MoveFromRangeEnd {
    type: 'moveFromRangeEnd';
    id: number;
}
/**
 * Move-to range start marker (w:moveToRangeStart) — ECMA-376 §17.13.5.24
 * Pairs with moveToRangeEnd to delimit the destination of a move.
 */
interface MoveToRangeStart {
    type: 'moveToRangeStart';
    id: number;
    name: string;
}
/**
 * Move-to range end marker (w:moveToRangeEnd)
 */
interface MoveToRangeEnd {
    type: 'moveToRangeEnd';
    id: number;
}
/**
 * Run-level tracked wrappers represented in WordprocessingML.
 */
type TrackedRunChange = Insertion | Deletion | MoveFrom | MoveTo;
/**
 * Run property change (w:rPrChange)
 */
interface RunPropertyChange {
    type: 'runPropertyChange';
    /** Tracked change metadata */
    info: PropertyChangeInfo;
    /** Run properties before the tracked change */
    previousFormatting?: TextFormatting;
    /** Run properties after the tracked change (editor model convenience) */
    currentFormatting?: TextFormatting;
}
/**
 * Paragraph property change (w:pPrChange)
 */
interface ParagraphPropertyChange {
    type: 'paragraphPropertyChange';
    /** Tracked change metadata */
    info: PropertyChangeInfo;
    /** Paragraph properties before the tracked change */
    previousFormatting?: ParagraphFormatting;
    /** Paragraph properties after the tracked change (editor model convenience) */
    currentFormatting?: ParagraphFormatting;
}
/**
 * Table property change (w:tblPrChange)
 */
interface TablePropertyChange {
    type: 'tablePropertyChange';
    /** Tracked change metadata */
    info: PropertyChangeInfo;
    /** Table properties before the tracked change */
    previousFormatting?: TableFormatting;
    /** Table properties after the tracked change (editor model convenience) */
    currentFormatting?: TableFormatting;
}
/**
 * Table row property change (w:trPrChange)
 */
interface TableRowPropertyChange {
    type: 'tableRowPropertyChange';
    /** Tracked change metadata */
    info: PropertyChangeInfo;
    /** Row properties before the tracked change */
    previousFormatting?: TableRowFormatting;
    /** Row properties after the tracked change (editor model convenience) */
    currentFormatting?: TableRowFormatting;
}
/**
 * Table cell property change (w:tcPrChange)
 */
interface TableCellPropertyChange {
    type: 'tableCellPropertyChange';
    /** Tracked change metadata */
    info: PropertyChangeInfo;
    /** Cell properties before the tracked change */
    previousFormatting?: TableCellFormatting;
    /** Cell properties after the tracked change (editor model convenience) */
    currentFormatting?: TableCellFormatting;
}
/**
 * Table structural tracked change metadata (row/cell insert/delete/merge)
 */
interface TableStructuralChangeInfo {
    type: 'tableRowInsertion' | 'tableRowDeletion' | 'tableCellInsertion' | 'tableCellDeletion' | 'tableCellMerge';
    /** Tracked change metadata */
    info: TrackedChangeInfo;
}
/**
 * SDT type (content control type)
 */
type SdtType = 'richText' | 'plainText' | 'date' | 'dropdown' | 'comboBox' | 'checkbox' | 'picture' | 'buildingBlockGallery' | 'group' | 'unknown';
/**
 * SDT properties (w:sdtPr)
 */
interface SdtProperties {
    /** SDT type */
    sdtType: SdtType;
    /** Alias (friendly name) */
    alias?: string;
    /** Tag (developer identifier) */
    tag?: string;
    /** Lock content editing */
    lock?: 'sdtLocked' | 'contentLocked' | 'sdtContentLocked' | 'unlocked';
    /** Placeholder text */
    placeholder?: string;
    /** Whether showing placeholder */
    showingPlaceholder?: boolean;
    /** Date format for date controls */
    dateFormat?: string;
    /** Dropdown/combobox list items */
    listItems?: {
        displayText: string;
        value: string;
    }[];
    /** Checkbox checked state */
    checked?: boolean;
}
/**
 * Inline SDT (content control within a paragraph)
 */
interface InlineSdt {
    type: 'inlineSdt';
    /** SDT properties */
    properties: SdtProperties;
    /** Content runs inside the control */
    content: (Run | Hyperlink)[];
}
/**
 * Block-level SDT (content control wrapping paragraphs/tables)
 */
interface BlockSdt {
    type: 'blockSdt';
    /** SDT properties */
    properties: SdtProperties;
    /** Block content inside the control */
    content: (Paragraph | Table)[];
}
/**
 * Paragraph content types
 */
type ParagraphContent = Run | Hyperlink | BookmarkStart | BookmarkEnd | SimpleField | ComplexField | InlineSdt | CommentRangeStart | CommentRangeEnd | Insertion | Deletion | MoveFrom | MoveTo | MoveFromRangeStart | MoveFromRangeEnd | MoveToRangeStart | MoveToRangeEnd | MathEquation;
/**
 * Paragraph (w:p)
 */
interface Paragraph {
    type: 'paragraph';
    /** Unique paragraph ID */
    paraId?: string;
    /** Text ID */
    textId?: string;
    /** Paragraph formatting */
    formatting?: ParagraphFormatting;
    /** Paragraph-level tracked property changes (w:pPrChange) */
    propertyChanges?: ParagraphPropertyChange[];
    /** Paragraph content */
    content: ParagraphContent[];
    /** Computed list rendering (if this is a list item) */
    listRendering?: ListRendering;
    /** Section properties (if this paragraph ends a section) */
    sectionProperties?: SectionProperties;
}
/**
 * Header/footer type
 */
type HeaderFooterType = 'default' | 'first' | 'even';
/**
 * Header or footer reference
 */
interface HeaderReference {
    type: HeaderFooterType;
    rId: string;
}
interface FooterReference {
    type: HeaderFooterType;
    rId: string;
}
/**
 * Header or footer content
 */
interface HeaderFooter {
    type: 'header' | 'footer';
    /** Header/footer type */
    hdrFtrType: HeaderFooterType;
    /** Content (paragraphs, tables, etc.) */
    content: (Paragraph | Table)[];
}
/**
 * Footnote position
 */
type FootnotePosition = 'pageBottom' | 'beneathText' | 'sectEnd' | 'docEnd';
/**
 * Endnote position
 */
type EndnotePosition = 'sectEnd' | 'docEnd';
/**
 * Number restart type
 */
type NoteNumberRestart = 'continuous' | 'eachSect' | 'eachPage';
/**
 * Footnote properties
 */
interface FootnoteProperties {
    position?: FootnotePosition;
    numFmt?: NumberFormat;
    numStart?: number;
    numRestart?: NoteNumberRestart;
}
/**
 * Endnote properties
 */
interface EndnoteProperties {
    position?: EndnotePosition;
    numFmt?: NumberFormat;
    numStart?: number;
    numRestart?: NoteNumberRestart;
}
/**
 * Footnote (w:footnote)
 */
interface Footnote {
    type: 'footnote';
    /** Footnote ID */
    id: number;
    /** Special footnote type */
    noteType?: 'normal' | 'separator' | 'continuationSeparator' | 'continuationNotice';
    /** Content */
    content: Paragraph[];
}
/**
 * Endnote (w:endnote)
 */
interface Endnote {
    type: 'endnote';
    /** Endnote ID */
    id: number;
    /** Special endnote type */
    noteType?: 'normal' | 'separator' | 'continuationSeparator' | 'continuationNotice';
    /** Content */
    content: Paragraph[];
}
/**
 * Page orientation
 */
type PageOrientation = 'portrait' | 'landscape';
/**
 * Section start type
 */
type SectionStart = 'continuous' | 'nextPage' | 'oddPage' | 'evenPage' | 'nextColumn';
/**
 * Vertical alignment
 */
type VerticalAlign = 'top' | 'center' | 'both' | 'bottom';
/**
 * Line number restart type
 */
type LineNumberRestart = 'continuous' | 'newPage' | 'newSection';
/**
 * Column definition
 */
interface Column {
    /** Column width in twips */
    width?: number;
    /** Space after column in twips */
    space?: number;
}
/**
 * Section properties (w:sectPr)
 */
interface SectionProperties {
    /** Page width in twips */
    pageWidth?: number;
    /** Page height in twips */
    pageHeight?: number;
    /** Page orientation */
    orientation?: PageOrientation;
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
    /** Section start type */
    sectionStart?: SectionStart;
    /** Vertical alignment of text */
    verticalAlign?: VerticalAlign;
    /** Right-to-left section */
    bidi?: boolean;
    /** Header references */
    headerReferences?: HeaderReference[];
    /** Footer references */
    footerReferences?: FooterReference[];
    /** Different first page header/footer */
    titlePg?: boolean;
    /** Different odd/even page headers/footers */
    evenAndOddHeaders?: boolean;
    /** Line numbering settings */
    lineNumbers?: {
        start?: number;
        countBy?: number;
        distance?: number;
        restart?: LineNumberRestart;
    };
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
    /** Page background */
    background?: {
        color?: ColorValue;
        themeColor?: ThemeColorSlot;
        themeTint?: string;
        themeShade?: string;
    };
    /** Footnote properties for this section */
    footnotePr?: FootnoteProperties;
    /** Endnote properties for this section */
    endnotePr?: EndnoteProperties;
    /** Document grid */
    docGrid?: {
        type?: 'default' | 'lines' | 'linesAndChars' | 'snapToChars';
        linePitch?: number;
        charSpace?: number;
    };
    /** First page paper source */
    paperSrcFirst?: number;
    /** Other pages paper source */
    paperSrcOther?: number;
}
/**
 * Block-level content types
 */
type BlockContent = Paragraph | Table | BlockSdt;
/**
 * Section (implicit or explicit based on sectPr)
 */
interface Section {
    /** Section properties */
    properties: SectionProperties;
    /** Content in this section */
    content: BlockContent[];
    /** Headers for this section */
    headers?: Map<HeaderFooterType, HeaderFooter>;
    /** Footers for this section */
    footers?: Map<HeaderFooterType, HeaderFooter>;
}
/**
 * Document body (w:body)
 */
interface DocumentBody {
    /** All content (paragraphs, tables) */
    content: BlockContent[];
    /** Sections (derived from sectPr in paragraphs and final sectPr) */
    sections?: Section[];
    /** Final section properties (from body's sectPr) */
    finalSectionProperties?: SectionProperties;
    /** Comments from comments.xml */
    comments?: Comment[];
}

/**
 * Styles, Theme, Font Table, Relationships & Media Types
 *
 * Types for document-level definitions that don't form the content tree.
 */

/**
 * Style type
 */
type StyleType = 'paragraph' | 'character' | 'numbering' | 'table';
/**
 * Style definition
 */
interface Style {
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
    /** UI sort priority */
    uiPriority?: number;
    /** Hidden from UI */
    hidden?: boolean;
    /** Semi-hidden from UI */
    semiHidden?: boolean;
    /** Unhide when used */
    unhideWhenUsed?: boolean;
    /** Quick format in gallery */
    qFormat?: boolean;
    /** Is default style */
    default?: boolean;
    /** Personal style (custom) */
    personal?: boolean;
    /** Paragraph properties (for paragraph/table styles) */
    pPr?: ParagraphFormatting;
    /** Run properties */
    rPr?: TextFormatting;
    /** Table properties (for table styles) */
    tblPr?: TableFormatting;
    /** Table row properties */
    trPr?: TableRowFormatting;
    /** Table cell properties */
    tcPr?: TableCellFormatting;
    /** Conditional table style parts */
    tblStylePr?: Array<{
        type: 'band1Horz' | 'band1Vert' | 'band2Horz' | 'band2Vert' | 'firstCol' | 'firstRow' | 'lastCol' | 'lastRow' | 'neCell' | 'nwCell' | 'seCell' | 'swCell';
        pPr?: ParagraphFormatting;
        rPr?: TextFormatting;
        tblPr?: TableFormatting;
        trPr?: TableRowFormatting;
        tcPr?: TableCellFormatting;
    }>;
}
/**
 * Document defaults (w:docDefaults)
 */
interface DocDefaults {
    /** Default run properties */
    rPr?: TextFormatting;
    /** Default paragraph properties */
    pPr?: ParagraphFormatting;
}
/**
 * Style definitions from styles.xml
 */
interface StyleDefinitions {
    /** Document defaults */
    docDefaults?: DocDefaults;
    /** Latent styles */
    latentStyles?: {
        defLockedState?: boolean;
        defUIPriority?: number;
        defSemiHidden?: boolean;
        defUnhideWhenUsed?: boolean;
        defQFormat?: boolean;
        count?: number;
    };
    /** Style definitions */
    styles: Style[];
}
/**
 * Theme color scheme (a:clrScheme)
 */
interface ThemeColorScheme {
    /** Dark 1 color (usually black) */
    dk1?: string;
    /** Light 1 color (usually white) */
    lt1?: string;
    /** Dark 2 color */
    dk2?: string;
    /** Light 2 color */
    lt2?: string;
    /** Accent colors 1-6 */
    accent1?: string;
    accent2?: string;
    accent3?: string;
    accent4?: string;
    accent5?: string;
    accent6?: string;
    /** Hyperlink color */
    hlink?: string;
    /** Followed hyperlink color */
    folHlink?: string;
}
/**
 * Theme font (with script variants)
 */
interface ThemeFont {
    /** Latin font */
    latin?: string;
    /** East Asian font */
    ea?: string;
    /** Complex script font */
    cs?: string;
    /** Script-specific fonts */
    fonts?: Record<string, string>;
}
/**
 * Theme font scheme (a:fontScheme)
 */
interface ThemeFontScheme {
    /** Major font (headings) */
    majorFont?: ThemeFont;
    /** Minor font (body text) */
    minorFont?: ThemeFont;
}
/**
 * Theme (from theme1.xml)
 */
interface Theme {
    /** Theme name */
    name?: string;
    /** Color scheme */
    colorScheme?: ThemeColorScheme;
    /** Font scheme */
    fontScheme?: ThemeFontScheme;
    /** Format scheme (fills, lines, effects) - simplified */
    formatScheme?: {
        name?: string;
    };
}
/**
 * Font info from fontTable.xml
 */
interface FontInfo {
    /** Font name */
    name: string;
    /** Alternate names */
    altName?: string;
    /** Panose-1 classification */
    panose1?: string;
    /** Character set */
    charset?: string;
    /** Font family type */
    family?: 'decorative' | 'modern' | 'roman' | 'script' | 'swiss' | 'auto';
    /** Pitch (fixed or variable) */
    pitch?: 'default' | 'fixed' | 'variable';
    /** Signature */
    sig?: {
        usb0?: string;
        usb1?: string;
        usb2?: string;
        usb3?: string;
        csb0?: string;
        csb1?: string;
    };
    /** Embedded font data reference */
    embedRegular?: string;
    embedBold?: string;
    embedItalic?: string;
    embedBoldItalic?: string;
}
/**
 * Font table from fontTable.xml
 */
interface FontTable {
    fonts: FontInfo[];
}
/**
 * Relationship type
 */
type RelationshipType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image' | 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink' | 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header' | 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer' | 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes' | 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes' | 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles' | 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering' | 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable' | 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme' | 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings' | 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/webSettings' | 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject' | 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart' | 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData' | string;
/**
 * Relationship entry
 */
interface Relationship {
    /** Relationship ID (e.g., "rId1") */
    id: string;
    /** Relationship type URI */
    type: RelationshipType;
    /** Target path or URL */
    target: string;
    /** Target mode */
    targetMode?: 'External' | 'Internal';
}
/**
 * Relationship map (keyed by rId)
 */
type RelationshipMap = Map<string, Relationship>;
/**
 * Media file from word/media/
 */
interface MediaFile {
    /** File path in ZIP */
    path: string;
    /** Original filename */
    filename?: string;
    /** MIME type */
    mimeType: string;
    /** Binary data */
    data: ArrayBuffer;
    /** Base64 encoded data for rendering */
    base64?: string;
    /** Data URL for direct use in src attributes */
    dataUrl?: string;
}

/**
 * Comprehensive TypeScript types for full DOCX document representation
 *
 * This barrel file re-exports all types from the split modules.
 * Existing imports from './types/document' continue to work unchanged.
 *
 * Module structure:
 * - colors.ts      — Color primitives, borders, shading
 * - formatting.ts  — Text, paragraph, and table formatting properties
 * - lists.ts       — Numbering and list definitions
 * - content.ts     — Content model (runs, images, shapes, tables, paragraphs, sections)
 * - styles.ts      — Styles, theme, fonts, relationships, media
 */

/**
 * Complete DOCX package structure
 */
interface DocxPackage {
    /** Document body */
    document: DocumentBody;
    /** Style definitions */
    styles?: StyleDefinitions;
    /** Theme */
    theme?: Theme;
    /** Numbering definitions */
    numbering?: NumberingDefinitions;
    /** Font table */
    fontTable?: FontTable;
    /** Footnotes */
    footnotes?: Footnote[];
    /** Endnotes */
    endnotes?: Endnote[];
    /** Headers by relationship ID */
    headers?: Map<string, HeaderFooter>;
    /** Footers by relationship ID */
    footers?: Map<string, HeaderFooter>;
    /** Document relationships */
    relationships?: RelationshipMap;
    /** Media files */
    media?: Map<string, MediaFile>;
    /** Document properties */
    properties?: {
        title?: string;
        subject?: string;
        creator?: string;
        keywords?: string;
        description?: string;
        lastModifiedBy?: string;
        revision?: number;
        created?: Date;
        modified?: Date;
    };
}
/**
 * Complete parsed DOCX document
 */
interface Document {
    /** DOCX package with all parsed content */
    package: DocxPackage;
    /** Original ArrayBuffer for round-trip */
    originalBuffer?: ArrayBuffer;
    /** Detected template variables ({{...}}) */
    templateVariables?: string[];
    /** Parsing warnings/errors */
    warnings?: string[];
}

/**
 * Agent API Types
 *
 * TypeScript interfaces for the agent API:
 * - Position and Range types
 * - Command types for document manipulation
 * - Context types for AI agents
 */

/**
 * Position within a document
 */
interface Position {
    /** Index of the paragraph (0-indexed) */
    paragraphIndex: number;
    /** Offset within the paragraph in characters */
    offset: number;
    /** Optional: Content index within paragraph (run, hyperlink, etc.) */
    contentIndex?: number;
    /** Optional: Section index */
    sectionIndex?: number;
}
/**
 * Range within a document
 */
interface Range {
    /** Start position */
    start: Position;
    /** End position */
    end: Position;
    /** Whether the range is collapsed (cursor position) */
    collapsed?: boolean;
}
/**
 * Create a collapsed range (cursor) at a position
 */
declare function createCollapsedRange(position: Position): Range;
/**
 * Create a range from two positions
 */
declare function createRange(start: Position, end: Position): Range;
/**
 * Check if a position is within a range
 */
declare function isPositionInRange(position: Position, range: Range): boolean;
/**
 * Compare two positions
 * Returns: -1 if a < b, 0 if equal, 1 if a > b
 */
declare function comparePositions(a: Position, b: Position): -1 | 0 | 1;
/**
 * Base command interface
 */
interface BaseCommand {
    /** Command type */
    type: string;
    /** Unique command ID (for undo tracking) */
    id?: string;
}
/**
 * Insert text at a position
 */
interface InsertTextCommand extends BaseCommand {
    type: 'insertText';
    /** Position to insert at */
    position: Position;
    /** Text to insert */
    text: string;
    /** Optional formatting for the inserted text */
    formatting?: TextFormatting;
}
/**
 * Replace text in a range
 */
interface ReplaceTextCommand extends BaseCommand {
    type: 'replaceText';
    /** Range to replace */
    range: Range;
    /** Replacement text */
    text: string;
    /** Optional formatting for the new text */
    formatting?: TextFormatting;
}
/**
 * Delete text in a range
 */
interface DeleteTextCommand extends BaseCommand {
    type: 'deleteText';
    /** Range to delete */
    range: Range;
}
/**
 * Apply formatting to a range
 */
interface FormatTextCommand extends BaseCommand {
    type: 'formatText';
    /** Range to format */
    range: Range;
    /** Formatting to apply */
    formatting: Partial<TextFormatting>;
}
/**
 * Apply paragraph formatting
 */
interface FormatParagraphCommand extends BaseCommand {
    type: 'formatParagraph';
    /** Paragraph index */
    paragraphIndex: number;
    /** Formatting to apply */
    formatting: Partial<ParagraphFormatting>;
}
/**
 * Apply a named style to a paragraph
 */
interface ApplyStyleCommand extends BaseCommand {
    type: 'applyStyle';
    /** Paragraph index */
    paragraphIndex: number;
    /** Style ID to apply */
    styleId: string;
}
/**
 * Insert a table at a position
 */
interface InsertTableCommand extends BaseCommand {
    type: 'insertTable';
    /** Position to insert at */
    position: Position;
    /** Number of rows */
    rows: number;
    /** Number of columns */
    columns: number;
    /** Optional table data */
    data?: string[][];
    /** Optional header row */
    hasHeader?: boolean;
}
/**
 * Insert an image at a position
 */
interface InsertImageCommand extends BaseCommand {
    type: 'insertImage';
    /** Position to insert at */
    position: Position;
    /** Image source (base64 or URL) */
    src: string;
    /** Image width in pixels */
    width?: number;
    /** Image height in pixels */
    height?: number;
    /** Alt text */
    alt?: string;
}
/**
 * Insert a hyperlink at a range
 */
interface InsertHyperlinkCommand extends BaseCommand {
    type: 'insertHyperlink';
    /** Range to make into a hyperlink */
    range: Range;
    /** URL of the hyperlink */
    url: string;
    /** Display text (replaces range text if provided) */
    displayText?: string;
    /** Tooltip */
    tooltip?: string;
}
/**
 * Remove a hyperlink but keep the text
 */
interface RemoveHyperlinkCommand extends BaseCommand {
    type: 'removeHyperlink';
    /** Range containing the hyperlink */
    range: Range;
}
/**
 * Insert a paragraph break
 */
interface InsertParagraphBreakCommand extends BaseCommand {
    type: 'insertParagraphBreak';
    /** Position to break at */
    position: Position;
}
/**
 * Merge paragraphs
 */
interface MergeParagraphsCommand extends BaseCommand {
    type: 'mergeParagraphs';
    /** First paragraph index */
    paragraphIndex: number;
    /** Number of paragraphs to merge with */
    count: number;
}
/**
 * Split a paragraph
 */
interface SplitParagraphCommand extends BaseCommand {
    type: 'splitParagraph';
    /** Position to split at */
    position: Position;
}
/**
 * Set template variable value
 */
interface SetVariableCommand extends BaseCommand {
    type: 'setVariable';
    /** Variable name */
    name: string;
    /** Variable value */
    value: string;
}
/**
 * Apply all template variables
 */
interface ApplyVariablesCommand extends BaseCommand {
    type: 'applyVariables';
    /** Variable values */
    values: Record<string, string>;
}
/**
 * Union of all command types
 */
type AgentCommand = InsertTextCommand | ReplaceTextCommand | DeleteTextCommand | FormatTextCommand | FormatParagraphCommand | ApplyStyleCommand | InsertTableCommand | InsertImageCommand | InsertHyperlinkCommand | RemoveHyperlinkCommand | InsertParagraphBreakCommand | MergeParagraphsCommand | SplitParagraphCommand | SetVariableCommand | ApplyVariablesCommand;
/**
 * Document context for AI agents
 */
interface AgentContext {
    /** Total paragraph count */
    paragraphCount: number;
    /** Total word count (approximate) */
    wordCount: number;
    /** Total character count */
    characterCount: number;
    /** Detected template variables */
    variables: string[];
    /** Variable count */
    variableCount: number;
    /** Available styles */
    availableStyles: StyleInfo[];
    /** Content outline (first N chars per paragraph) */
    outline: ParagraphOutline[];
    /** Document sections info */
    sections: SectionInfo[];
    /** Has tables */
    hasTables: boolean;
    /** Has images */
    hasImages: boolean;
    /** Has hyperlinks */
    hasHyperlinks: boolean;
    /** Document language */
    language?: string;
}
/**
 * Style information for context
 */
interface StyleInfo {
    /** Style ID */
    id: string;
    /** Display name */
    name: string;
    /** Style type */
    type: 'paragraph' | 'character' | 'table';
    /** Is built-in style */
    builtIn?: boolean;
}
/**
 * Paragraph outline for context
 */
interface ParagraphOutline {
    /** Paragraph index */
    index: number;
    /** First N characters */
    preview: string;
    /** Paragraph style */
    style?: string;
    /** Is heading */
    isHeading?: boolean;
    /** Heading level (1-9) */
    headingLevel?: number;
    /** Is list item */
    isListItem?: boolean;
    /** Is empty paragraph */
    isEmpty?: boolean;
}
/**
 * Section information
 */
interface SectionInfo {
    /** Section index */
    index: number;
    /** Number of paragraphs */
    paragraphCount: number;
    /** Page size */
    pageSize?: {
        width: number;
        height: number;
    };
    /** Is landscape */
    isLandscape?: boolean;
    /** Has header */
    hasHeader?: boolean;
    /** Has footer */
    hasFooter?: boolean;
}
/**
 * Context about the current selection
 */
interface SelectionContext {
    /** Selected text */
    selectedText: string;
    /** Selection range */
    range: Range;
    /** Current formatting of selection */
    formatting: Partial<TextFormatting>;
    /** Current paragraph formatting */
    paragraphFormatting: Partial<ParagraphFormatting>;
    /** Text before selection (context) */
    textBefore: string;
    /** Text after selection (context) */
    textAfter: string;
    /** Paragraph containing selection */
    paragraph: ParagraphContext;
    /** Is selection within a table */
    inTable?: boolean;
    /** Is selection within a hyperlink */
    inHyperlink?: boolean;
    /** Suggested actions based on selection */
    suggestedActions?: SuggestedAction[];
}
/**
 * Paragraph context for selection
 */
interface ParagraphContext {
    /** Paragraph index */
    index: number;
    /** Full paragraph text */
    fullText: string;
    /** Paragraph style */
    style?: string;
    /** Word count */
    wordCount: number;
}
/**
 * Suggested action for context menu
 */
interface SuggestedAction {
    /** Action ID */
    id: string;
    /** Display label */
    label: string;
    /** Description */
    description?: string;
    /** Icon name */
    icon?: string;
    /** Priority (higher = more prominent) */
    priority?: number;
}
/**
 * Response from an agent action
 */
interface AgentResponse {
    /** Success status */
    success: boolean;
    /** New text to insert (for rewrite/expand/etc.) */
    newText?: string;
    /** New formatted content */
    newContent?: AgentContent[];
    /** Commands to execute */
    commands?: AgentCommand[];
    /** Error message if failed */
    error?: string;
    /** Warning messages */
    warnings?: string[];
    /** Metadata about the response */
    metadata?: Record<string, unknown>;
}
/**
 * Content block in agent response
 */
interface AgentContent {
    /** Content type */
    type: 'text' | 'paragraph' | 'table' | 'image';
    /** Text content */
    text?: string;
    /** Formatting */
    formatting?: Partial<TextFormatting>;
    /** Paragraph formatting */
    paragraphFormatting?: Partial<ParagraphFormatting>;
    /** Table data (for table type) */
    tableData?: string[][];
    /** Image src (for image type) */
    imageSrc?: string;
}
/**
 * AI action types for context menu
 */
type AIAction = 'askAI' | 'rewrite' | 'expand' | 'summarize' | 'translate' | 'explain' | 'fixGrammar' | 'makeFormal' | 'makeCasual' | 'custom';
/**
 * AI action request
 */
interface AIActionRequest {
    /** Action type */
    action: AIAction;
    /** Selection context */
    context: SelectionContext;
    /** Custom prompt (for 'custom' action) */
    customPrompt?: string;
    /** Target language (for 'translate' action) */
    targetLanguage?: string;
    /** Additional options */
    options?: Record<string, unknown>;
}
/**
 * Get action label
 */
declare function getActionLabel(action: AIAction): string;
/**
 * Get action description
 */
declare function getActionDescription(action: AIAction): string;
/**
 * Default AI actions for context menu
 */
declare const DEFAULT_AI_ACTIONS: AIAction[];
/**
 * Create a command with generated ID
 */
declare function createCommand<T extends AgentCommand>(command: Omit<T, 'id'>): T;

/**
 * Core Plugin System Types
 *
 * Defines the interfaces for headless plugins that work in Node.js
 * without React/DOM dependencies. These plugins extend DocumentAgent
 * with additional commands and expose MCP tools for AI integration.
 */

/**
 * Core plugin interface - headless, works in Node.js
 *
 * Plugins can:
 * - Register command handlers that DocumentAgent dispatches to
 * - Declare MCP tools that the MCP server exposes to AI clients
 * - Have optional initialization logic
 * - Declare dependencies on other plugins
 */
interface CorePlugin {
    /** Unique plugin identifier */
    id: string;
    /** Human-readable plugin name */
    name: string;
    /** Plugin version (semver) */
    version?: string;
    /** Plugin description */
    description?: string;
    /**
     * Command handlers this plugin provides.
     * DocumentAgent dispatches commands to these handlers.
     *
     * @example
     * ```ts
     * commandHandlers: {
     *   'insertTemplateVariable': (doc, cmd) => {
     *     // Transform document
     *     return modifiedDoc;
     *   },
     * }
     * ```
     */
    commandHandlers?: Record<string, CommandHandler>;
    /**
     * MCP tools this plugin exposes.
     * MCP server collects these from all plugins.
     */
    mcpTools?: McpToolDefinition[];
    /**
     * Optional setup when plugin is registered.
     * Called once during plugin registration.
     */
    initialize?: () => void | Promise<void>;
    /**
     * Optional cleanup when plugin is unregistered.
     */
    destroy?: () => void | Promise<void>;
    /**
     * Dependencies on other plugins (by ID).
     * The registry ensures dependencies are loaded first.
     */
    dependencies?: string[];
}
/**
 * Command handler function type
 *
 * Receives a document and a command, returns a modified document.
 * Must be pure/immutable - always return a new document.
 */
type CommandHandler = (doc: Document, command: PluginCommand) => Document;
/**
 * Extended command type for plugins
 *
 * Plugins can define custom command types beyond the built-in AgentCommand types.
 */
interface PluginCommand {
    /** Command type identifier */
    type: string;
    /** Unique command ID (for undo tracking) */
    id?: string;
    /** Position for positional commands */
    position?: Position;
    /** Range for range-based commands */
    range?: Range;
    /** Additional command-specific data */
    [key: string]: unknown;
}
/**
 * Result of command execution
 */
interface CommandResult {
    /** The modified document */
    document: Document;
    /** Whether the command succeeded */
    success: boolean;
    /** Error message if failed */
    error?: string;
    /** Metadata about the operation */
    metadata?: Record<string, unknown>;
}
/**
 * MCP tool definition
 *
 * Describes a tool that can be called by AI clients through the MCP server.
 */
interface McpToolDefinition {
    /** Tool name (used in MCP protocol) */
    name: string;
    /** Human-readable description for AI */
    description: string;
    /**
     * JSON Schema for tool input validation.
     * Can be a Zod schema or plain JSON Schema object.
     */
    inputSchema: JsonSchema | ZodSchemaLike;
    /**
     * Handler function for the tool.
     * Receives validated input and returns a result.
     */
    handler: McpToolHandler;
    /**
     * Optional annotations for the tool
     */
    annotations?: McpToolAnnotations;
}
/**
 * MCP tool handler function
 */
type McpToolHandler = (input: unknown, context: McpToolContext) => Promise<McpToolResult> | McpToolResult;
/**
 * Context passed to MCP tool handlers
 */
interface McpToolContext {
    /** Current document (if loaded) */
    document?: Document;
    /** Document buffer (if loaded) */
    documentBuffer?: ArrayBuffer;
    /** Session state */
    session: McpSession;
    /** Logger for debugging */
    log: (message: string, data?: unknown) => void;
}
/**
 * MCP session state
 *
 * Maintains state across tool calls within a session.
 */
interface McpSession {
    /** Session ID */
    id: string;
    /** Loaded documents by ID */
    documents: Map<string, LoadedDocument>;
    /** Custom session data */
    data: Map<string, unknown>;
}
/**
 * A loaded document in the session
 */
interface LoadedDocument {
    /** Document ID */
    id: string;
    /** Parsed document */
    document: Document;
    /** Original buffer (for repacking) */
    buffer?: ArrayBuffer;
    /** Source filename or path */
    source?: string;
    /** Last modified timestamp */
    lastModified: number;
}
/**
 * MCP tool result
 */
interface McpToolResult {
    /** Result content */
    content: McpToolContent[];
    /** Whether this is an error result */
    isError?: boolean;
}
/**
 * MCP tool content types
 */
type McpToolContent = {
    type: 'text';
    text: string;
} | {
    type: 'image';
    data: string;
    mimeType: string;
} | {
    type: 'resource';
    uri: string;
    mimeType?: string;
    text?: string;
};
/**
 * MCP tool annotations
 */
interface McpToolAnnotations {
    /** Tool category for organization */
    category?: string;
    /** Whether this tool modifies the document */
    readOnly?: boolean;
    /** Estimated cost/complexity */
    complexity?: 'low' | 'medium' | 'high';
    /** Example usage */
    examples?: McpToolExample[];
}
/**
 * MCP tool example
 */
interface McpToolExample {
    /** Example description */
    description: string;
    /** Example input */
    input: unknown;
    /** Expected output description */
    output?: string;
}
/**
 * JSON Schema definition (subset)
 */
interface JsonSchema {
    type?: string | string[];
    properties?: Record<string, JsonSchema>;
    items?: JsonSchema;
    required?: string[];
    description?: string;
    enum?: unknown[];
    default?: unknown;
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    format?: string;
    additionalProperties?: boolean | JsonSchema;
    anyOf?: JsonSchema[];
    oneOf?: JsonSchema[];
    allOf?: JsonSchema[];
    $ref?: string;
}
/**
 * Zod-like schema interface for compatibility
 */
interface ZodSchemaLike {
    _def?: unknown;
    parse?: (data: unknown) => unknown;
    safeParse?: (data: unknown) => {
        success: boolean;
        data?: unknown;
        error?: unknown;
    };
}
/**
 * Check if a schema is Zod-like
 */
declare function isZodSchema(schema: unknown): schema is ZodSchemaLike;
/**
 * Plugin lifecycle events
 */
type PluginEvent = {
    type: 'registered';
    plugin: CorePlugin;
} | {
    type: 'unregistered';
    pluginId: string;
} | {
    type: 'error';
    pluginId: string;
    error: Error;
};
/**
 * Plugin event listener
 */
type PluginEventListener = (event: PluginEvent) => void;
/**
 * Extract command type from a union
 */
type ExtractCommand<T extends AgentCommand, Type extends string> = T extends {
    type: Type;
} ? T : never;
/**
 * Create a typed command handler
 */
type TypedCommandHandler<T extends PluginCommand> = (doc: Document, command: T) => Document;
/**
 * Plugin configuration options
 */
interface PluginOptions {
    /** Enable debug logging */
    debug?: boolean;
    /** Custom configuration */
    config?: Record<string, unknown>;
}
/**
 * Result of plugin registration
 */
interface PluginRegistrationResult {
    /** Whether registration succeeded */
    success: boolean;
    /** Registered plugin (if successful) */
    plugin?: CorePlugin;
    /** Error message (if failed) */
    error?: string;
    /** Warning messages */
    warnings?: string[];
}

export { type ParagraphContext as $, type AIAction as A, type BlockContent as B, type CorePlugin as C, type DocumentBody as D, type Endnote as E, type Footnote as F, type InsertTextCommand as G, type Hyperlink as H, type Image as I, type Insertion as J, type JsonSchema as K, type ListLevel as L, type McpToolDefinition as M, type LoadedDocument as N, type McpSession as O, type PluginOptions as P, type McpToolAnnotations as Q, type Run as R, type McpToolContent as S, type TextFormatting as T, type McpToolContext as U, type McpToolHandler as V, type McpToolResult as W, type MoveFrom as X, type MoveTo as Y, type NumberingDefinitions as Z, type ParagraphContent as _, type PluginRegistrationResult as a, type ParagraphFormatting as a0, type ParagraphOutline as a1, type PluginCommand as a2, type PluginEvent as a3, type Range as a4, type Relationship as a5, type ReplaceTextCommand as a6, type RunContent as a7, type SectionInfo as a8, type SectionProperties as a9, type HeaderFooter as aA, type HeaderReference as aB, type Shape as aC, type TextBox as aD, type ThemeColorScheme as aE, type ThemeFont as aF, type ThemeFontScheme as aG, type ThemeColorSlot as aH, type ColorValue as aI, type ExtractCommand as aJ, type McpToolExample as aK, type TypedCommandHandler as aL, type SelectionContext as aa, type SetVariableCommand as ab, type Style as ac, type StyleDefinitions as ad, type StyleInfo as ae, type SuggestedAction as af, type TableCell as ag, type TableRow as ah, type TextContent as ai, type Theme as aj, type TrackedChangeInfo as ak, type TrackedRunChange as al, type ZodSchemaLike as am, comparePositions as an, createCollapsedRange as ao, createCommand as ap, createRange as aq, getActionDescription as ar, getActionLabel as as, isPositionInRange as at, isZodSchema as au, type BreakContent as av, type BookmarkEnd as aw, type BookmarkStart as ax, type Field as ay, type FooterReference as az, type CommandHandler as b, type PluginEventListener as c, type Paragraph as d, type Table as e, type Position as f, type AIActionRequest as g, type AgentCommand as h, type AgentContext as i, type AgentResponse as j, type ApplyStyleCommand as k, type ApplyVariablesCommand as l, type CommandResult as m, type Comment as n, type CommentRangeEnd as o, type CommentRangeStart as p, DEFAULT_AI_ACTIONS as q, type DeleteTextCommand as r, type Deletion as s, type Document as t, type DocxPackage as u, type FormatParagraphCommand as v, type FormatTextCommand as w, type InsertHyperlinkCommand as x, type InsertImageCommand as y, type InsertTableCommand as z };
