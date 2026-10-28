/**
 * Word feature support matrix — single source of truth.
 *
 * Rendered on docx-editor.dev at /docs/2.x/word-fidelity via the site's
 * <FeatureMatrix> / <FeatureBadge> components (the site syncs this file at
 * build time, same pipeline as docs/site/content). The `tier` field exists
 * so the same data can drive feature access and pricing pages.
 *
 * Status axes:
 * - editing:   can the user (or code driving the editor) change it in the editor?
 * - rendering: does it display like Microsoft Word renders it?
 * - roundTrip: does it survive open -> edit -> save -> reopen without loss?
 *
 * Honesty rule: when in doubt, downgrade. A "partial" that turns out to be
 * full delights; a "full" that turns out to be partial burns trust.
 *
 * Notes rule: notes render inside a table cell, so keep them short. Write
 * Simplified Technical English: active voice, one idea per sentence, 20 words
 * or fewer per sentence. Name the observable behavior, not the internal lane,
 * change proposal, or code path.
 */

export type FeatureStatus =
  | 'full'
  | 'partial'
  | 'render-only'
  | 'preserved' // round-trips losslessly as inert content; editing/rendering may be absent
  | 'planned'
  | 'none';

/**
 * The tiers, as values rather than a bare union, so the test beside this file can check every
 * row at runtime. An invalid tier shipped once because nothing typechecked this file; one source
 * of truth means the suite catches it even where a type gate does not reach.
 */
export const FEATURE_TIERS = ['community', 'premium'] as const;

export type FeatureTier = (typeof FEATURE_TIERS)[number];

export type FeatureCategory =
  | 'text'
  | 'paragraphs'
  | 'lists'
  | 'tables'
  | 'images'
  | 'layout'
  | 'review'
  | 'fields'
  | 'structure'
  | 'collaboration'
  | 'export';

export interface WordFeature {
  /** Stable key, e.g. 'images.wmf'. Never rename; gating may reference it. */
  id: string;
  name: string;
  category: FeatureCategory;
  editing: FeatureStatus;
  rendering: FeatureStatus;
  roundTrip: FeatureStatus;
  tier: FeatureTier;
  notes?: string;
  /** Docs page that covers the feature, e.g. '/docs/2.x/pro/tracked-changes'. */
  docsLink?: string;
}

export const FEATURE_CATEGORY_LABELS: Record<FeatureCategory, string> = {
  export: 'Export',
  text: 'Text & formatting',
  paragraphs: 'Paragraphs & styles',
  lists: 'Lists & numbering',
  tables: 'Tables',
  images: 'Images & drawings',
  layout: 'Page layout, headers & footers',
  review: 'Review: tracked changes, comments, notes',
  fields: 'Fields, links & TOC',
  structure: 'Document structure & content controls',
  collaboration: 'Collaboration, i18n & editing UX',
};

export const wordFeatures: WordFeature[] = [
  {
    id: 'export.markdown',
    name: 'Markdown export',
    category: 'export',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'none',
    tier: 'community',
    notes:
      'File > Export downloads continuous Markdown through docx-to-markdown. Configure menu.exporters.markdown. A dismissible dialog shows progress and errors. Customize it with popups.export. Missing handlers show a setup error. Export preserves the source document.',
    docsLink: '/docs/2.x/guides/export',
  },
  {
    id: 'export.pdf',
    name: 'PDF export',
    category: 'export',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'none',
    tier: 'premium',
    notes:
      'File > Export downloads PDF through docx-to-pdf on Node.js. Configure menu.exporters.pdf. A dismissible dialog shows progress and errors. Customize it with popups.export. Missing handlers show a setup error. Rejects output without a PDF header. In All Markup, text in tracked inserted and deleted table rows takes the row revision mark and author color. PDF conversion requires the EigenPal Pro License. Arabic letters join across supported formatting boundaries and when fallback fonts supply missing glyphs. Arabic, Persian, Urdu, and Hebrew text extracts in logical order as whole words. Missing Hebrew glyphs use Times New Roman, or Liberation Serif when that font is unavailable. The exporter synthesizes bold and italic when the selected font lacks those faces. Install @docx-editor.dev/fonts-cjk for Chinese, Japanese, and Korean fallback fonts on hosts without suitable fonts. Font admission reports faces that exceed shaping limits and tries later sources. Strict font policy refuses rejected document fonts and the configured default font. Shaping-limit rejections for optional glyph fallbacks remain informational. Other source failures still cause strict refusal.',
    docsLink: '/docs/2.x/guides/export',
  },
  {
    id: 'export.print',
    name: 'Printing',
    category: 'export',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'none',
    tier: 'premium',
    notes:
      'File > Print converts the document through menu.exporters.pdf and opens the browser print dialog. Press Ctrl+P, or Cmd+P on macOS. A dialog shows progress and errors, and closes when the browser print dialog opens. Customize it with popups.print. Missing handlers show a setup error. Browsers without a PDF viewer get an Open PDF link instead. Printing requires the EigenPal Pro License.',
    docsLink: '/docs/2.x/guides/print',
  },
  // --- Text & formatting -----------------------------------------------
  {
    id: 'text.basic-formatting',
    name: 'Bold, italic, underline, strikethrough',
    category: 'text',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Structural XML indentation does not hide run text. Authored spaces inside text elements remain part of the document.',
  },
  {
    id: 'text.input-method',
    name: 'Input-method composition',
    category: 'text',
    editing: 'partial',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Empty paragraphs and lines containing only inline pictures provide a visible font for composition text. Committed text supports undo, redo, collaboration, and save/reopen. Native candidate-window placement depends on the browser and operating system; validate your target input methods.',
  },
  {
    id: 'text.format-painter',
    name: 'Format painter',
    category: 'text',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Copies character formatting, and paragraph formatting when the selection covers ' +
      'the paragraph mark. Paragraph borders and character styles stay on the target. ' +
      'Line-fitting spacing adjustments do not become document formatting.',
  },
  {
    id: 'text.sub-superscript',
    name: 'Subscript & superscript',
    notes:
      'Nonzero authored or inherited baseline positions contribute translated run extents to automatic and minimum line spacing, including positioned subscript and superscript text. Exact line spacing retains its authored height.',
    category: 'text',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
  },
  {
    id: 'text.fonts',
    name: 'Font family & size',
    category: 'text',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Configure font sources with the fonts prop; customFonts() loads your own files under private editor font names. Search standard, configured, and provider fonts in the picker, including in blank documents. A standard font that no configured source serves is listed only where the computer has it installed. packagedFonts() also serves Helvetica with the Liberation Sans faces of Arial. Font family and size menus close when you press the document surface. Selecting a font loads it without resetting selection or undo history. The editor validates downloaded files and hashes and resolves theme fonts from the document. Word-compatible wrapping requires font bytes. The fonts package supplies six substitutes: the five default families match covered glyph advance widths, while Century Gothic differs by less than 1% in measured samples. Kerning and glyph differences can still change line breaks. packagedFonts() loads requested families and the default face from packaged assets. googleFonts() adds a pinned remote catalog. Compose sources in priority order with useFonts or useDocxSource; later resolvers can skip faces already loaded. Document font names with commas or semicolons are requested as one family and are not split into candidates. An available whole font-table alternate of up to 31 characters precedes generic substitution. Available script defaults handle unambiguous unresolved names. Names shared across different script defaults retain the existing fallback path. Measurement, painting, and PDF evidence use the selected admitted face. The first collection face paints from the complete admitted bytes, including its signature, under a private browser alias. Other faces use a standalone copy with all selected tables, including DSIG. Collection-header signatures do not block face selection. Registration does not verify signatures. Invalid faces receive no browser alias. Admitted source bytes remain intact. Unmatched families keep fallback measurement. An admitted face that exceeds the shaping byte limit keeps fallback measurement and reports its refusal through onFontError. Eligible non-ASCII text uses its independently declared hAnsi face before measurement and paint. Combining marks retain the base face across source runs. Full-width forms use the East Asian face. Curly and low quotes, en and em dashes, ellipses, and middle dots use hAnsi without an East Asian hint, including beside Han text; existing complex-script overrides still apply. East Asian font hints follow the East Asian language of the run and a Chinese East Asian face for accented and extended Latin letters. Slots no style names use the format default faces, and empty East Asian theme slots use the default face of the theme language. Cached field results use the hAnsi face like other text. Canonical font attributes and model offsets stay unchanged. PDF export reports failed font sources and supports custom fallback sources after embedded fonts. Set fontShaping.maxFontBytes to use admitted faces larger than the default 16 MiB shaping limit, up to 64 MiB. Equal ceiling values preserve the editor instance; changed values reset selection and undo history. Deferred font errors belong to the active document load; replacement and destruction discard older diagnostics. Large font sources can load in the background: the document paints with the other fonts and lays out again when they arrive. Wrap any source in deferFonts() to load it this way. Document export waits for every font.',
    docsLink: '/docs/2.x/guides/fonts',
  },
  {
    id: 'text.embedded-fonts',
    name: 'Embedded fonts',
    category: 'text',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'preserved',
    tier: 'community',
    notes:
      'The editor de-obfuscates the fonts in word/fonts on load and measures text with them. No configuration and no network request are necessary. The binaries round-trip on save. The editor does not add new embedded fonts.',
  },
  {
    id: 'text.color',
    name: 'Text color (RGB + theme colors)',
    category: 'text',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes: 'Theme color references (accent1...) round-trip as references, not flattened to hex.',
  },
  {
    id: 'text.highlight',
    name: 'Highlight & shading',
    category: 'text',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes: 'Word highlight palette plus arbitrary w:shd fills.',
  },
  {
    id: 'text.rtl',
    name: 'Right-to-left text: Arabic, Hebrew, Persian, and Urdu',
    category: 'text',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Paragraphs use inherited bidirectional settings for alignment, script shaping, visual order, and caret placement. Alignment and indents name leading and trailing sides, and kashida alignments justify. Run direction controls numbers and punctuation independently of paragraph alignment. Runs with effective w:rtl or w:cs use complex-script font, size, bold, and italic properties. Formatting commands resolve inherited styles and document defaults, then write both property variants. Direct false values override inherited values. Arabic and other joining scripts preserve letter forms across adjacent formatting runs, including color changes. Joining requires the same bidirectional level and no intervening whitespace. Kerning and cursive offsets across those boundaries remain unsupported. List markers, spacing, indents, and tab stops follow paragraph direction in body text and table cells, and list markers read right to left. Left-to-right and right-to-left paragraph direction controls are in the Format menu, the Paragraph dialog, and the Ctrl+Shift keyboard chords in documents that already contain right-to-left text. The toolbar shows them for a right-to-left interface language. Arabic and Hebrew letters typed into a left-to-right run start a right-to-left run (w:rtl), and Clear Formatting keeps that direction. The document automation API sets and reads paragraph direction with Paragraph.readingOrder. Review cards show a tracked paragraph direction change. Selection highlights can span separate visual bands; some glyph edges have no distinct caret position. Inline pictures read in the direction of the text around them, in paragraph direction between text of different directions or before the first text, and in the direction of the last text after it. They take the caret and clicks on their leading and trailing sides. Numeric page fields and note marks containing only ASCII decimal digits preserve surrounding text order when they occupy one model character. Floating objects, symbols, equations, and other inline objects keep the order and joining of the right-to-left text around them. A right-to-left line beside a floating object fills the passage to the right of the object first, and each part aligns inside its own passage. In a right-to-left run of an Arabic-script language, a slash between digits separates the numbers, so 17/08/96 reads 96/08/17; a Hebrew run keeps the date one number. Right-to-left sections place the first column at the right. Positional tabs and w:dir and w:bdo wrappers have partial support. The i18n package includes Arabic and Hebrew interface translations, and the packaged editor mirrors its controls for them.',
    docsLink: '/docs/2.x/guides/right-to-left',
  },
  {
    id: 'text.cjk',
    name: 'Chinese, Japanese, and Korean text',
    category: 'text',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Type Chinese, Japanese, and Korean text with the input method of the operating system, and format it like other text. Runs select their East Asian font through w:rFonts, theme fonts, and language hints. Line breaking keeps closing punctuation, small kana, and full-width number groups with their characters. Korean text can wrap by word. Use googleFonts({ cjk: true }) for regional Noto Sans fonts, or install @docx-editor.dev/fonts-cjk for one self-hosted fallback font. Both load in the background by default. PDF export on Node.js uses the fonts-cjk package when it is installed. The font picker shows the East Asian font of selected East Asian text; spaces, punctuation, and numbers between East Asian words do not change it. An East Asian font pick applies to the whole selection; a Latin font pick applies only to Latin letters and numbers. The i18n package includes Japanese and Simplified Chinese interface translations. Horizontal text is supported; vertical composition (w:textDirection) renders only in table cells. See East Asian typography for spacing and punctuation compression.',
    docsLink: '/docs/2.x/guides/cjk',
  },
  {
    id: 'text.effects',
    name: 'Text effects (outline, shadow, emboss, emphasis mark)',
    category: 'text',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Opaque solid w14:textOutline with an explicit RGB color renders. Theme-colored, transparent, gradient, dashed, compound, and inset outlines do not render. Legacy outline, shadow, emboss, imprint, and emphasis marks are preserved but do not render. Text effects have no toolbar controls.',
  },
  {
    id: 'text.hidden',
    name: 'Hidden text (vanish)',
    category: 'text',
    editing: 'none',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'The editor does not draw w:vanish runs or give them space, but preserves their text on save. There is no "show hidden text" option. A paragraph with no visible content collapses when its directly hidden mark precedes another paragraph in the same container, or precedes a table and the paragraph states no space before. Collapsed paragraphs still advance list numbering. Paragraphs with section breaks follow the section layout rules instead. Body paragraphs can share display flow when their resolved marks enable w:vanish. The paragraph must contain ordinary visible text unless its mark also enables w:specVanish. The bounded subset requires matching continuation geometry, paragraph direction, line-breaking settings, and keep constraints. It preserves source paragraphs, member text formatting, first numbering and before-spacing, and last after-spacing and paragraph-mark formatting. Mixed geometry, contextual spacing, tracked content, cross-paragraph fields, non-body stories, and chains above 64 members stay separate. Export reports unsupported-style-separator for preserved visible-content joins outside this subset.',
  },
  {
    id: 'text.math',
    name: 'Math equations (OMML)',
    category: 'text',
    editing: 'partial',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Inline (m:oMath) and display (m:oMathPara) equations lay out and paint as math. The document API inserts one inline equation from a Flat OPC package through Range.insertOoxml, untracked or as one tracked insertion that Reject removes whole; other OOXML refuses. Display equations follow m:oMathParaPr justification and center by default when they are the only content of the paragraph. Each equation is one atom in the text: typing beside it creates ordinary runs, and deleting it removes the whole equation. In suggesting mode, a deletion that covers an equation proposes removing the whole equation. The equation popover edits fractions, radicals, scripts, and n-ary operators in a linear format and removes equations; removing the last equation of a display removes the display. Literal and normal text and upper or lower bars also project as math. ASCII digits in authored text fonts use that face with mathematical and run styling. Normal text without a run font uses the paragraph font. Structures whose properties carry m:ctrlPr with supported run formatting project as math; their operator glyphs keep the default math formatting, and save keeps the m:ctrlPr source. When every m:ctrlPr in an equation holds the same default formatting (the Cambria Math font, italic, one size, and a language), compact replacement is available and writes the same m:ctrlPr on each structure it creates. The same rule applies to w:rPr on equation runs without m:rPr: when every run holds the same default formatting, compact replacement is available and writes the same w:rPr on each run it creates. Each supported equation run uses its own w:sz, including within display equations. Unsized runs inherit the surrounding text size. Script and fraction text scales from each authored size. The equation bounds and automatic line height include the largest run. Exact line spacing keeps its authored height. Compact replacement is disabled for formatted equations, bars, and other control properties because it cannot preserve their source properties. You can remove these equations and edit ordinary text beside them. Constructs outside the supported subset show a text fallback and stay read-only. Unedited equations round-trip verbatim.',
  },
  {
    id: 'text.symbols',
    name: 'Symbol characters (w:sym)',
    category: 'text',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Symbol runs render and survive editing and save. The editor requests fonts for symbol runs, SYMBOL fields, and used numbering markers through the configured font resolver. You can insert a symbol from the Insert menu. A symbol is one character of the paragraph text and reads as an opening parenthesis. The caret steps over it in one move, and Backspace or Delete removes it. Search never matches a symbol. Non-breaking and optional hyphens are characters of the paragraph text, read as U+001E and U+001F, and select, search, and delete like any character. A line can break after an optional hyphen, which then shows as a hyphen at the line end. Existing symbol run properties are not editable.',
  },

  // --- Paragraphs & styles ---------------------------------------------
  {
    id: 'paragraphs.alignment',
    name: 'Alignment & justification',
    category: 'paragraphs',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Justified lines compare space compression with expansion at an earlier break, including hyphenated fragments and fixed REF results. Justified East Asian lines distribute inter-character spacing. Modern Latin justification measures complete words across formatting runs and terminal note citations before compressing spaces. Citations with reserved page-local widths retain their existing line-break behavior. The final line of a justified paragraph keeps natural spacing at its leading edge. Distributed paragraphs stretch their final line, including table cells and each passage beside a floating object. With the w:doNotExpandShiftReturn compatibility setting, a line that ends in a manual line break keeps its natural spacing. In documents that declare compatibility mode 14 or earlier, or no mode, a line that ends in a page or column break stretches to both margins; in mode 15 and later it keeps its natural spacing. Tabs and float passages retain their reserved positions.',
  },
  {
    id: 'paragraphs.east-asian-typography',
    name: 'East Asian typography',
    category: 'paragraphs',
    editing: 'preserved',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Automatic spacing separates East Asian text from Latin letters or ASCII digits. Paragraph properties and inherited styles control each boundary type. Layout and caret geometry use the added advance without source spaces. East Asian text adds one quarter of its authored font size before Latin letters or ASCII digits. The reverse boundary adds half the average character width of the authored Latin font. Common default fonts keep their own value when a substitute font draws them; other fonts need their own font file. Explicit character spacing and unsupported run forms keep their existing advances. Keeps graphemes, punctuation, and full-width number groups together across runs. No-break spaces and word joiners retain their line-break behavior across formatting runs. Theme languages and inherited language hints select Latin, East Asian, and complex-script fonts; unresolved Chinese, Japanese, and Korean faces use named defaults. Font resolvers receive these candidates before shaping. Document settings control line breaking, Korean word wrapping, punctuation overflow, and compression. Text that a line-break rule keeps together, such as a small kana after a digit or a closing mark after its character, moves to the next line as one unit. A unit wider than a whole line breaks at its last fitting character, as a long Latin word does. A justified line keeps the unit whole when it fits with its automatic spacing at half width. Punctuation overflow hangs line-end punctuation only in justified paragraphs, including Latin punctuation in East Asian language runs; the punctuation before a hanging mark can also compress to fit the line. A document whose defaults name no East Asian face neither hangs punctuation nor compresses it to fit a line. Adjacent punctuation can share spacing, and narrow plain left-to-right justified paragraphs can use measured glyph bounds for fitting; paragraphs with other alignments wrap instead of fitting. Qualified mixed lines can fit by sharing measured East Asian punctuation bearings with complete Latin words, digit groups, or ASCII symbol groups while preserving their natural advances. Later Latin text does not disable an earlier eligible East Asian line. This requires resolved faces and a measured outline for each whole word, with no authored tracking or horizontal scaling. A justified line takes the next glyph by compression when the share of its punctuation capacity that it uses is no larger than the expansion that wrapping the glyph would need, and a final mark that hangs or gives up its trailing half counts toward that capacity; adjacent punctuation gives both blank sides. Curly quotes in runs with the East Asian font hint (`w:hint="eastAsia"`) can give the outer half of their advance next to East Asian characters, punctuation, or Latin words on a line that also contains East Asian punctuation; curly quotes without the hint keep their natural advances. Authored spaces, paragraph boundaries, decorated text, tracked changes, right-to-left text, complex shaping, unknown scripts, fields, and gaps beside floating objects retain conservative spacing or fitting. Kana uses fixed advance reductions. Vertical Japanese composition and typography controls in the UI are unavailable. Only WordprocessingML namespace elements and attributes set run properties, including the run language; foreign extensions remain saved without changing them. Adjacent full-width punctuation compression uses both runs’ kern thresholds, and the document’s noPunctuationKerning setting. It applies only when the East Asian face of the document defaults is an East Asian font. It does not disable Latin font kerning. Kana compression retains natural advances on non-full lines. Table AutoFit sizes the minimum width of East Asian text at legal line breaks, so a column of ideographs can narrow to a single character. When line layout compresses a punctuation pair inside one unbreakable segment, the AutoFit minimum uses the compressed width. The AutoFit maximum uses the compressed width of every pair. See Word fidelity for individual compression rules.',
    docsLink: '/docs/2.x/guides/cjk',
  },
  {
    id: 'paragraphs.complex-script-line-breaks',
    name: 'Thai, Lao, Khmer, and Myanmar line breaking',
    category: 'paragraphs',
    editing: 'preserved',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Lines in Thai, Lao, Khmer, and Myanmar text without spaces wrap at any character cluster that fits, not at dictionary word boundaries. Table AutoFit keeps an unspaced run whole as one segment. Lines can end after a zero-width space (U+200B) in any script, which marks a word boundary, and the zero-width space stays at the end of the line. A space before a zero-width space counts as text while it fits, and hangs only when it does not fit. Line breaks never split a character cluster, a Khmer or Myanmar stacked consonant, or a Myanmar consonant and its vowel sign or visarga.',
    docsLink: '/docs/2.x/word-fidelity',
  },
  {
    id: 'paragraphs.spacing',
    name: 'Line & paragraph spacing',
    category: 'paragraphs',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Space before, space after, and line spacing (single, multiple, exactly, at least) all reach pagination. If a document does not define its default paragraph properties, paragraphs use 8pt space after and 278/240 automatic line spacing. If it does not define its default run properties, text uses 12pt. An explicitly empty default keeps 10pt text with no spacing. The engine uses line spacing when it calculates page breaks. The paragraph mark size sets the height of an empty paragraph and of the empty line after a trailing line break. A larger mark does not make a line with text, an inline picture, or an equation taller. A line with only inline pictures takes the text height of the runs that hold them, not of the paragraph style or the mark. A line with superscript or subscript text, including a note reference, keeps the full-size height of that text above and below the baseline on every line of the paragraph, and a larger paragraph style size does not make that line taller. Multiple line spacing scales a line with raised or lowered text by its height without the raise, and the raise adds its height unscaled. Spaces and tabs do not set line height, so a line with only spaces or tabs is as tall as an empty paragraph. A character style on the paragraph mark sets the height of an empty paragraph and of the empty line after a trailing line break, and formats the list number. Text typed into an empty paragraph takes that character style. The style does not make a line with text or an inline picture taller. Contextual spacing drops the gap between neighbours of the same style in body text and table cells, including implicit default styles. Line-unit paragraph margins use 12pt units or the section grid pitch. In a section with a document line grid, each body line takes whole grid lines with its text centered. The space below the text in a grid line can extend past the bottom margin, so a line fits when its text fits. Multiple line spacing counts in grid lines: a line takes the larger of the grid lines its text needs and the multiple, so double spacing is two grid lines. At-least spacing up to the grid line takes the grid line, and a taller at-least value keeps its own height with the extra above the text. Paragraphs that turn off grid snapping and paragraphs with exact line spacing keep their own line height. Without a grid, at-least spacing adds its extra height above the text, so the whole line must fit above the bottom margin. With single or multiple spacing, only the space below the text can extend past it, including the lower part of a grid line. Table cells snap only with the adjustLineHeightInTable compatibility option. Footnote and endnote text snaps to the grid of the section that holds it. Headers, footers, and text boxes do not snap. Numbering-level paragraph properties participate in layout. The Paragraph dialog sets contextual spacing. Automatic spacing (w:beforeAutospacing, w:afterAutospacing) uses 14pt in body paragraphs and at list boundaries. Adjacent items in the same list suppress automatic spacing, including nested levels. Lists suppress automatic leading space at section start. Table cells suppress automatic spacing at their outer edges. Adjacent space after and space before collapse to the larger of the two. If the document sets w:doNotUseHTMLParagraphAutoSpacing, they add up instead, in body text, table cells, headers, footers, notes, and text boxes, and automatic spacing is a fixed 5pt before and 10pt after.',
  },
  {
    id: 'paragraphs.pagination',
    name: 'Keep with next, keep lines, widow/orphan control',
    category: 'paragraphs',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'w:keepNext, w:keepLines, w:widowControl and w:pageBreakBefore all reach pagination, and the Paragraph dialog sets each of them. Keep-with-next groups account for the following paragraph’s keep-lines and widow-control requirements when the group fits on a page. Groups can contain more than eight consecutive paragraphs, including paragraphs with inherited keep properties. Explicit page breaks and section boundaries end the group. A kept paragraph that does not fit in the space left on a page splits there if its own keep-lines and widow-control settings allow it, and its last lines open the next page with the following paragraph. In documents that use Word 2013 or later layout, the last kept paragraph that fits before a following paragraph that does not also splits, and its last lines move with that paragraph. This applies to any paragraph in a keep-with-next chain. Earlier layout modes move the chain whole. A value a style supplies reads through the cascade, so a checkbox shows what is in force rather than only what the paragraph authors itself. In a body table, keep-with-next on the first paragraph of the first cell keeps the row with the next row, or with the paragraph after the table. The value can come from paragraph or table styles. Kept rows move to the next page as a group when they and the start of what follows do not fit. A kept row does not split. The next row needs only the first lines of each cell, unless it cannot split. In documents that use Word 2013 or later layout, a row after a kept row does not start a new page: it is the next row of the group, which moves only when it does not fit. In earlier layout, a row that starts a new page ends the group. In Word 2013 or later layout, header rows keep with the first body row in the same way. A keep-with-next paragraph before a table keeps with the header rows, and in Word 2013 or later layout also with the first body row. When every body row keeps, that paragraph also keeps with what follows the table. A kept paragraph before an oversized table opening first moves to a fresh page, even when the table cannot fit beside it. Table keep decisions measure up to 256 kept rows and the next row; paragraph lookahead remains separate. A keep chain continues through one table only. Closed vertical merges inside the measured group share their height across their rows. Merges entering or leaving the group, active wrap exclusions, rows whose first cell starts with a nested table, and positioned tables keep their existing placement.',
  },
  {
    id: 'paragraphs.indentation',
    name: 'Indentation (incl. hanging indents)',
    category: 'paragraphs',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Left, right, first-line, and hanging indents control line placement. Increase Indent and Decrease Indent are on the toolbar, on Tab, and on Ctrl+M. Inside a list they change the level, so the marker changes too. Outside a list, Tab over a selection of two or more paragraphs indents them, and Tab over a selection that starts at a paragraph start sets a first-line indent, or steps the left indent when the first line is already indented or hanging. Shift+Tab reverses these steps. The selected text stays. In a table cell, Tab and Shift+Tab move between cells instead. A caret, or a selection in one paragraph that starts inside the text, types a tab character.',
  },
  {
    id: 'paragraphs.styles',
    name: 'Paragraph styles (Heading 1, Quote, custom styles)',
    category: 'paragraphs',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'The style picker applies document styles, including custom styles with their numbering and indents. Pressing Enter at the end of a paragraph starts the next one in the style that the current style names as its follower (w:next), so a heading is followed by body text. Defining a new style in the UI is not supported yet.',
  },
  {
    id: 'paragraphs.borders',
    name: 'Paragraph borders & fills',
    category: 'paragraphs',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Paragraph shading (w:shd) is editable. Borders render the common ST_Border styles: single, double, dashed, and dotted. Triple and the thin-thick styles draw each stroke and gap at its authored width, also on page borders. Thick, 3-D, inset, and outset styles use CSS approximations, and art borders paint as a solid rule. A border box starts where the first line starts, so a hanging indent moves its edge outward. Adjacent paragraphs with identical borders draw one box when their box edges match. Borders round-trip, but you cannot add, change, or remove them in the editor yet.',
  },
  {
    id: 'paragraphs.tabs',
    name: 'Tab stops & leaders',
    category: 'paragraphs',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      "Existing tab stops render, with right and decimal tabs and dot, hyphen, and underscore leaders. In left-to-right text without adjacent floating objects, opening words wrap after leading left-aligned tabs without adding a blank line. In table cells without consecutive tabs, an ordinary left tab whose next stop exceeds the line edge moves to the next line before following text. Trailing tabs keep their line. Positional tabs (w:ptab) render too, so a contents line reads as one: entry left, leader dots between, page number right. The document's own w:defaultTabStop is honored, in the body and in headers and footers. The Paragraph dialog sets, clears, and replaces tab stops, including clearing one that a style supplies. Bar tabs are preserved on save but aren't drawn or editable.",
  },
  {
    id: 'paragraphs.frames',
    name: 'Drop caps & text frames (framePr)',
    category: 'paragraphs',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'In single-column sections, bounded body text frames support numeric and relative page, margin, or text positioning; fixed width or the containing text column width when width is omitted; auto, minimum, and exact height; every rectangular wrapping mode; single-line left-to-right dropped caps; and bidirectional margin drop caps. Multiline dropped caps, negative text-relative vertical offsets, and right-to-left dropped caps retain ordinary flow to prevent text overlap. A positive authored height sets a minimum when its height rule is absent. Frame attributes inherit individually from styles. Wrapping defaults alone retain ordinary flow. Adjacent paragraphs with identical resolved frame properties share one frame, including inline pictures. Exact-height content clips to the authored rectangle. Locked anchors remain attached during supported edits. Continuous sections clear preceding frames that intersect the body area. Frames outside that area do not advance text flow. Text remains selectable and editable; frame creation, movement, and resizing have no UI. Centered auto-sized, right-aligned auto-sized over a text line or empty paragraph, and supported fixed-width PAGE footer frames retain their specialized layout. Fixed-width PAGE footer frames over an empty anchor honor numeric page-relative X positions. Exact-height frames also honor numeric text-relative Y positions and clip to their authored rectangle. Unsupported frame attributes retain ordinary flow. Centered PAGE footer frames support auto and around wrapping with direct formatting, unused tab stops, line spacing, and nonnegative first-line indents. The frame and empty anchor share one footer band. A right-aligned frame over an empty paragraph can contain plain text around a simple or complex PAGE field. The empty paragraph sets the flow height. The frame retains its own spacing, except that fixed paragraph spacing suppresses its extra leading space. In a header, an auto-sized frame that opens the header and is empty or holds a PAGE field or plain text shares the first line of the next paragraph at the left, center, right, inside, or outside margin, and adds no height. A text-free frame also preserves the following anchored drawings without adding a line. Whitespace-only frames keep ordinary flow. Inside and outside alternate with the physical page, so a page number restart does not change the side. If a nonempty frame would meet the text of that paragraph, a table, a drawing, or a paragraph border, the header keeps ordinary flow. Headers also support bounded page-anchored plain-text frames with numeric positions and widths. Adjacent paragraphs with identical direct frame properties share one frame, including its paragraph borders and auto or minimum height. These frames do not increase the body inset. Ordinary header paragraphs and inline images keep their flow positions. This subset requires an ordinary paragraph and nonoverlapping content. Headers with fields or revisions, and frames with exact heights, negative positions, or unsupported properties, keep ordinary flow. Frames with unsupported content and groups that block a full fresh page use ordinary flow. All frame properties survive save.',
  },
  {
    id: 'paragraphs.hyphenation',
    name: 'Automatic hyphenation',
    category: 'paragraphs',
    editing: 'none',
    rendering: 'none',
    roundTrip: 'preserved',
    tier: 'community',
    notes:
      'Document hyphenation settings round-trip; the layout engine does not hyphenate automatically. A line can break at an optional hyphen in the text. The line then ends with a visible hyphen, which counts toward the line width. A U+00AD character in run text shows as a hyphen and is not a break opportunity.',
  },

  // --- Lists & numbering -------------------------------------------------
  {
    id: 'lists.bullets',
    name: 'Bullet lists (multi-level)',
    category: 'lists',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'The toolbar toggle creates the numbering definition on first use, so a document that never carried a list can start one. Known single-byte Symbol and Wingdings bullets use Unicode fallback when their font is unavailable. Layout still uses the line height and advance widths of the symbol font. Saved numbering stays unchanged. It also applies the List Paragraph style, the way Word does, which is what closes the space between consecutive items. Turning the list off leaves the paragraph in List Paragraph, and indented, as Word does; pressing Enter on an empty item leaves the list and returns to the margin. Enter within a list item continues a single blank-paragraph separator established by preceding items at the same level, including tracked breaks. Tab and the indent buttons change the level, and the marker changes with it.',
  },
  {
    id: 'lists.numbered',
    name: 'Numbered lists (decimal, roman, letters)',
    category: 'lists',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Numbered lists take the List Paragraph style on the same terms as bulleted ones, so consecutive items close up. The tab after a number stops at the first tab stop past the number when that stop comes before the text indent, so the first line can start left of the indent and fit more text. If the document sets w:doNotUseIndentAsNumberingTabStop, the first tab stop past the number applies wherever it is, and the text indent applies only when no such stop exists. Hebrew (hebrew1, hebrew2), Arabic (arabicAlpha, arabicAbjad), and Devanagari digit (hindiNumbers) formats number in their own scripts. Other script-specific formats fall back to decimal. A level with empty number text, such as w:numFmt="none", paints no number but keeps its suffix: a tab moves the first line to the next tab stop, a space moves it one space, and no suffix starts it at the number position.',
  },
  {
    id: 'lists.custom-numbering',
    name: 'Custom numbering definitions & style-linked numbering',
    category: 'lists',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes: 'Numbering attached to custom paragraph styles resolves with Word’s precedence rules.',
  },
  {
    id: 'lists.continuation',
    name: 'List continuation & restart',
    category: 'lists',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
  },
  {
    id: 'lists.picture-bullets',
    name: 'Picture bullets (numPicBullet)',
    category: 'lists',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'community',
    notes:
      'A numPicBullet marker renders as its image, scaled by the marker run font size, in the editor and in PDF export. The level bullet text renders instead when the image is missing or is a media type the editor does not decode. You cannot choose or change a picture bullet in the editor. The numPicBullet definition and its markup are preserved on save.',
  },

  // --- Tables -------------------------------------------------------------
  {
    id: 'tables.editing',
    name: 'Table insertion & cell editing',
    category: 'tables',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Files without a compatibility mode, and files in compatibility mode 11, 12, or 14, align the content of a top-level percentage-width table with the text column, for every alignment, indent, and layout, and measure the percentage against the text column plus the stated outer cell margins. The same settings apply in body, header, footer, text-box, and note stories. A table percentage width can be larger than 100%, up to 655.34%, and extends the table past the text column for every alignment, AutoFit and fixed layout, and compatibility mode. Fixed tables without a positive table width can use cell preferences to replace their initial grid. Each cell must have a positive absolute width and occupy one column. The largest preference in each column sets its width, even when the initial grid is wider. Hidden revision rows prevent this replacement. Other width conflicts keep their existing reconciliation. A table indent moves a left-aligned table by the full amount, also when the table is wider than the text column or the indent is wider than the space left. A negative indent moves the table into the left margin. Centered and right-aligned tables ignore the indent. A right-to-left table measures the indent from its leading edge. Nested tables ignore a negative indent. A zero indent on a table overrides the indent of its table style. An AutoFit column widens to hold its widest unbroken word, such as a long URL, with indents and cell margins; the other columns give up width in proportion to their spare room. Spaces that open a cell paragraph do not join its first word. A column that has to widen keeps the first-line indent with that word in compatibility mode 15; files without a compatibility mode, and modes 11, 12, and 14, leave a first-line indent out of the minimum. A cell with `w:noWrap` that covers one column keeps that column at least as wide as its preferred width. When the minimums are wider than the text column, the columns shrink in proportion to their minimums to the wider of the text column and the table. A top-level AutoFit table with an absolute width wider than the text column, in any section column, is the exception: a narrower grid stretches to that width, and minimums wider than it widen the table, also past the page edge. Nested, fixed, text-box, and percentage-width tables keep the first rule. An AutoFit column whose cells state no width is sized by its content: it takes its widest unwrapped line when the table has room, and room beyond that is shared in proportion to those widths. Columns with a stated width give way to them first; then they wrap. A cell that spans columns widens them to hold its own widest word, and the columns outside the span give up the width. A nested fixed table needs only the content it holds and paints no wider than its cell: its columns give way down to their own content. A nested AutoFit table also keeps its resolved width. Both keep their leading indent; a narrowed nested fixed table keeps the width its cells of vertical text have. Elsewhere, cells with vertical text set no minimum. Cell spacing sits on each side of every cell, so cells sit twice the spacing apart and from the table edge, within the table width. Rows are separated the same way: the cells of each row start twice the spacing below the row above, and the table ends twice the spacing below its last row. A minimum row height sizes the cell below that gap, and an exact row height keeps its authored value. When every row states the same row-level cell spacing and the table states none, that spacing applies to the table. An AutoFit table in which every column states an absolute width starts from those widths, raises each column to its widest word, and then gives up width in proportion to how far each column is wider than that minimum. In older modes, a table with zero cell margins aligns its content with the text column, and a text-box table uses a reference box 0.75 points wider and puts the outer edge of a right-aligned table on the right edge of the box.',
  },
  {
    id: 'tables.rtl',
    name: 'Visually right-to-left tables',
    category: 'tables',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Authored w:bidiVisual tables display logical cells from right to left, including merged cells and repeated headers. Table styles can supply the property; a direct false value overrides it. Borders, margins, alignment, selection, column insertion, and divider resizing follow the visual grid. HTML copy and paste preserve explicit table direction and physical cell borders and margins. Changing table direction and resizing the outer right edge of an RTL table are not supported.',
  },
  {
    id: 'tables.rows-columns',
    name: 'Row/column insert, delete, resize',
    category: 'tables',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Tab and Shift+Tab move to the next or previous cell and select its content, also from a list item, and with several cells selected they select the first of them. Shift+Tab in the first cell keeps the caret where it is. Tab in the last cell adds a row and puts the caret in its first cell, or does nothing when the row cannot be added. Option+Tab or Ctrl+Tab types a tab character in a cell, and does nothing with several cells selected; browsers usually keep Ctrl+Tab for switching tabs. Tables in headers, footers, and notes behave the same; in a table inside a text box, Tab keeps its paragraph behavior. Hover controls insert a row or column. Drag a divider or the outer right edge to resize. Row drags stop at 8 points, or the initial height when the row starts shorter. Column resizing supports merged cells in left-to-right tables. A divider shows where the row has a cell edge. Legacy horizontal merges, row offsets, and merged right-to-left tables remain unsupported for column resizing. Column insert and delete work on tables with merged cells: a merged cell that spans the edited column widens or narrows. The context menu adds nine structural actions, including Merge cells and Split cells. Both adapters ship the same table chrome. The automation object model adds rows at table edges or before and after an ordinary row. Unrelated merged headers survive row insertion. Automation row insertion refuses merged source rows and boundaries that cross vertical merges. New rows and columns copy the paragraph formatting of the cells they come from, and written values take that formatting too.',
  },
  {
    id: 'tables.borders-shading',
    name: 'Table and cell borders & shading',
    category: 'tables',
    editing: 'partial',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Both adapters expose contextual toolbar controls that set borders and fill on the selected cells. Authored table and cell borders, row border exceptions (w:tblPrEx), and table-style shading render and round-trip. Cell diagonals (w:tl2br and w:tr2bl) render in the editor and PDF export. They inherit through table styles, and explicit nil or none clears them. Each physical cell fragment uses its own diagonal endpoints; a continuous diagonal across pages is unsupported. Diagonal border editing and HTML clipboard transfer are unavailable. Direct cell shading renders. Direct table shading (w:tblPr/w:shd) is preserved but does not render. Apply shading to cells when you need a visible table background. A rule that two cells share paints once, centered on the boundary between them. Rows with omitted leading or trailing grid cells retain their exposed side borders. Explicit cell borders take precedence at those edges. An explicit empty cell border clears its own inherited rule but preserves a border inherited by the neighboring cell. With no compatibility mode, or mode 11, 12, or 14, simple single side rules are centered on the grid line. This applies to top-level, unpositioned, left-to-right tables without cell spacing. If the table has an absolute width, its side cell margins start at the center of the rule, and supported left-aligned fixed tables with automatic widths also use that margin space. Fixed tables with automatic or absolute widths align their leading cell content with the table indent when every row covers the grid and shares that leading margin. Their margins must clear half of each simple side rule. In compatibility mode 15 and later modes, both apply to centered tables with an absolute or automatic width. They also apply to left-aligned or right-aligned tables with an absolute or automatic width and one simple rule width on every cell side. Autofit and right-aligned tables use this geometry only when their outer borders fit within the available width. Tables with complete grid rows and missing side borders share the grid line with cell margins when all visible side borders use one simple rule width. These partial frames keep their existing grid position. Those tables with complete frames put the outer edge of the rule on the aligned edge, so the grid moves inward by half a rule. Leading-aligned fixed-width right-to-left tables with an absolute width and equal simple side borders share the border with cell margins in compatibility mode 15 and later modes. Their grid moves left by one border width. Nested tables, floating tables, and spaced cells keep their existing geometry. Other tables start the side margins at the inner edge of the rule.',
  },
  {
    id: 'tables.merge',
    name: 'Merged cells (horizontal & vertical)',
    category: 'tables',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Authored merges render and round-trip. A vertical merge takes its height from the rows it covers, and merges that cover the same rows share that height. If every covered row has a fixed height and the text is taller than the rows, the text flows through all of them and is clipped at the bottom of the last row. A vertical merge that contains other vertical merges in other columns is sized with them. A vertical merge inside repeated header rows is sized the same way on the first page and on every repeat. A merge that continues from the header rows into the body rows sizes its first header row instead. A merge that only partly overlaps another one sizes its first row instead. A row inserted at a boundary inside a vertical merge extends the merge by one row and keeps one cell per column. Deleting the row where a vertical merge starts removes that row’s content and starts the merge in the next row, unless a merged cell above on the same grid columns takes that row over. If no later row continues the merge, the surviving cell becomes unmerged. A continuation cell with no merged cell above it starts its own merge when another row continues it. Merge cells joins a selected rectangle into its top-left cell, which keeps the content of every cell that had content, in reading order. Split cells divides a cell into rows and columns of equal size from a dialog; a cell merged over several rows splits into a number of rows that divides its rows. Both are in the context menu and the table toolbar, and the automation object model offers them as Table.mergeCells and TableCell.split. Both refuse in suggesting mode, because a merge or split has no tracked form, and on legacy horizontal merges. They synchronize in collaboration and undo as one step. Text a participant types into an empty cell while a peer merges it away is discarded. Concurrent merges, splits, and column edits of one table can leave a row that ends before the last grid column; a merge or split that needs its missing part then refuses.',
  },
  {
    id: 'tables.page-break',
    name: 'Tables split across pages',
    category: 'tables',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'A row that closes a page reserves room for its bottom border. Supported fixed-height rows that end a table, or end a page of a table, place equal-width single bottom rules outside their authored content height. On a page break, that rule is the bottom border of the table. A fixed-height row that opens a later page of its table grows above its authored height by the part of the top border that is wider than its inside border. These rules retain eighth-point widths no greater than 12pt. The table uses collapsed borders and complete horizontal-text rows. Repeated headers, horizontal spans, and vertical merges use the same terminal rule. Top and bottom widths can differ. A row that does not fit together with its bottom rule moves to the next page. A rule that ends exactly at the margin fits. A row at the top of a page stays, and its rule can extend past the margin. In compatibility mode 15 and later, repeated headers are omitted on a page where the row fits below them only without its rule. In earlier modes, the row stays below the repeated headers. Center-aligned and bottom-aligned cell text uses the authored height and margins without internal border space. Nested content, floating tables, compound bottom rules, unequal bottom-cell widths, and supported bottom-to-top cells keep their existing geometry. Source text and saved XML remain unchanged. Fixed-height horizontal cells keep the visible part of a line that starts inside their content box. The authored row height, source text, and line metrics remain unchanged. Empty paragraphs in table cells retain a line and caret space when w:hideMark excludes the end marker from row minimums. Rows split mid-content with correct cut borders. In a body table, pageBreakBefore on the first paragraph of the first cell starts the row on a new page. The value can come from paragraph or table styles. In documents that use Word 2013 or later layout, a row after a row that keeps with the next one does not start a new page. The break skips remaining columns and repeats header rows. A row that starts a vertical merge, or follows one that has ended, can start a new page. A row that continues a vertical merge in any column ignores the property and keeps its placement, because the merge continues through that row. Nested and positioned tables also keep their existing placement. A row that cannot split still clears wrapping header or body pictures. It splits when the fresh space below the picture cannot hold it. A row that cannot break across pages moves to the next page, and a row of that kind taller than a page starts on a new page. In compatibility mode 15 and later, it then splits. In compatibility mode 14 and earlier, or with no mode, it stays whole on that page and runs past the bottom margin, and the next content starts on the following page. Lines past the bottom edge of the page are not shown. The page keeps the first line of the first footnote that the row references, at the bottom of the page over the row. The rest of that footnote and the later footnotes of the row continue on the next page. When a footnote continued from an earlier page has no room on that page, the footnotes of the row start only after that footnote ends. This applies to a text-only row on a page without wrapping pictures. If the page holds a wrapping picture, including a picture in the header or footer, the row splits. A row with a vertical merge also splits. A row with a nested table splits too, although it should stay whole. This is a known difference. Keep-with-next content before such a row, also a kept row or a header row, moves to the next page by itself, and the row starts on the page after it. Authored header rows above such a row stay on their page, and the row starts on the next page. In compatibility mode 14 and earlier, the header rows repeat above the row there. In compatibility mode 15 and later, the row takes that whole page, and header rows below other content first move to the next page by themselves, together with a kept group that opens the body. A row with a minimum height starts below other content only when the space left holds that minimum and the rule that closes the page where the row splits. The part of a split row on the next page is at least as tall as that minimum. Otherwise it moves to the next page, also when its content is taller than a page, and a keep-with-next paragraph before the table moves with it. A minimum larger than a fresh page starts on a fresh page. Completed row content fills the available page band. In documents that use Word 2013 or later layout, repeated headers yield when they would displace the row minimum. In compatibility mode 14 and earlier, or with no mode, repeated header rows stay above a row that cannot split, fits a fresh page, and does not fit below them. That row stays whole below them and runs past the bottom margin. If that row is not taller than a page, it keeps none of its footnotes on that page. They start on the next page, each with its own mark. Authored header rows account for wrapping pictures when keeping with the first body row. Rows of positioned tables that break across pages apply the same minimum height rule. Positioned tables retain their body text wrap region when drawing obstacles require immediate placement. Vertically merged cells repaint on continuation pages. In documents that use Word 2013 or later layout, a vertical merge over two rows can break right after its first row. If the merged text cannot place a line within that row’s own height, the row keeps its own height and the merged text starts beside the second row on the next page. Supported text-only merges over three or more fixed-height or nonbreaking body rows carry text and cached fields between page fragments. The original head cell remains the address for selection and commands. Each fragment uses its own vertical alignment. A nonbreaking last row grows with the remaining text and moves to the next page as a whole. If every row has a fixed height and the text is taller than the rows, the text continues through the rows on each page and is clipped at the bottom of the last row. Overlapping merges, manual breaks, drawings, notes, nested tables, floating tables, and unsupported formatting keep their existing placement. Merges over more rows, and merged text that splits inside the first row, keep their existing placement. Repeated headers and bounded complete text rows reserve their shared horizontal border before pagination. In compatibility mode 15 and later, when the last page of a table leaves out the repeated header rows, the content after the table starts on the next page, even when it fits below the table. In compatibility mode 14 and earlier, or with no mode, the first body row below a repeated header reserves the wider of its own top border and the bottom border of the header. In compatibility mode 15 and later, it reserves the border it shares with the row above it in the table. This boundary adjustment excludes spaced cells, vertical merges, split rows, positioned tables, drawings, nested tables, and vertical text.',
  },
  {
    id: 'tables.nested',
    name: 'Nested tables',
    category: 'tables',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'The innermost table owns the resize controls, the structural edits, and the cell borders and fill. Outer tables stay unchanged through save and reopen. A nested table continues across pages between its rows, and a nested row taller than the space left splits inside its cells. A nested table with header rows or vertical merges moves whole to the next page, and splits there when a page cannot hold it.',
  },
  {
    id: 'tables.conditional-formatting',
    name: 'Table styles & conditional formatting (header row, banding)',
    category: 'tables',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Table styles resolve through their basedOn chain, and a table that names no style resolves the document default. Borders, cell margins, shading, and conditional paragraph and run formatting come from styles.xml, so a header row comes out bold and centered. Cell text in the default paragraph style keeps the font size of that style when the table style states no size. w:tblLook gates which conditional formats apply, and an explicit w:cnfStyle wins. Conditional cell margins and a table-style picker are not built yet.',
  },
  {
    id: 'tables.floating',
    name: 'Floating tables (tblpPr anchored position)',
    category: 'tables',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'An anchored table uses tblpXSpec or tblpX across the text, margin, or page box, and tblpY or tblpYSpec against its vertical anchor. Only WordprocessingML properties control floating-table placement and stacking. Foreign XML extensions remain preserved. Body text wraps beside supported floating tables and below full-width tables, including authored text distances. Empty paragraphs follow the table wrapping rules and retain their line height. Full-width table exclusions move empty paragraphs below the table, with or without empty runs or bookmark boundaries. Passages of a quarter inch or less remain empty, so captions and headings clear near-full-width tables. Text-anchored tables with numeric vertical offsets move with their following paragraph and do not add table height to paragraph flow. A floating table that pushes its own anchor paragraph past the bottom of the page or column stays in place, and only the anchor moves on. Negative offsets retain their position when clear of preceding text. In a single-column section, a table that leaves a quarter inch or less beside it keeps its position over preceding text, and the lines it covers move below it; a narrower intersecting table moves below that text. Page- and margin-anchored tables also wrap the earlier text on their page, and move the earlier lines they cover below them when they leave no passage. At the top of a page, a negative offset can place a text-anchored table in the top margin. Page- and margin-anchored tables that span the text column move to the next page with their following paragraph when earlier text on the page cannot clear them and still leave room for that paragraph. A table that leaves a quarter inch or less beside it counts as spanning. Page- and margin-anchored tables that overlap the text column and reach below the bottom margin break across pages in single-column sections. Such a table starts at its authored position, or higher so that the part that fits on the page ends at the bottom edge of the page, and continues at the top of the next page. Text after the table continues on the page of the last part, beside it or below it, and rows split even when they are set not to break across pages. A row whose minimum height does not fit moves to the next page, and a nested table row moves whole. In documents that use Word 2013 or later layout, the first part ends at the bottom margin. In earlier layout, only a table that reaches below the bottom edge of the page breaks, and its first part can reach that edge. The part that fits is the whole rows that fit and the lines of the next row that fit below them. Tables with an exact-height row, tables with a line or row taller than the page, tables outside the text column, tables that start in the bottom margin, tables that share an anchor paragraph, tables whose anchor paragraph has a page break, column break, or space before it, and documents with doNotBreakWrappedTables keep their placement. Text-anchored tables using vertical alignment retain row pagination. Tables affected by earlier wrapping pictures or frames, or by wrapping pictures in a header or footer, are placed in the flow and break even when a keep-whole condition applies. A text-anchored table marked no-overlap still floats. When it would cover an earlier floating table, it moves right of that table, left of it in compatibility mode 15 and later, or below it. Floating tables can overlap one another, and the cell text of a table placed at its anchor never wraps around another. Adjacent floating tables with identical positions and no paragraph between them stack into one table. A continuous section on the same page wraps its text beside the floating tables and wrapping pictures of earlier sections. An ordinary table that would cover a floating table starts below it. Before compatibility mode 15, a right-aligned floating table in the body moves right by its table cell margin. A text-anchored table that does not fit the rest of the page breaks across pages when that space holds its opening. The opening is the header rows and the first line of each cell in the first body row, or that row’s minimum or exact height. A table taller than a page also breaks. If the opening does not fit, the table moves to the next page and keeps its offset, and so does a table with a negative offset that does not fit the space left. Later parts start at the top of the next page, below repeated header rows. Rows break as in a table without a position, even when they are set not to break. The following paragraph continues on the page of the last part. If the last part leaves no room beside it, the paragraph starts below it, after its text distance below and its own space before. Otherwise the paragraph starts at the top of the page and wraps beside the last part. An earlier floating table that shares that paragraph stays where the body reached the breaking table. If a table fits a page, it stays whole when it has a text distance above it or a negative offset, when the section has more than one column, or when the document enables doNotBreakWrappedTables. A table whose rows fit stays whole, even when its text distance below does not fit. Simple terminal empty anchors retain their shared-page layout. In a header or footer, a top-level floating table sits at its anchor position outside the story flow. In documents that use Word 2013 or later layout, the blocks after it wrap beside it or move below it, and the header or footer grows with them. Body text on every page that shows that header or footer wraps around the table in every layout mode. A page- or margin-anchored header or footer table keeps its page position, and it moves up onto the page when it would pass the bottom edge of the page. Footer text moves below such a table when the table ends above the bottom edge of the footer, and above the table when it reaches past that edge or when the text below it would pass the bottom edge of the page. Text that the table pushes down can extend past the bottom edge of the footer, but never past the bottom edge of the page. Footer text that wraps beside a narrow table grows the footer upward when it would pass the bottom edge of the page. Floating-table positioning has no editing UI.',
  },
  {
    id: 'tables.text-direction',
    name: 'Vertical cell text (textDirection)',
    category: 'tables',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'tbRl and btLr cell text renders through writing-mode and round-trips. btLr text wraps at the row height, does not make the row taller, and is clipped at the cell width. You cannot set it from the UI.',
  },

  // --- Images & drawings ---------------------------------------------------
  {
    id: 'images.inline',
    name: 'Inline images (paste, drag-drop, resize)',
    category: 'images',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    docsLink: '/docs/2.x/guides/images',
    notes:
      'The engine lays out and paints embedded PNG, JPEG, and GIF at the authored size. An inline picture in the main document text, a header, or a footer that is wider than the text area extends into the left and right page margins, and the paper edge crops it. In a multi-column section, a picture extends only to the middle of the gap to a neighboring column. A picture in a table cell extends over the left and right cell margins, and the cell edge crops it. This also applies to a nested table cell. Pictures in framed paragraphs, footnotes, endnotes, and text boxes stay cropped to their text area. In compatibility mode 15 and later, leading paragraph-relative pictures with nonnegative offsets keep text clear after page moves and account for applied paragraph spacing. Embedded PNG, JPEG, GIF, BMP, and WebP images use their detected format. This also applies when the file declares another format from that group. Mismatches involving SVG, TIFF, WMF, or EMF remain refused. The original bytes and package declarations survive save. JPEG validation accepts large metadata segments and accounts for EXIF-oriented intrinsic dimensions without rewriting the photo. The editor refuses picture insertion while another picture is selected. Place the caret in text before inserting another picture. Both adapters ship insert and overlay authoring: the Insert menu, toolbar, properties dialog, and keyboard resize through the shared engine commands. React and Vue hosts can supply a custom image decoder through the imageDecodePort option. An inserted image keeps its natural size when it fits and scales down proportionally to its cell, column, or page content box when it does not. Inline pictures rotated by 90 or 270 degrees reserve their rotated dimensions for text flow and caret positions. Text after an inline image starts at its edge, and a click past the image places the caret after it. An image that does not fit before a floating object continues past it on the same line, like a word. With formatting marks shown, the paragraph mark sits on the text baseline after a trailing image, at the size of the paragraph mark.',
  },
  {
    id: 'images.anchored',
    name: 'Floating images & wrap modes (square, topAndBottom...)',
    category: 'images',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    docsLink: '/docs/2.x/guides/images',
    notes:
      'Nine wrap modes, exclusion reflow, z-order, and drag and resize in both adapters. A floating wrap mode on an inline picture keeps the picture in place on the page. Centered, right-aligned, and justified text beside a floating picture aligns separately in each passage on either side of the picture. A right-to-left line fills the passage to the right of the picture first, and text with both directions orders inside each passage. Square wrapping on the largest side keeps text on the wider side only. When both sides are equal, the text keeps the left side in compatibility mode 15 and later, and the right side in earlier modes or when the document declares no mode. In-front and behind-text overlays are not cropped by their anchor cell. The wrap mode controls text flow and behind-text controls only paint order, so a behind-text object with square, tight, through, or top-and-bottom wrap still moves text. A top-and-bottom object that crosses the first line of a paragraph or its space before moves that line below the object, and the line keeps its space before. A top-and-bottom object positioned against the page or a margin keeps that position wherever its anchor paragraph is, and moves only the lines it crosses, before or after its anchor. A top-and-bottom object positioned at or below the top of its paragraph also moves the lines of that paragraph before its anchor that it crosses. Authored anchor text distances are preserved. Text clears rectangular gaps narrower than the next glyph. A line break with w:clear restarts the following text below the floating objects on one side: left clears objects that block the start of the line, right clears objects past the break, and all clears every wrapping object. In a table cell, an object with layoutInCell off is placed against the page in compatibility mode 14 or earlier, or when the document declares no mode, and the table rows it touches move below it. In Word 2013 mode and later it stays in the cell, as in Word. A floating object above a table cell paragraph, or beside the lines it holds, does not change how that paragraph breaks or where its lines start. Objects that must not overlap move beside each other before they move down. Before Word 2013 mode, header and footer text outside tables does not wrap around the objects in that header or footer. Header drawings positioned relative to the top margin use the physical sheet top as their origin. Outside table cells, top-and-bottom wrapping clears header text from the same origin. Header and footer objects paint under the body text and body objects, in the editor and in PDF export. In-front and behind-text order them only against the header or footer text. Both share setImageWrapType and toolbarCommandState.',
  },
  {
    id: 'images.bmp-webp',
    name: 'BMP and WebP images',
    category: 'images',
    editing: 'none',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    docsLink: '/docs/2.x/guides/images',
    notes:
      'The browser decodes these and the editor paints them at the authored size, like PNG or JPEG. BMP covers what older documents carry, including top-down bitmaps and the 12-byte BITMAPCOREHEADER. WebP covers the lossy, lossless, and extended containers. Inserting a new one is not supported yet.',
  },
  {
    id: 'images.svg',
    name: 'SVG images',
    category: 'images',
    editing: 'none',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    docsLink: '/docs/2.x/guides/images',
    notes:
      'Embedded SVG paints at the authored size. The browser renders it in secure static mode, so scripts and external references inside the file stay inert. Inserting a new SVG is not supported yet.',
  },
  {
    id: 'images.wmf',
    name: 'WMF / EMF legacy vector images',
    category: 'images',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    docsLink: '/docs/2.x/guides/images',
    notes:
      'The browser rasterizes the metafile and the editor paints it at the authored extent. The drawingModule from @docx-editor.dev/pro/drawing, under the EigenPal Pro License, places metafiles that set their own drawing origin correctly. PDF export includes the module. PDF export draws the metafile as vector paths, text, and embedded bitmaps in the picture frame, with its crop and clip. Metafile text uses the named font when the document uses it, and the default font otherwise. In the editor, a metafile that will not convert keeps its extent and shows a labeled placeholder; PDF export leaves it out and reports a diagnostic. The original bytes round-trip untouched.',
  },
  {
    id: 'images.tiff',
    name: 'TIFF images',
    category: 'images',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    docsLink: '/docs/2.x/guides/images',
    notes:
      'The browser decodes baseline TIFF and the editor paints it at the authored extent. PDF export decodes the same TIFF flavors, including CCITT Group 4 black and white scans, and embeds the picture. A multi-page file shows its first page. A flavour that will not decode keeps its extent and shows a labeled placeholder. Inserting a new TIFF is not supported yet.',
  },
  {
    id: 'images.tracked',
    name: 'Tracked image changes',
    category: 'images',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'premium',
    notes:
      'Suggesting mode and review actions require the EigenPal Pro License. Opening and saving existing image revisions require no review module. Suggesting mode records image insertion and deletion. Review actions can accept or reject both changes. Image property edits are unavailable in suggesting mode.',
  },
  {
    id: 'images.textboxes',
    name: 'Text boxes',
    category: 'images',
    editing: 'partial',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'community',
    docsLink: '/docs/2.x/guides/images',
    notes:
      'Anchored text boxes render their content clipped inside the authored extent. Empty anchor paragraphs flow around preceding floating objects. An empty paragraph keeps its place beside a floating object that leaves a passage, and moves below one that covers the whole column. This works in the body, in headers, and in footers, including page-relative anchors. PAGE, NUMPAGES, and SECTIONPAGES fields inside a header or footer text box are evaluated per page. Insert → Text Box creates an editable rectangular box from a body paragraph. Unrotated body text boxes support typing, paragraph editing, text formatting, plain-text paste, undo, deletion, dragging, and resizing. These edits synchronize during collaboration, with remote cursors and text selections. Clicking text shows the caret and frame handles. Text boxes in headers and footers support the same text editing. Double-clicking one opens its header or footer and enters the box, and a single click enters it while that header or footer is open. Leaving the box returns to that header or footer. A frame outlines the box being edited, and a header or footer box drags, resizes, and deletes from that frame. Escape leaves a box with the box selected, and Enter on a selected box goes back into its text. Text boxes with tables remain read-only. The automation API reads, searches, and edits floating and inline text box stories in the body, headers, and footers through Shape.body. Saving writes edited text box text into the legacy VML copy too. Inline text boxes take their extent on the line, stand on the baseline, and render their content clipped inside the extent, in the body, in table cells, and in headers and footers. Inline text boxes in the body, headers, and footers support the same text editing as anchored ones, and these edits synchronize during collaboration. Inline text boxes move with their line: they resize from their frame but cannot be dragged. Half of a text box outline width also insets its content. Legacy VML text boxes on rectangles, rounded rectangles, ovals, text box shapes, and straight-sided preset shapes such as arrows and diamonds render the same way, floating or inline, with their inset margins, solid fill, and outline. Their text stays inside the text area of a rounded rectangle, an oval, or a preset. VML outlines are centered on the shape edge, or lie inside it with an inset pen, and support dash patterns, round or square dash ends, and solid shadows that paint outside the shape. A turned VML text box keeps its text upright unless the text turns with the shape, and wrapped text keeps off both the box and its turned outline. Vertical VML text runs top to bottom or bottom to top, and a VML text box that fits its text takes the text height. Find reaches them, and boxes with upright text in the body, headers, and footers take the same text editing, and an upright VML text box moves, resizes, and deletes like a modern one, writing its VML position and size. Vertical text and text that turns with its shape stay read-only, and vertical text that keeps East Asian characters upright stays opaque. Perspective shadows do not paint, and VML text boxes with curved custom outlines stay opaque. DrawingML text boxes in any preset or custom shape paint that outline, including parts outside the box such as the tail of a callout, and lay their text out in the text area the shape names. DrawingML text boxes also paint gradient and pattern fills, outer shadows, and compound outlines, and glows with the drawingModule. A turned DrawingML text box turns its outline and text, or keeps its text upright when the box asks for it, and vertical text runs top to bottom or bottom to top. A text box inside another text box, linked chains, and DrawingML autofit render as a placeholder or clip.',
  },
  {
    id: 'images.shapes',
    name: 'Drawing shapes & geometry',
    category: 'images',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'community',
    docsLink: '/docs/2.x/guides/images',
    notes:
      'All preset shapes and bounded custom geometry, including arcs and curves, render with solid, gradient, or preset pattern fills in sRGB or theme colors. Faces of shaded presets, such as cubes and cans, render lighter or darker. Outer shadows render with their offset, blur, and color. Glow, inner shadow, reflection, soft edge, and the rim of a dark-edged bevel require the drawingModule from @docx-editor.dev/pro/drawing. Grouped shapes can turn and flip; a turned shape outside a group follows the rule for unsupported payloads. Drawing canvases render their background, outline, shapes, connectors, nested groups, and text box text, read-only. A canvas that holds a picture or ink keeps its placeholder. An outline keeps its full width past the edge of the drawing. An inset outline (algn=in) draws inside its geometry. Outlines keep authored flat, round, and square line ends and round and bevel joins, in the editor and in PDF export. Outlines render preset and custom dash patterns, and double, thick-thin, thin-thick, and triple compound lines. Lines render triangle, stealth, diamond, oval, and open arrow ends at their authored sizes, and the line stops short under the end. Vertical and horizontal lines render, standalone or inside a group. A shape filled with a picture paints it stretched over the shape and clipped to its outline, with an optional crop. A shape group can also hold embedded pictures below its shapes. The pictures render in document order, each in its own frame with its own crop, in the editor and in PDF export. A picture after a shape that paints follows the rule for unsupported groups. Each picture must be visible, unrotated, unflipped, and rectangular. It must have no fill rectangle offsets, image effects, shape effects, or 3D properties. Solid picture outlines render. Groups and their members must have supported visibility, effects, and 3D settings. A group renders completely or not at all: when any member cannot render, it follows the rule for unsupported groups. Other payloads reserve their extent with a placeholder. In mc:AlternateContent, branch selection prefers supported modern markup, then supported legacy fallback markup. Unsupported visible drawings keep one labeled placeholder. A later picture decoding failure also shows a placeholder without another branch selection. React and Vue DocxEditor.UnsupportedElement declarations can replace that placeholder. Its source includes the choice and fallback branches; hidden drawings and nonvisual metadata do not produce extra placeholders. If it floats with square, tight, through, or top-and-bottom wrapping, text still flows around its wrap area. A full-height header or footer placeholder yields its wrap area only when body layout otherwise fails. The placeholder stays visible; smaller placeholders and supported drawings keep wrapping. Text box members of a group render their text in the editor and in PDF export, in the scaled member box with their own insets, vertical anchor, and wrapping. Find reaches that text and selects the group. The text is read-only. A rotated member turns its text with it, a vertical flip turns the text upside down, and a horizontal flip does not mirror it. A rotated or flipped group still follows the rule for unsupported groups.',
  },
  {
    id: 'images.legacy-vml',
    name: 'Legacy VML pictures & annotation groups',
    category: 'images',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'community',
    docsLink: '/docs/2.x/guides/images',
    notes:
      'Standalone w:pict supports bounded unrotated photos and groups of photos, inline photos with one uniform single-line border on all four sides, simple solid geometry including rounded rectangles and arrowed lines. Floating lines drawn between from and to points render in the editor and in PDF export. Floating shape paths with two explicit points and one zero extent also render as native lines. Invalid zero coordinate axes remain opaque. Aligned positions (left, center, right, top, bottom, inside, outside) are supported. A shape without absolute positioning is inline. Previews do not replace canonical VML or add media parts. Unknown templates, unsupported members, rotation, and clipped groups remain opaque as a whole. VML-only MC fallbacks are unchanged.',
  },
  {
    id: 'images.crop',
    name: 'Picture cropping (srcRect)',
    category: 'images',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    docsLink: '/docs/2.x/guides/images',
    notes:
      'Crop renders and round-trips. The properties dialog edits the crop in percent in both adapters.',
  },
  {
    id: 'images.adjustments',
    name: 'Picture adjustments (brightness, contrast, recolor)',
    category: 'images',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Brightness, contrast, grayscale, and bilevel black-and-white adjustments render in the editor. Image alpha and authored adjustment markup are preserved. Source inspection reports explicit drawing limitations. Custom previews can replace eligible partially rendered drawings with includePartial. Previews do not change the saved drawing or PDF export. The PDF exporter applies fixed image opacity but reports unsupported color adjustments.',
  },
  {
    id: 'images.effects',
    name: 'Picture frames and outer shadows',
    category: 'images',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'community',
    notes:
      'Pictures render their outer shadow under the picture, and their outline, dash pattern, and single or compound line outside the picture, in the editor and in PDF export. A picture takes the shape of any preset geometry with its adjust values. Above an inline picture, its outline and shadow stop at the top of the picture. A rotated picture keeps its shape but paints no outline or shadow. Glow, soft edges, reflections, and the rim of a dark-edged bevel require the drawingModule from @docx-editor.dev/pro/drawing. Lit bevel faces and other 3-D materials are not painted. Effects are not editable. Authored effect markup and effectExtent spacing are preserved.',
  },
  {
    id: 'images.drawing-effects',
    name: 'Shape and picture effects (glow, inner shadow, reflection, soft edge, bevel rim)',
    category: 'images',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'premium',
    notes:
      'These effects require the drawingModule from @docx-editor.dev/pro/drawing and the EigenPal Pro License. PDF export includes it. Without the module, shapes and pictures paint without these effects. Glows render as a soft halo of their color and radius, under shapes, lines, and pictures. Inner shadows render inside the shape. An upright picture fades out at soft edges and paints a reflection below itself. A dark-edged bevel paints a dark rim inside the shape. Skewed or sideways reflections, lit bevel faces, and other 3-D materials are not painted. Effects are not editable. Authored effect markup is preserved.',
  },
  {
    id: 'images.wordart',
    name: 'WordArt (VML text paths)',
    category: 'images',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'premium',
    docsLink: '/docs/2.x/pro/drawing',
    notes:
      'WordArt requires the drawingModule from @docx-editor.dev/pro/drawing and the EigenPal Pro License. PDF export includes it. Without the module, inline WordArt keeps its extent with a placeholder, and floating WordArt does not render. WordArt renders its text as glyph outlines fitted to the shape: straight, between the two guides of a shape such as a triangle, or along an arch. It paints its fill (solid or vertical gradient), outline, shown shadow, rotation, and a parallel 3-D extrusion with lit sides. Gradients at other angles, perspective extrusion, and shape types whose drawing does not include their definition (other than plain text, triangle, and arch) do not render. Text watermarks render without the module.',
  },
  {
    id: 'images.charts',
    name: 'Charts (DrawingML)',
    category: 'images',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'premium',
    docsLink: '/docs/2.x/pro/drawing',
    notes:
      'Charts require the drawingModule from @docx-editor.dev/pro/drawing and the EigenPal Pro License. PDF export includes it. A chart that does not render shows its saved fallback picture or drawing when it has one and it renders; otherwise the editor shows a labeled placeholder at the same size, and PDF export leaves the chart out with a drawing diagnostic. A visible drawing in a skipped mc:Choice retains a placeholder when its bounds are usable. Charts render read-only from the values cached in the chart part, in the editor and in PDF export: column and bar charts (clustered, stacked, and percent stacked), line, area, scatter, bubble, radar, stock, pie, doughnut, pie-of-pie, bar-of-pie, surface, and contour charts. 3-D column, bar, line, area, pie, and surface charts render in 3-D with shaded faces, walls, gridlines, and axis labels, with right-angle axes or in perspective. A chart with a series axis places each series in its own row. Axes, including logarithmic value axes, tick label number and date formats, gridlines, chart and axis titles, legends, data labels (with best-fit pie labels that move outside crowded slices and spread around the pie on bent leader lines; a label saved with its own text shows that text, with value, category, series, percentage, and cell range fields filled from the chart; labels wrap at a fifth of the chart width and keep positions moved by hand), trendlines with their equations, error bars, series colors, markers, smoothed lines, exploded slices, and manual plot layouts render. Surface and contour charts fill their value bands, and wireframe surfaces draw the band edges. The embedded workbook is never read, and external data is never loaded. Charts that combine a pie or radar plot with other plot types, and surfaces of more than 20,000 points, do not render. Without a fallback picture or drawing they keep a labeled placeholder that React and Vue DocxEditor.UnsupportedElement declarations can replace. A chart is never edited as a picture: in every state, a click selects the chart as an object without resize, move, or crop handles, picture commands are refused, and Delete removes the chart and its fallback together. With change tracking on, the delete is one tracked deletion of the whole chart, which stays dimmed with a change bar in All Markup until it is accepted or rejected. Copy and cut of a selection that includes a chart, and rich paste of content that holds a chart, are refused. The chart record says how the page shows it (shownAs: chart, fallback, or placeholder). Charts with invalid caches, exceeded cache limits, or numeric overflow also use a saved fallback or labeled placeholder. The chart parts are preserved on save.',
  },
  {
    id: 'images.newer-charts',
    name: 'Waterfall, funnel, histogram, Pareto, and box and whisker charts',
    category: 'images',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'premium',
    docsLink: '/docs/2.x/pro/drawing',
    notes:
      'Waterfall, funnel, histogram, Pareto, and box and whisker charts require the drawingModule from @docx-editor.dev/pro/drawing and the EigenPal Pro License. PDF export includes it. They render read-only from the values cached in the chart part, in the editor and in PDF export. Waterfall charts draw running totals as floating columns, subtotal columns, increase, decrease, and total colors, and connector lines. Funnel charts draw centered bars per category. Histograms bin the cached values with automatic width, a fixed bin size or count, either closed side, and underflow and overflow bins; Pareto charts add a cumulative percentage line. Box and whisker charts compute exclusive or inclusive quartiles and draw whiskers, outliers, inner points, the mean marker, and the mean line, with value labels at the right of their marks. Value axes leave out their labels when they would sit closer than about one line. Box and whisker labels at other positions, or that name the series or category, are not drawn, charts with several categories can show inner point labels that the reference leaves out, a funnel whose skipped category labels no longer fit once the plot is shorter can differ in plot height, narrow charts and value axis text under 8 points can pick the other scale near the spacing thresholds, and after long category labels fail to fit in two rows the plot can be up to 2 points narrower. Data labels with their number formats, category and value axes, gridlines, the title, and the legend render, with text, lines, and colors from the chart style and color parts. Treemap, sunburst, and map charts, and any of these charts without the module, show the fallback picture or drawing saved for older applications when there is one. In every state, a click selects the chart as an object without handles, picture commands on it are refused, and Delete removes the chart and its fallback together, as one tracked deletion when change tracking is on. Copy and cut of a selection that includes one of these charts are refused. Without a fallback picture or drawing they keep a labeled chart placeholder that React and Vue DocxEditor.UnsupportedElement declarations can replace, and PDF export leaves them out with a drawing diagnostic. The chart, style, and color parts and the fallback are preserved on save.',
  },
  {
    id: 'images.smartart',
    name: 'SmartArt & diagrams',
    category: 'images',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'community',
    docsLink: '/docs/2.x/pro/drawing',
    notes:
      'SmartArt diagrams render read-only from the drawing saved with the document, in the editor, in headers and footers, and in PDF export. Shapes, solid and gradient fills, outlines, the diagram background, text, bullets, and quarter-turned vertical text render. The diagram data, layout, colors, styles, and drawing parts are preserved on save. A diagram saved without its drawing is laid out from its data, layout, style, and color parts by the drawingModule from @docx-editor.dev/pro/drawing, which requires the EigenPal Pro License. PDF export includes it. Without the module, such a diagram keeps its labeled placeholder. A diagram with picture fills, or with a text mode that cannot render, keeps its labeled placeholder, and application components can replace that fallback as for charts. Outer shadows render. With the drawingModule, glow, inner shadow, reflection, and soft edge render too; lit bevel faces and other 3-D materials do not. A changed diagram layout is not recalculated: the saved drawing is shown as stored.',
  },
  {
    id: 'images.ink',
    name: 'Ink annotations (w:ink)',
    category: 'images',
    editing: 'none',
    rendering: 'none',
    roundTrip: 'preserved',
    tier: 'community',
    notes: 'Not rendered and not editable. Ink markup is preserved generically on save.',
  },

  // --- Page layout, headers & footers --------------------------------------
  {
    id: 'layout.pagination',
    name: 'True pagination (Word-metric pages)',
    category: 'layout',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'The layout engine uses page breaks, paragraph keep rules, and section settings to calculate pages. You can insert a hard page break, which writes `w:br w:type="page"`. With paragraph marks shown, a page break or column break in body text shows a labeled dotted line from the end of the text to the edge of the column. Manual page breaks inside table cells retain their document offsets but do not add lines, line height, or pages. Line wrapping, tab alignment, bidirectional text order, and text wrap around floating pictures ignore them. If the font of the run has Arabic glyphs, layout measures Arabic letters on the two sides of a break as one joined word. If the font has no Arabic glyphs, the browser fallback measures each side separately, so the width can differ from the same text without the break. Manual line breaks still start a new line. When a paragraph starts with a manual page break and has text after the break, the text starts on the next page, even when the current page has no room for another line. A list number or bullet goes to the next page with the text. The top border of the paragraph also goes to the text on the next page, and lines that hold only page breaks draw no border. The space before of the paragraph goes there too, reduced by the space after of the paragraph above. Shading fills each break line where it sits. A break that the current view hides does not count. Paragraphs with only one page break, or with anchored floating tables, text frames, or drawings, keep the ordinary rule, so after a full page their text starts one page later. A paragraph that opens with a page break followed by another page or column break keeps its first break on the current page.',
  },
  {
    id: 'layout.sections',
    name: 'Sections (margins, size, orientation, per-section headers)',
    category: 'layout',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Page size, orientation, and margins are editable per section or for the whole document, from the Page Setup dialog or a ruler drag. Each section uses its own page dimensions and margins for pagination. A negative top or bottom margin sets the exact distance from the page edge to the text. A taller header or footer then overlaps the text and does not move it. In that overlap, text, links, note references, pictures, and form fields take the pointer, and a closed header or footer highlights only its part in the page margin. To edit the header or footer, double-click it in the page margin, or on its content where no text is under the pointer. With paragraph marks shown, a section break shows a labeled dotted line in place of its paragraph mark, named by how the next section starts. You can insert a next-page or a continuous section break; a continuous one keeps the new section on the sheet the previous section ended. This also applies when the new section has a taller header or footer, or a different first page. That sheet keeps its header, footer, and text area, and the header and footer of the new section start on the next sheet. A different page size or orientation starts a new sheet. When a section has other content, the empty paragraph that ends it before a continuous section takes no vertical space. A manual page break followed by an empty section-break paragraph advances one page when the next section starts on a new page, so no blank page appears between them. An empty section-break paragraph after other content in its section ignores its own page break before, so it does not add a blank page. An empty section-break paragraph whose line misses the page bottom stays on the page and takes no room from the footnote area. When the next section starts on a new page, it also draws neither its borders nor its shading and never starts a page of its own. An odd-page or even-page section starts on a page whose number has that parity. With different odd and even pages turned on, a numbering restart compares its parity with the continued page number. A restart on a shared continuous page does not reset the sheet sequence used for this comparison. An explicit odd-page or even-page break with a restart selects physical page parity before applying the displayed number. When the next sheet has the wrong parity, layout inserts one empty sheet with no header, footer, or content. `NUMPAGES` counts that sheet, and `SECTIONPAGES` does not. You cannot insert odd-page or even-page section breaks. Per-section columns render from w:cols, but column editing controls are unavailable. A continuous section starts below the lowest in-flow content across all columns on the preceding section’s final page. In compatibility mode 14 and earlier, sections with w:noColumnBalance keep their natural column distribution. Columns that continue below earlier content retain authored paragraph space before, including later columns. Fresh-page starts retain their existing spacing rules.',
  },
  {
    id: 'layout.headers-footers',
    name: 'Headers and footers (edit in place)',
    category: 'layout',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Both adapters have scoped header and footer editing: enter and exit the story, create and remove it, link and unlink to the previous section, and set the title-page and even/odd options. They also insert PAGE, NUMPAGES, and SECTIONPAGES. `editHeaderFooter` takes `variant`, `evenPage`, and `firstPage` on the shared Editor contract. Per-section first, even, and default variants paint like Word. Editing inside a header or footer matches the body: lists, tables, content controls, pictures, fonts, comments, bookmarks, and page setup all act on the story you are in. Tracked changes work in a header or footer: you can suggest an edit there, and the review list shows it with the accept and reject verbs. Selection and comment highlight bands paint in the body only. Watermarks have their own dialog and command.',
    docsLink: '/docs/2.x/guides/headers-footers',
  },
  {
    id: 'layout.watermarks',
    name: 'Watermarks (text & image)',
    category: 'layout',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Text watermarks paint as glyph outlines fitted to their shape, diagonal or horizontal, with their color and transparency, in the editor and in PDF export. Picture watermarks paint behind the text with washout. The Insert menu opens a Watermark dialog, and `setWatermark` writes the same watermark into every header the document shows, creating a header where a section has none. One watermark applies to the whole document; a different watermark per section is not available. Curved or styled text art other than plain text stays opaque.',
    docsLink: '/docs/2.x/guides/headers-footers',
  },
  {
    id: 'layout.footnotes',
    name: 'Footnotes and endnotes',
    category: 'layout',
    editing: 'partial',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Lines before a held reference can return when widow and orphan rules allow. Final body lines reserve paragraph spacing above notes. The document API exposes Body.footnotes and Body.endnotes in reference order, including scoped table-cell reads. Existing note bodies support edits; API note creation remains unsupported. Both adapters have a typed note model, note layout (pageBottom, beneathText, sectEnd, docEnd), scoped note editing, insert, delete, convert, and chrome slots. Each section numbers its notes from its own note properties: number format, start value, restart rule, and footnote position. A value the section leaves unset takes the default: decimal footnotes and lowercase Roman endnotes, starting at 1, numbered continuously, with footnotes at the page bottom. The document-wide note properties in settings.xml do not change numbering or the footnote position. The endnote position is document-wide: it comes from settings.xml, and a section endnote position has no effect. A note number is the start value of its section plus the index of the note in its numbering domain: the whole document for continuous numbering, the section or the page for numbering that restarts there. Applying note properties to the whole document writes every section and settings.xml, and an endnote position change always writes settings.xml. Values you leave out keep their current values, and applying unchanged values leaves the document as it was. A paragraph reference stays when a legal note opening fits below it, even if the whole note fits a fresh page. Note paragraphs respect w:keepLines and w:widowControl; without widow control, one note line can start there. This admission applies to full-width, single-column body paragraphs in every compatibility mode. Note keep-with-next groups and notes containing tables retain whole-note admission. A splittable continuation returns when its required body opening and complete attached notes fit; later references outside that opening add no demand. A reference in a table row keeps its note with that row. The row moves with the note only when the note can place fewer than two lines below the row; otherwise the note continues on the next page. A row that every cell lets split below the reference line continues on the next page below that split; w:cantSplit and exact-height rows do not split there, nor do w:keepLines or widow-controlled cell paragraphs in Word 2013 layout, unless the row is too tall to stay whole. A returning paragraph continuation includes its earlier fragment when checking note space. If the returning reference leaves no note space, the previous split decision stays in place. A reference paragraph that keeps with its successor includes the notes in that successor’s required opening. A successor opening without a reference adds no footnote reserve. Paragraphs ahead of a moved reference return to the earlier page when they fit, unless they keep with the reference paragraph; multi-column sections keep that room, and so does a reference on the second line of a widow-controlled paragraph whose note could not start on the earlier page. A reference on the second line of a widow-controlled paragraph can keep the first two lines on the page while its whole note starts on the next page. The note area can use the space below the text of the last body line with single or multiple line spacing, while a line whose note starts on the same page keeps its full height above the notes in every column. A note taller than the page note column continues across pages. Page-bottom and beneath-text footnotes reserve authored continuation notices, including empty paragraphs, below notes that continue. Notices remain noneditable furniture. Live header changes that resize the body area also update footnote pagination. Oversized notices report note-continuation-notice-height-cap without stopping note text. Section-end and document-end notices remain unsupported. The w:separator rule takes its thickness and its offset above the baseline from the strikeout metrics of the run font. Overflow sheets retain separate page rectangles for painting and hit testing. Editing inside a note matches the body: lists, tables, content controls, pictures, fonts, comments, bookmarks, and page setup. Suggesting mode tracks an inserted reference and requires reference deletion to propose note removal. Notes in headers and footers are out of scope.',
    docsLink: '/docs/2.x/guides/footnotes-and-endnotes',
  },
  {
    id: 'layout.columns',
    name: 'Multi-column layout',
    category: 'layout',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    notes:
      "Section w:cols count, gap, separator, and equal or unequal widths paginate into columns. Decimal and unit-suffixed widths and gaps truncate to whole twips. A w:col without a gap has no gap, and one without a width spans the text area. Widths and gaps that do not fit the page are kept, so later columns can extend past the page edge. Equal columns narrow to a minimum of 0.01 inch and keep their gaps. If a w:col width or gap cannot be used, or there are fewer w:col elements than columns, the section uses equal columns. An explicit column break leaves the break paragraph's empty remainder at the top of the next column. Continuous multi-column sections balance their final page, including sections that span several pages. Earlier pages retain their column distribution. In compatibility mode 14 and earlier, w:noColumnBalance in settings makes columns fill in order without balancing; later modes ignore it. A missing flag or an explicit off value retains balancing. The next continuous section starts below the tallest column, also when balancing is disabled. Whole-paragraph moves into later columns preserve the continued section’s vertical origin. If no remaining column fits the first line, the section moves to a fresh page. Column editing chrome is not exposed.",
  },
  {
    id: 'layout.page-borders',
    name: 'Page borders',
    category: 'layout',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Page borders draw a frame on every sheet of their section. Offset modes, z-order, and the first-page filter apply. Art borders do not draw. You cannot edit page borders from the UI.',
  },
  {
    id: 'layout.line-numbers',
    name: 'Line numbers (lnNumType)',
    category: 'layout',
    editing: 'none',
    rendering: 'none',
    roundTrip: 'full',
    tier: 'community',
    notes: 'Parsed and round-tripped; not drawn in the margin.',
  },
  {
    id: 'layout.even-odd-headers',
    name: 'Different even & odd headers',
    category: 'layout',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      "The first page of a section can use its first variant. Displayed page numbering selects even or default variants, including section numbering restarts. You can edit each variant in an open furniture scope. `editHeaderFooter({ variant: 'even' })` creates or opens the even story and enables `w:evenAndOddHeaders` in one undo unit. Header and footer chrome in both adapters can toggle different even and odd pages.",
  },
  {
    id: 'layout.vertical-align',
    name: 'Section vertical alignment (vAlign)',
    category: 'layout',
    editing: 'none',
    rendering: 'none',
    roundTrip: 'full',
    tier: 'community',
    notes: 'Round-trips; page content stays top-aligned.',
  },
  {
    id: 'layout.background',
    name: 'Page background color/image (w:background)',
    category: 'layout',
    editing: 'none',
    rendering: 'none',
    roundTrip: 'preserved',
    tier: 'community',
    notes:
      'Not rendered and not editable. Authored background markup and relationships are preserved.',
  },
  {
    id: 'layout.page-num-format',
    name: 'Page number format (pgNumType)',
    category: 'layout',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Section numbering start, format, chapter style, and chapter separator parse and serialize. PAGE fields in headers and footers honor the authored start and format, for example lowerRoman. A numeric picture switch or a number-format switch on the field outranks the section format. In PAGE fields, roman page numbers repeat M for each thousand, alphabetic page numbers past 26 repeat one letter (27 is AA, 28 is BB), and page 0 shows a space in both. NUMPAGES and SECTIONPAGES are decimal unless the field states a switch. There is no authoring UI for pgNumType yet.',
  },

  // --- Review ---------------------------------------------------------------
  {
    id: 'review.tracked-changes',
    name: 'Tracked changes (insert, delete, format)',
    category: 'review',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'premium',
    notes:
      'Suggesting mode, review markup, and review actions require the EigenPal Pro License. Opening and saving existing revisions require no review module. The document API tracks text, fonts, paragraph formatting, list membership, and paragraph insertion. Table suggestions support complete insertion, value replacement, row additions, and partial row deletions. Eligible nonempty text can become a proposed text or date control outside collaboration. The document API records a paragraph deletion as deleted text and a deleted paragraph mark, also in collaboration. Tracked replacements across paragraphs and table or cell value replacement refuse in collaboration. Row deletion suggestions must leave a row without a pending deletion. Existing table properties and columns require permanent edits; eligible complete proposed tables support configuration. The editor offers Simple Markup, All Markup, No Markup, Original, author filters, and filtered bulk decisions. Hidden authors and unsupported changes remain pending during filtered bulk decisions. The editor and the document API can change the author, and optionally the date, of pending changes without accepting or rejecting them. Original restores prior run and paragraph formatting; prior table, row, cell, and section formatting remains unsupported. Author filters change the display without changing saved revisions. The Track changes options dialog and viewer markup preferences configure revision marks, named colors, optional text backgrounds, change bars, and cell shading through the API and review dialog. Text backgrounds default to none and remain local viewer preferences. Cell shading supports named colors and revision author colors. The dialog adapts to narrow screens. React and Vue support popup replacement, named dialog parts, and custom draft controls. Track formatting can leave future formatting edits untracked while text edits remain tracked. Suggesting mode requires an author. Deleting a field in suggesting mode proposes the whole field for deletion, including a w:fldSimple field with no saved result. Its review item shows the field result, or the field name, such as {PAGE}, when the field holds no result. Editor list, indent-level, tab-stop, and table-property changes remain untracked. Malformed revision wrappers refuse resolution and preserve their content. With `pairReplacements`, the review queue lists a deletion and the insertion that directly follows it from the same author as one replacement item. The review queue lists one item for an addition or deletion that continues across a tracked paragraph mark, and one item for the same paragraph formatting change on consecutive paragraphs by one author. The same formatting change by one author on text and on the paragraph mark it reaches is one item, also into the next paragraph and across the cells of one table row. Revision collections list tracked cells, cell merges, and list numbering by type. A formatting change that leaves the resolved formatting unchanged has no review item and no change bar; Accept All and Reject All remove it together with the listed changes, unless a tracked change filter narrows the decision or its author is hidden. `getReviewItemsAt` and `getReviewItemRects` return review items and their bands on painted pages, so a host can draw its own tracked change balloons or margin markers. The review pane settings `opening` and `overflow` keep the pane closed until the host opens it, or shrink a fit-width page so the full card column fits.',
    docsLink: '/docs/2.x/pro/tracked-changes',
  },
  {
    id: 'review.accept-reject',
    name: 'Accept / reject changes (UI + API)',
    category: 'review',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'premium',
    notes:
      'Review actions require the EigenPal Pro License. Accept or reject one change with acceptReviewItem, rejectReviewItem, or the sidebar. The Review menu also resolves changes shown by active filters. Hidden authors and unsupported changes remain pending. The automation API supports individual decisions and strict or partial batches. The browser automation runtime can show a proposed change in the page before the user commits it as one undo step or discards it. Collaboration peers do not receive the proposed change until it is committed. It lists and decides the changes a range overlaps, and getReviewItemRevisions and getReviewItemRange map a review card key to its changes or its range. Deletion and addition revisions keep independent accept and reject decisions, even when their author, ID, and editing time match. Source revision dates survive save. Opening and saving existing revisions require no review module. The revisionsIn review pane setting lists changes in the review pane or opens each change in a tracked change balloon at its text, with replies, a reply field, and accept and reject controls. A tracked change balloon opens on a click in the page, Next Change, or Previous Change, and a caret move alone does not open it. A tracked change balloon that Next Change opens takes the keyboard focus and is announced to screen readers. An adjacent deletion and insertion from one author open as one replacement. A refused accept, reject, or delete shows its cause on the card, such as an external document refresh or a collaboration session that is not ready. One decision resolves both halves of a move or a cell merge, a formatting change inside another change, and the changes inside the content it removes, such as another author insertion in a deleted row. Accept All and Reject All clear table property history beside the listed changes, and the reviewChangesResolved event and the card name the changes that stay pending, such as a row kept for a nested table.',
    docsLink: '/docs/2.x/pro/tracked-changes',
  },
  {
    id: 'review.comments',
    name: 'Comments (threads, replies, resolve)',
    category: 'review',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'premium',
    notes:
      'Comment authoring and review controls require the EigenPal Pro License. Opening and saving existing comments require no review module. The review rail shows threads, replies, and resolution controls. React hosts use `@docx-editor.dev/pro/react`; Vue hosts use `@docx-editor.dev/pro/vue` with the same engine commands. Saving normalizes recognized empty comment parts when no markers or retained relationship dependencies remain. The commentMarkers review pane setting draws collapsed thread markers as comment icons by default, or as author initials badges with a reply count and a resolved check mark. A refused comment, reply, or resolution names its cause on the card or in the reply field. Thread and reply deletion scale their scan budgets with the loaded document. Batch deletion shares marker scans and rebuilds each affected part once. Incomplete deletion scans leave the thread unchanged.',
    docsLink: '/docs/2.x/pro/comments',
  },
  {
    id: 'review.ai-redlining',
    name: 'Programmatic redlining (code-proposed tracked changes)',
    category: 'review',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'premium',
    notes:
      'The automation object model requires the EigenPal Pro License. Manual line breaks use U+000B in text reads and writes, including tracked insertion. Column breaks read as U+000E and refuse text writes. Paragraph separators remain carriage returns. It writes native tracked changes. getTextRanges splits a paragraph or range into word ranges that later edits can target, expandTo joins a run of them, and getReviewedText reads the text as if every pending change were accepted or rejected. It works over DOCX bytes on a server, or over an editor open in a page.',
    docsLink: '/docs/2.x/editor-api',
  },
  {
    id: 'review.moves',
    name: 'Tracked moves (move from/to)',
    category: 'review',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Imported moves survive save and reopen without a review module. Displaying move markup requires the review module and the EigenPal Pro License. Review actions require the module. Viewer preferences configure moved-from and moved-to marks and colors. Track moves off uses insertion and deletion marks without changing move records. Creating move revisions remains unsupported.',
  },

  {
    id: 'review.cell-revisions',
    name: 'Tracked table cell shading',
    category: 'review',
    editing: 'partial',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'premium',
    notes:
      'Viewer preferences set inserted, deleted, merged, and split cell shading. Imported cellIns, cellDel, and cellMerge records supply the shading. Inserted and deleted rows supply shading for cells without an explicit cell revision. None preserves authored shading without a revision fill. Row-level text indicators keep their existing styling; run revision markup still applies inside cells. A cellMerge change from continuation to non-continuation uses split shading. Creating arbitrary cell merge and split revisions remains unsupported.',
    docsLink: '/docs/2.x/pro/review-styling',
  },

  // --- Fields, links & TOC ---------------------------------------------------
  {
    id: 'fields.hyperlinks',
    name: 'Hyperlinks (external)',
    category: 'fields',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Insert, edit, and remove a link with Ctrl+K, Cmd+K, or the toolbar. Targets are allowlisted: http, https, mailto, tel, and ftp. Any other target renders inert and still round-trips. A HYPERLINK field, complex or w:fldSimple, is a live link too: its target passes the same allowlist, and the link panel shows it read-only. Links in footnote and endnote text work the same way. Links in headers, footers, and anchored text boxes resolve through their own part. You can edit or remove header and footer links with Ctrl+K while editing their story. Secondary-story anchors remain inert and do not open. Opening a document never requests a link target, because activation needs an explicit gesture. A field result with no break opportunity, such as a long URL, wraps at the line edge and stays inside its table cell.',
  },
  {
    id: 'fields.bookmarks',
    name: 'Bookmarks & internal links',
    category: 'fields',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    docsLink: '/docs/2.x/guides/bookmarks',
    notes:
      'Internal links jump to their bookmark and move the caret. This includes a target on a page the editor has not painted yet. The Bookmark dialog (Insert menu or Ctrl+Shift+F5) lists bookmarks by name or location, shows hidden bookmarks on request, adds a bookmark at the selection, deletes one, and goes to one. Names compare without case, so adding an existing name moves that bookmark. Show bookmarks paints gray brackets at each bookmark and an I-beam at a point bookmark, in the main text, headers, footers, and notes. Hosts restyle the marks with CSS tokens and data attributes, choose which bookmarks show, and replace or decorate each mark. Typing at a bookmark start extends the bookmark, typing at its end does not, and deleting all of its text removes it. A deletion across paragraphs removes the bookmarks it encloses. Names are unique in the whole document, so adding a name that another story uses moves that bookmark. When collaborators add one name offline, the first is used and the Bookmark dialog offers to remove the copies. The navigation pane has a Bookmarks tab (Ctrl+G, Cmd+Option+G on macOS, or Insert > Go To Bookmark) that filters bookmarks by name, groups them by place, and jumps to one in any story. The document API adds, lists, reads, and deletes bookmarks. Moving or deleting protected markers refuses the whole change. Markers inside data-bound content controls have the same restriction. Direct marker changes remain supported with TrackMineOnly.',
  },
  {
    id: 'fields.page-numbers',
    name: 'PAGE / NUMPAGES / SECTIONPAGES fields',
    category: 'fields',
    editing: 'partial',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'PAGE, NUMPAGES, and SECTIONPAGES project as a complex field or w:fldSimple. They evaluate in headers and footers and in the body flow, body tables included. PAGE respects the section pgNumType start and format. Fields inside an anchored header or footer text box also project, as does a page field nested inside another field — simple or complex, such as STYLEREF — up to four levels deep, evaluated per page. React header and footer chrome can insert them, including Page X of Y. A numeric picture switch, for example PAGE \\# 0#, renders the computed value. Pictures support digit placeholders, a grouping comma, and literal text. The number-format switches Arabic, roman, alphabetic, and ArabicDash also render the computed value. The case of the first letter of roman or alphabetic selects uppercase or lowercase, and the last number-format switch applies. A number-format switch outranks a picture that comes before it. MERGEFORMAT and CHARFORMAT are accepted. Other switches, such as Ordinal or Upper, a picture after a number-format switch, and extra words keep the result saved in the file. In a header or footer the picture always renders the computed value, so a result cached in the file never reaches the page; in the body a non-empty cached result still wins until the field is updated. A body field with no cached result paints a placeholder that document layout substitutes per page. Without a picture or number-format switch, a multi-digit body value keeps the one-digit measured width, so mid-line following text does not reflow; with one, the switch sets that width, and a wider value overflows it the same way.',
  },
  {
    id: 'fields.toc',
    name: 'Table of contents',
    category: 'fields',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'The document API inserts inert TOC fields with supported switches; API entry calculation remains unavailable. Insert a body TOC from the shared Insert menu, then refresh it from document headings or TC entry fields. Unsupported source switches preserve the cached table and refuse refresh. A refresh can update the page numbers only. Tab leaders, section-formatted page numbers, and bookmark links all work. The generated rows are read-only navigation links. Ordinary text outside the field boundaries remains editable, including text in the same paragraph. Formatting a selection that includes generated rows changes only the ordinary text.',
  },
  {
    id: 'fields.cross-references',
    name: 'REF and NOTEREF cross-references',
    category: 'fields',
    editing: 'partial',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'REF resolves bookmark text and numbered paragraph references in the body, footnotes, and endnotes. The editor supports the \\r, \\w, \\n, \\t, \\h, and \\* MERGEFORMAT switches. REF, PAGEREF, and NOTEREF results with \\h navigate to their bookmarks, including cached relative-position results. The \\r switch uses the same full-context number as \\w, and \\t needs a numbering switch. Bookmark text stops at the target paragraph boundary. Line breaks in bookmark text stay line breaks in the result, and save keeps the saved result of such a field. NOTEREF resolves bookmarked note numbers with section formats and eachSect restarts. Unsupported switches, missing targets, bullet targets, eachPage note restarts, and custom note marks keep the saved result. Save refreshes calibrated, writable body and note results as one undo step. Header, footer, and text-box results keep their saved values.',
    docsLink: '/docs/2.x/guides/fields',
  },
  {
    id: 'fields.autonum',
    name: 'AUTONUM field numbers',
    category: 'fields',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'AUTONUM, AUTONUMLGL, and AUTONUMOUT generate separate document-order sequences. They do not restart by heading context. The \\* switch supports Arabic, alphabetic, Roman, ordinal, cardinal text, ordinal text, and hexadecimal formats. The \\e switch removes the trailing period. Unsupported switches produce no generated value. Save does not add result runs.',
    docsLink: '/docs/2.x/guides/fields',
  },
  {
    id: 'fields.styleref',
    name: 'Character-style header references',
    category: 'fields',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'community',
    notes:
      'Header STYLEREF fields resolve directly applied character styles by display name. The default selects the first page occurrence; \\l selects the last. Pages without a match search backward, then forward. Visible revision text supplies results. Header height adjusts per page. Pagination retains each page’s largest admitted live header reserve while painting the current result. Headers from a continued section do not enlarge the shared sheet. Unsupported switches, missing matches, nested result fields, and oversized results keep saved values. Body, footer, paragraph-style, and style-alias references stay cached. Save preserves source fields.',
    docsLink: '/docs/2.x/guides/fields',
  },
  {
    id: 'fields.other-codes',
    name: 'Other field codes (DATE, SEQ, MERGEFIELD...)',
    category: 'fields',
    editing: 'partial',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'community',
    notes:
      "The document API inserts REF, PAGEREF, NOTEREF, SEQ, STYLEREF, DATE, and TIME fields, untracked or as one tracked insertion that Reject removes whole. Their instructions are never evaluated, and fields that fetch, embed, link, run, or prompt refuse. The cached result starts empty; Field.result writes plain result text, inside the author's own pending insertion when tracked, and marks the field w:dirty so an application that evaluates fields recomputes it. The saved result displays for a complex field and for w:fldSimple. Complex fields also display embedded pictures from saved results, including nested complex results, without resolving external image links. Text and pictures retain their saved order and existing model ranges. Mixed results use each authored font slot for measurement and painting. All display slices retain the field's original model unit. Line breaks inside a saved result start another line. Page breaks follow the surrounding story rules; page breaks in table cells do not add pages. By default the field moves as one unit with the caret. Caret positions and selections keep both source boundaries, including field-only paragraphs. Computed caches remain read-only. With the fieldResults editor option set to editable, the saved results of DATE, TIME, CREATEDATE, SAVEDATE, PRINTDATE, MERGEFIELD, HYPERLINK, QUOTE, FILENAME, FILLIN, and SEQ fields accept typing, deletion, selection, composed input, undo, and tracked changes inside the result. Backspace after such a field or Delete before it selects the whole field, and a selection that crosses the field edge grows to cover the field. Computed fields and fields that contain another field in their result stay one unit. Collaboration sessions refuse the option. Leading direction marks remain in results without replacing the first visible result run’s formatting. The saved result of a field nested inside another field’s instruction displays nothing, and Find skips it; the outer field keeps its normal display behavior. Field codes round-trip unchanged. Option+F9 on macOS and Alt+F9 on Windows toggle instruction display without changing the document. Some Mac keyboards require Fn. SYMBOL renders its character with the requested font and size. MACROBUTTON and GOTOBUTTON render display text without running the macro or jump. TITLE, AUTHOR, SUBJECT, KEYWORDS, LASTSAVEDBY, COMMENTS, and matching DOCPROPERTY fields render sanitized document metadata. DATE-valued properties stay inert. DATE, TIME, FILENAME, SEQ, LISTNUM, and EQ do not calculate a new value. The editor never runs macros, DDE instructions, or external include instructions.",
    docsLink: '/docs/2.x/guides/fields',
  },
  {
    id: 'fields.citations',
    name: 'Citations & bibliography',
    category: 'fields',
    editing: 'none',
    rendering: 'none',
    roundTrip: 'preserved',
    tier: 'community',
    notes:
      'CITATION and BIBLIOGRAPHY fields stay inert, and the b:Sources store is preserved. Citation evaluation and editing are not supported.',
  },
  {
    id: 'fields.legacy-forms',
    name: 'Legacy form fields (FORMTEXT, FORMCHECKBOX, FORMDROPDOWN)',
    category: 'fields',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'preserved',
    tier: 'community',
    notes:
      'FORMTEXT supports whole-field selection on click, partial text edits, typing outside the trailing field boundary, whole-field word deletion from field boundaries, select-then-delete at field boundaries and whole-field replacement in unprotected documents, and a shared React/Vue options dialog through double-click or the keyboard-accessible Edit field context action. The dialog supports regular text, number, and date types, maximum length, listed formats, and fill-in enabled. Native selection highlighting and accessible status distinguish a whole field from a caret. In documents protected for forms, plain text results remain fillable and Tab selects the next enabled text field. FORMCHECKBOX renders its checked or default state from w:ffData, and an explicit w:size sets the glyph size. Its line height comes from the run font at that size, not from a fallback font that holds the box glyph. FORMDROPDOWN renders the cached result, or the selected list entry when the file caches none. Field markers, instructions, and w:ffData round-trip, and tracked edits survive. Form-field shading applies unless w:doNotShadeFormData is set. Protected filling enforces maximum length, truncates pasted text to the remaining capacity, and applies supported value formats on exit or save. Save uses the original input locale and rejects invalid pending values without clearing the input. Supported numeric filling and formatted numeric defaults include mixed text, dollar signs, grouping, and accounting parentheses. Unformatted numeric defaults preserve raw text; formatted numeric defaults store their formatted value. The editor locale controls regional Gregorian date input independently of field output formatting, including dotted dates, year-first dates, and locale digits. Locale changes preserve existing dates. Invalid numeric/date fill input opens a shared alert; acknowledgement clears the invalid result with undo support. Full parity across Word locales and input grammars is not established. Computed input types and unlisted format pictures remain preserved without protected filling. FORMCHECKBOX paints as a square box with matching layout advance and caret geometry, a minimum 24px pointer target, and a bounded accessible name when no macro references exist; Tab focuses checkboxes, and a click or Space toggles w:checked in edit mode and under forms protection, and a field with w:enabled off refuses. FORMDROPDOWN uses a native select with keyboard input, undo, and save/reopen; a choice updates w:result and the cached text in edit mode and under forms protection. Disabled fields, viewing mode, and suggesting mode refuse changes. Results with nested fields, revisions, or non-text structure cannot use the default-text dialog or protected filling.',
  },

  // --- Document structure & content controls ---------------------------------
  {
    id: 'structure.content-controls',
    name: 'Content controls (SDT): block, inline',
    category: 'structure',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      "Block, inline, row, and cell controls are addressable across stories, including tables, headers, footers, and notes. Value updates preserve enclosing table structure and formatting after saving and reopening. Typing replaces placeholder prompts inside their controls, including controls inside tracked insertions. The editor rejects updates that would discard tables or nested controls. Find, create, fill, and remove controls by tag, title, or file ID. Inserting at the caret creates an empty control with a placeholder as one undo step. Tag, title, and lock values are editable through the API. All four `w:lock` modes apply, including enclosing locks and nested bound controls. Locks affect the control and its content. Under forms protection, only control content is editable. Hosts can opt in to formatting content-locked controls with `contentLockPolicy.allowFormattingInLockedContent`; text edits stay refused. Repeating-section and custom-XML-bound controls are preserved. Bound content cannot be edited; control removal remains available. With `lockedControlNavigation: 'atomic'`, the caret treats a content-locked inline control as one unit.",
    docsLink: '/docs/2.x/guides/content-controls',
  },
  {
    id: 'structure.repeating-sections',
    name: 'Repeating section controls',
    category: 'structure',
    editing: 'none',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Repeating-section markup is preserved and rendered. Item add and remove operations and section configuration edits are unsupported.',
    docsLink: '/docs/2.x/guides/content-controls',
  },
  {
    id: 'structure.typed-controls',
    name: 'Dropdown, checkbox, date, picture & gallery controls',
    category: 'structure',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      "The document API can propose text and date controls around existing ordinary text outside collaboration. Accept keeps the control; Reject restores the original text. Empty tracked ranges and existing review markup refuse. Each control accepts only the value its own type allows. A dropdown must name an item it declares, and a combo box also takes free text. A date validates an ISO instant and writes both `w:fullDate` and the formatted text. A checkbox writes its declared glyph and its state together. Editor checkbox toggles use MS Gothic when the state omits its font. The first write replaces a literal prompt whole, so clearing the value later leaves the control empty. A control saved with empty content opens showing the glossary placeholder its properties name, or the type's default prompt, so it can be filled like any other; a control emptied by deletion shows its prompt again. Control buttons appear on hover, at the caret, and under show-all, as Word's tabs do. A `w:temporary` control removes its own wrapper on the first edit and keeps the content. Typing at either edge of a content-locked, data-bound, checkbox, or picture control places the text beside the control, so a chip at the start of a paragraph or next to another chip can have text typed before it. The value button sits past the control's right edge and scales with zoom; menus open under the control's left edge and stay on the page. The date picker follows the editor locale for names, first weekday, and numeric entry. All three renderers offer month/year navigation, Home/End and Page keys, Today, invalid-date feedback, focus return, and Tab wrapping. Dropdowns have typeahead and roving focus; combo inputs connect to their suggestion list. Shared popup placement follows scrolling and size changes, flips above, and clamps to the visible sheet. Host renderers receive dropdown, combo box, date, and gallery presses as sessions, and checkbox or picture presses when they opt in. A picture control's button opens a file dialog; the chosen PNG, JPEG, GIF, BMP, or WebP image replaces the control's picture and keeps the drawing's size. A building block gallery control lists the blocks the document's glossary stores for its gallery and category, and a pick replaces the control's content with the block's body under fresh paragraph identities; a document without matching blocks shows a note. Blocks from Word's Building Blocks template are not available.",
    docsLink: '/docs/2.x/guides/content-controls',
  },
  {
    id: 'structure.custom-xml',
    name: 'Custom XML parts & data binding',
    category: 'structure',
    editing: 'none',
    rendering: 'none',
    roundTrip: 'preserved',
    tier: 'community',
    notes:
      'customXml parts and w:dataBinding round-trip with structural fidelity. The editor does not evaluate a binding.',
  },
  {
    id: 'structure.misplaced-breaks',
    name: 'Breaks outside runs (w:br, w:cr)',
    category: 'structure',
    editing: 'partial',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Some files put a break directly in a paragraph or hyperlink, outside a run. The editor keeps that break in place and saves it unchanged. The text around it renders and stays editable. The break itself does not start a new line or page. The caret does not stop at it, and deleting text across it keeps it.',
  },
  {
    id: 'structure.macros',
    name: 'VBA macros',
    category: 'structure',
    editing: 'none',
    rendering: 'none',
    roundTrip: 'preserved',
    tier: 'community',
    notes:
      'The editor never executes a macro, by design. The vbaProject part survives open and save.',
  },
  {
    id: 'structure.ole',
    name: 'OLE & embedded objects',
    category: 'structure',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'community',
    notes:
      'The editor never runs, loads, or updates OLE objects. An inline embedded object with a standard VML preview picture shows that cached picture read-only, and layout reserves its size. A WMF or EMF preview keeps its size and shows a placeholder when conversion is unavailable. Floating objects, linked objects, and objects with other content show no preview. Picture commands do not apply to a preview. Copy and cut refuse selections containing objects. Rich paste refuses object fragments without changing the target selection. Paragraph frames, including inherited frames, suppress preview geometry but keep object text positions. OLE markup and embedded binaries are preserved through editing and save.',
  },
  {
    id: 'structure.protection',
    name: 'Document protection & editing restrictions',
    category: 'structure',
    editing: 'partial',
    rendering: 'none',
    roundTrip: 'preserved',
    tier: 'community',
    docsLink: '/docs/2.x/guides/document-protection',
    notes:
      'Protection settings round-trip. Forms protection permits supported legacy text field fills, legacy checkbox toggles and dropdown selections, edits inside unlocked content controls, and edits in unprotected sections. Other content edits are refused with a locked result and a reason; packaged controls disable refused commands. Forms protection disables suggesting mode. Read-only protection opens in viewing mode and refuses content edits and comment writes. Comments-only protection permits adding, replying to, resolving, reopening, and deleting comments in editing mode. Tracked-changes protection requires suggesting mode for edits, with a review module and an author. Explicit view mode refuses all writes, including the protection toggle, and permits text selection and copy. Review > Protect Document for Forms enables forms protection or stops an enforced restriction without a password. Each toggle creates one undo step. Stopping protection retains the restriction with enforcement off. The editor cannot set other protection modes, set or verify passwords, or enable forms protection over a different recorded restriction. Permission exception ranges (w:permStart) do not grant editing access. Remote collaboration updates bypass local protection checks.',
  },

  // --- Collaboration, i18n & editing UX ---------------------------------------
  {
    id: 'collab.realtime',
    name: 'Real-time collaboration',
    category: 'collaboration',
    editing: 'partial',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'premium',
    docsLink: '/docs/2.x/pro/collaboration',
    notes:
      'Yjs replicates text, formatting, document structure, review content, tables of contents, notes, headers, footers, drawings, and custom nodes. Presence includes participants, carets, and cross-paragraph selections. Each participant can undo only their edits. A server or headless session can make each operation exactly one undo step with beginUndoGroup, however close together or long the operations are. Concurrent changes to different properties of one paragraph, or to the formatting of the same characters, both apply. Typing survives a peer deleting, reformatting, splitting, or joining away the text it is in, and moves with that text. Text two peers split or join at once shows once, in document order. Accepting or rejecting a tracked change applies to all of that change and to nothing else, also while another participant types or deletes inside it or right after it. Text a participant types inside a deletion while a peer makes it becomes part of that deletion. Formatting applied while a peer moves the same text to another paragraph is not kept. Use WebRTC, Hocuspocus, or another Yjs 13 provider. Editing continues while disconnected and merges buffered changes after reconnection. Applying an edited ProseMirror document is unavailable while a replica is attached.',
  },
  {
    id: 'collab.find-replace',
    name: 'Find & replace',
    category: 'collaboration',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    docsLink: '/docs/2.x/guides/navigation#highlight-text-ranges',
    notes:
      'Searches the body, headers, footers, footnotes, and endnotes, including table cells and saved field results. Find also searches anchored and inline text boxes in the body, headers, and footers. Text boxes in notes are excluded. Selecting a text-box match selects its drawing. Click inside a supported text box in the body, a header, or a footer to edit its paragraphs. Cmd+F on macOS, or Ctrl+F elsewhere, opens Find while focus is in the editor. Find highlights every match and the active match. Use setHighlights or useHighlights to highlight your own ranges, such as glossary terms, and createDocumentSearch to drive Find from code. Highlights are not saved or shared.',
  },
  {
    id: 'collab.anchor-navigation',
    name: 'Scroll to and highlight paragraph references',
    category: 'collaboration',
    editing: 'partial',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'community',
    docsLink: '/docs/2.x/guides/navigation#scroll-to-a-paragraph-reference',
    notes:
      'Use scrollToAnchor with a DocAnchor to reveal a paragraph by its ID. Optional search and occurrence fields locate text within the paragraph. The block, behavior, and offsetPx options control scrolling. Scrolling supports body paragraphs, table cells, block content controls, headers, footers, footnotes, and endnotes. Repeated headers and footers use their first layout occurrence. Text boxes, invalid references, missing references, ambiguous references, and targets without layout positions return false. Use highlightAnchor to highlight body paragraphs, table cells, and block content controls. Highlights use the same styling and timing options as document refresh highlights. Headers, footers, footnotes, endnotes, and text boxes return false. Both methods preserve selection, focus, document content, and undo history. Scrolling also preserves editing scope. Highlights do not affect saved files. React and Vue share these methods.',
  },
  {
    id: 'collab.clipboard',
    name: 'Rich copy/paste (HTML clipboard)',
    category: 'collaboration',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Copy writes plain text and HTML with an embedded document fragment. Pasting that fragment restores styles, lists, tables, links, images, footnotes, and endnotes. Pasted Microsoft Word HTML restores footnotes, endnotes, and equations. Recovered inline and display equations replace their fallback pictures and retain color, highlight, size, bold, and upright text. Equation editing follows the supported math subset. If equation recovery fails, the fallback picture remains. MathML import supports presentation markup. Unknown MathML elements contribute their children, and annotations are omitted. Copied equations reach Microsoft Word as equations, other applications as MathML, and plain text in their linear form. A display equation pasted beside text becomes an inline equation. Pasted Microsoft Word HTML keeps tracked changes with their authors and dates: insertions, deletions, inserted and deleted paragraph marks, formatting changes, and inserted and deleted table rows. Tracked moves paste as a deletion and an insertion. HTML from other sources keeps ins and del elements as tracked changes only when their cite attribute names an author with a mailto: address; otherwise they paste as underlined and struck text. In suggesting mode, a rich paste keeps its formatting and lands as one tracked insertion by the current author: every pasted paragraph mark and table row is part of it, insertions the source proposed join it, and deletions the source proposed stay inside it. Content that cannot be proposed as one insertion, such as tracked moves, pastes as plain text. The plain-text clipboard flavour leaves out deleted text and deleted paragraph marks; in the Original view it copies the text before the changes. Sections, headers, footers, and comments do not travel on the clipboard. Non-body scopes use plain-text paste.',
  },
  {
    id: 'collab.undo-redo',
    name: 'Undo / redo',
    category: 'collaboration',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Typing starts a new undo group after a 1-second pause or 2 seconds of continuous input. A caret move, another edit, a typing format set at the caret, undo, redo, or a collaborator edit to the same paragraph starts a new step. Caret formatting has its own local undo step without changing shared document content. Each Backspace, Delete, and Enter is its own step. Typing over a selection joins following text within the same time limits. Collaborative sessions use the same grouping rules. Undo restores the original text selection across paragraphs; redo restores the final selection.',
  },
  {
    id: 'collab.mount-modes',
    name: 'Detached editors, pop-out windows, and iframes',
    category: 'collaboration',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    docsLink: '/docs/2.x/core/mount-modes',
    notes:
      'Move one editor between same-origin windows while preserving its document, undo history, selection, and collaboration session. Detached editors still save, run commands, and receive remote edits. React and Vue provide window components. Cross-origin windows are unsupported. Destroy the editor to release its retained document.',
  },
  {
    id: 'collab.i18n',
    name: 'Editor UI in 14 languages',
    category: 'collaboration',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'ar, de, en, es, fr, he, hi, id, ja, pl, pt-BR, ru, tr, and zh-CN via @docx-editor.dev/i18n. The ar and he catalogs declare _dir: rtl, and every chrome part under LocaleProvider mirrors for them: toolbar, menus, dialogs, context menu, navigation, rulers, and review cards, and the review column moves to the left of the page. LocaleProvider accepts a dir prop for other catalogs.',
    docsLink: '/docs/2.x/i18n',
  },
  {
    id: 'collab.zoom-fit',
    name: 'Automatic fit / responsive zoom',
    category: 'collaboration',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      "The default zoom mode is `auto`: it fits the page width between 50% and 100%. A container narrower than a Letter sheet shrinks the document instead of overflowing. Chrome that pads the scroll container, such as the navigation pane or the review rail, recomputes the fit. With the review pane setting `overflow: 'shrinkPage'`, a fit shrinks the page toward its `minZoom` so the full review card column fits beside it. A host can pin a fixed scale with `zoom` or `zoomMode={{ type: 'fixed' }}`, or ask for uncapped fit-width. The toolbar ladder and the Ctrl+= and Cmd+= shortcuts use the same engine-owned mode. With the review pane setting `overflow: 'scroll'`, a capped fit keeps the page at its size beside an open review column or navigation pane, and the viewport scrolls sideways to reach them.",
  },
  {
    id: 'collab.document-refresh',
    name: 'Refresh from server updates',
    category: 'collaboration',
    editing: 'partial',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Accept complete DOCX results in React and Vue without replacing the editor instance. Preserve scroll by default. Deferred replacements finish opening and restore document clicks. Reject local edits, stale results, and collaborative sessions. Present temporary paragraph highlights with configurable color, opacity, padding, corners, borders, CSS decoration, and separate entrance and exit fades. Select changes by ID. Auto-dismiss highlights after a configurable timeout and respect reduced motion. Customize scroll alignment, padding, motion, and focus using validated body locations or a registered review module. Report unavailable anchors with stable diagnostic codes and their requested locations. Match paragraph IDs without case sensitivity. Processor descriptions support review lists for structural changes and deletions without a body location. Reload resets selection and undo history. Arbitrary file comparison and merging are outside this API.',
    docsLink: '/docs/2.x/guides/document-refresh',
  },
  {
    id: 'collab.agent-tools',
    name: 'Document automation object model',
    category: 'collaboration',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'premium',
    notes:
      'The automation object model requires the EigenPal Pro License. Manual line breaks use U+000B in text reads and writes, including tracked insertion. Column breaks read as U+000E and refuse text writes. Paragraph separators remain carriage returns. Line feeds and carriage returns in inserted text start new paragraphs, including as tracked insertions. It follows a documented subset of the Word JavaScript API. The server entry works over bytes and reports exceeded resource limits with typed errors. The browser entry works over an open editor. Core metadata supports author, title, subject, keywords, comments, and category reads and writes. The last saved author is read-only. Collaborative metadata writes require an existing core-properties part. Standard core, extended, and custom properties can be removed outside collaboration. Removal is the only write in its sync. Other document content remains unchanged. Metadata writes require tracking to be off. Inline picture insertion works on collaborative runtimes, and the picture replicates to every participant. It ships no model integration, tool catalog, or MCP transport.',
    docsLink: '/docs/2.x/editor-api',
  },
];

/** Lookup by stable id; used by <FeatureBadge id="..."/>. */
export const wordFeatureById: Record<string, WordFeature> = Object.fromEntries(
  wordFeatures.map((f) => [f.id, f])
);
