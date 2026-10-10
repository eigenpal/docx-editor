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
      'the paragraph mark. Paragraph borders and character styles stay on the target.',
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
      'Configure font sources with the fonts prop; customFonts() loads your own files under private editor font names. Search standard, configured, and provider fonts in the picker, including in blank documents. Selecting a font loads it without resetting selection or undo history. The editor validates downloaded files and hashes and resolves theme fonts from the document. Word-compatible wrapping requires font bytes. The fonts package supplies six substitutes: the five default families match covered glyph advance widths, while Century Gothic differs by less than 1% in measured samples. Kerning and glyph differences can still change line breaks. packagedFonts() loads requested families and the default face from packaged assets. googleFonts() adds a pinned remote catalog. Compose sources in priority order with useFonts or useDocxSource; later resolvers can skip faces already loaded. Unmatched families keep fallback measurement. Eligible non-ASCII text uses its independently declared hAnsi face before measurement and paint. Combining marks retain the base face across source runs. Font hints keep existing conditional-range behavior. Projected fields switch faces only for uniform results. Canonical font attributes and model offsets stay unchanged. PDF export reports failed font sources and supports custom fallback sources after embedded fonts.',
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
    name: 'Right-to-left & bidirectional text',
    category: 'text',
    editing: 'partial',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Paragraphs use inherited bidirectional settings for alignment, script shaping, visual order, and caret placement. Alignment and indents name leading and trailing sides, and kashida alignments justify. Run direction controls numbers and punctuation independently of paragraph alignment. Runs with effective w:rtl or w:cs use complex-script font, size, bold, and italic properties. Formatting commands resolve inherited styles and document defaults, then write both property variants. Direct false values override inherited values. Arabic and other joining scripts preserve letter forms across adjacent formatting runs, including color changes. Joining requires the same bidirectional level and no intervening whitespace. Kerning and cursive offsets across those boundaries remain unsupported. List markers, spacing, indents, and tab stops follow paragraph direction in body text and table cells, and list markers read right to left. Left-to-right and right-to-left paragraph direction controls are in the toolbar, the Format menu, the Paragraph dialog, and the Ctrl+Shift keyboard chords in documents that already contain right-to-left text. Selection highlights can span separate visual bands; some glyph edges have no distinct caret position. Inline pictures read in the direction of the text around them, in paragraph direction between text of different directions or before the first text, and in the direction of the last text after it. They take the caret and clicks on their leading and trailing sides. Numeric page fields and note marks containing only ASCII decimal digits preserve surrounding text order when they occupy one model character. Positional tabs, other inline objects, paragraphs with floating objects, section direction, and w:dir and w:bdo wrappers have partial support. Typed text does not receive w:rtl automatically. The i18n package includes Hebrew UI translations.',
    docsLink: '/docs/2.x/guides/right-to-left',
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
      'The editor does not draw w:vanish runs or give them space, but preserves their text on save. There is no "show hidden text" option. A paragraph with no visible content collapses when its directly hidden mark precedes another paragraph in the same container. Collapsed paragraphs still advance list numbering. Paragraphs with section breaks follow the section layout rules instead. Body paragraphs can share display flow when their resolved marks enable w:vanish. The paragraph must contain ordinary visible text unless its mark also enables w:specVanish. The bounded subset requires matching continuation geometry, paragraph direction, line-breaking settings, and keep constraints. It preserves source paragraphs, member text formatting, first numbering and before-spacing, and last after-spacing and paragraph-mark formatting. Mixed geometry, contextual spacing, tracked content, cross-paragraph fields, non-body stories, and chains above 64 members stay separate. Export reports unsupported-style-separator for preserved visible-content joins outside this subset.',
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
      'Inline (m:oMath) and display (m:oMathPara) equations lay out and paint as math. Display equations follow m:oMathParaPr justification and center by default when they are the only content of the paragraph. Each equation is one atom in the text: typing beside it creates ordinary runs, and deleting it removes the whole equation. The equation popover edits fractions, radicals, scripts, and n-ary operators in a linear format and removes equations; removing the last equation of a display removes the display. Constructs outside that subset show a text fallback and stay read-only. Unedited equations round-trip verbatim.',
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
      'Justified East Asian lines distribute inter-character spacing. Modern Latin justification measures complete words across formatting runs and terminal note citations before compressing spaces. Citations with reserved page-local widths retain their existing line-break behavior. The final line of a justified paragraph keeps natural spacing at its leading edge. With the w:doNotExpandShiftReturn compatibility setting, a line that ends in a manual line break keeps its natural spacing. In documents that declare compatibility mode 14 or earlier, or no mode, a line that ends in a page or column break stretches to both margins; in mode 15 and later it keeps its natural spacing. Tabs and float passages retain their reserved positions.',
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
      'Keeps graphemes, punctuation, and full-width number groups together across runs. No-break spaces and word joiners retain their line-break behavior across formatting runs. Theme languages and inherited language hints select Latin, East Asian, and complex-script fonts; unresolved Chinese, Japanese, and Korean faces use named defaults. Font resolvers receive these candidates before shaping. Document settings control line breaking, Korean word wrapping, punctuation overflow, and compression. Adjacent punctuation can share spacing, and narrow plain left-to-right paragraphs can use measured glyph bounds for fitting. Authored spaces, paragraph boundaries, decorated text, tracked changes, right-to-left text, mixed Latin text, fields, and gaps beside floating objects retain conservative spacing or fitting. Kana uses fixed advance reductions. Vertical Japanese composition and typography controls in the UI are unavailable. See Word fidelity for individual compression rules.',
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
      'Space before, space after, and line spacing (single, multiple, exactly, at least) all reach pagination. If a document does not define its default paragraph properties, paragraphs use 8pt space after and 278/240 automatic line spacing. If it does not define its default run properties, text uses 12pt. An explicitly empty default keeps 10pt text with no spacing. The engine uses line spacing when it calculates page breaks. The paragraph mark size sets the height of an empty paragraph and of the empty line after a trailing line break. A larger mark does not make a line with text, an inline picture, or an equation taller. A line with only inline pictures takes the text height of the runs that hold them, not of the paragraph style or the mark. The last line of a paragraph keeps the full-size height of its superscript or subscript text, and a larger paragraph style size does not make that line taller. Spaces and tabs do not set line height, so a line with only spaces or tabs is as tall as an empty paragraph. A character style on the paragraph mark sets the height of an empty paragraph and of the empty line after a trailing line break, and formats the list number. Text typed into an empty paragraph takes that character style. The style does not make a line with text or an inline picture taller. Contextual spacing drops the gap between neighbours of the same style in body text and table cells, including implicit default styles. Line-unit paragraph margins use 12pt units or the section grid pitch. In a section with a document line grid, each body line takes whole grid lines with its text centered. The space below the text in a grid line can extend past the bottom margin, so a line fits when its text fits. Multiple line spacing counts in grid lines: a line takes the larger of the grid lines its text needs and the multiple, so double spacing is two grid lines. At-least spacing up to the grid line takes the grid line, and a taller at-least value keeps its own height with the extra above the text. Paragraphs that turn off grid snapping and paragraphs with exact line spacing keep their own line height. Without a grid, at-least spacing adds its extra height above the text, so the whole line must fit above the bottom margin. With single or multiple spacing, only the space below the text can extend past it, including the lower part of a grid line. Table cells snap only with the adjustLineHeightInTable compatibility option. Footnote and endnote text snaps to the grid of the section that holds it. Headers, footers, and text boxes do not snap. Numbering-level paragraph properties participate in layout. The Paragraph dialog sets contextual spacing. Automatic spacing (w:beforeAutospacing, w:afterAutospacing) uses 14pt in body paragraphs and at list boundaries. Adjacent items in the same list suppress automatic spacing, including nested levels. Lists suppress automatic leading space at section start. Table cells suppress automatic spacing at their outer edges. Adjacent space after and space before collapse to the larger of the two. If the document sets w:doNotUseHTMLParagraphAutoSpacing, they add up instead, in body text, table cells, headers, footers, notes, and text boxes, and automatic spacing is a fixed 5pt before and 10pt after.',
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
      'w:keepNext, w:keepLines, w:widowControl and w:pageBreakBefore all reach pagination, and the Paragraph dialog sets each of them. Keep-with-next groups account for the following paragraph’s keep-lines and widow-control requirements when the group fits on a page. Groups can contain more than eight consecutive paragraphs, including paragraphs with inherited keep properties. Explicit page breaks and section boundaries end the group. A kept paragraph that does not fit in the space left on a page splits there if its own keep-lines and widow-control settings allow it, and its last lines open the next page with the following paragraph. In documents that use Word 2013 or later layout, the last kept paragraph that fits before a following paragraph that does not also splits, and its last lines move with that paragraph. This applies to any paragraph in a keep-with-next chain. Earlier layout modes move the chain whole. A value a style supplies reads through the cascade, so a checkbox shows what is in force rather than only what the paragraph authors itself. In a body table, keep-with-next on the first paragraph of the first cell keeps the row with the next row, or with the paragraph after the table. The value can come from paragraph or table styles. Kept rows move to the next page as a group when they and the start of what follows do not fit. A kept row does not split. The next row needs only the first lines of each cell, unless it cannot split. In documents that use Word 2013 or later layout, a row after a kept row does not start a new page: it is the next row of the group, which moves only when it does not fit. In earlier layout, a row that starts a new page ends the group. In Word 2013 or later layout, header rows keep with the first body row in the same way. A keep-with-next paragraph before a table keeps with the header rows, and in Word 2013 or later layout also with the first body row. When every body row keeps, that paragraph also keeps with what follows the table. Table keep decisions measure up to 256 kept rows and the next row; paragraph lookahead remains separate. A keep chain continues through one table only. Closed vertical merges inside the measured group share their height across their rows. Merges entering or leaving the group, active wrap exclusions, rows whose first cell starts with a nested table, and positioned tables keep their existing placement.',
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
      'Left, right, first-line, and hanging indents control line placement. Increase Indent and Decrease Indent are on the toolbar, on Tab, and on Ctrl+M. Inside a list they change the level, so the marker changes too. Outside a list, Tab over a selection of two or more paragraphs indents them, and Tab over a selection that starts at a paragraph start sets a first-line indent, or steps the left indent when the first line is already indented or hanging. Shift+Tab reverses these steps. Tab over selected table cells indents them. The selected text stays. A caret, or a selection in one paragraph that starts inside the text, types a tab character.',
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
      'Paragraph shading (w:shd) is editable. Borders render the common ST_Border styles: single, double, dashed, and dotted. Thick, 3-D, inset, and outset styles use CSS approximations, and art borders paint as a solid rule. Borders round-trip, but you cannot add, change, or remove them in the editor yet.',
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
      'In single-column sections, bounded body text frames support numeric and relative page, margin, or text positioning; fixed width or the containing text column width when width is omitted; auto, minimum, and exact height; every rectangular wrapping mode; single-line left-to-right dropped caps; and bidirectional margin drop caps. Multiline dropped caps, negative text-relative vertical offsets, and right-to-left dropped caps retain ordinary flow to prevent text overlap. A positive authored height sets a minimum when its height rule is absent. Frame attributes inherit individually from styles. Wrapping defaults alone retain ordinary flow. Adjacent paragraphs with identical resolved frame properties share one frame, including inline pictures. Exact-height content clips to the authored rectangle. Locked anchors remain attached during supported edits. Continuous sections clear preceding frames that intersect the body area. Frames outside that area do not advance text flow. Text remains selectable and editable; frame creation, movement, and resizing have no UI. Centered auto-sized, right-aligned auto-sized over a text line or empty paragraph, and supported fixed-width PAGE footer frames retain their specialized layout. Centered PAGE footer frames support auto and around wrapping with direct formatting, unused tab stops, line spacing, and nonnegative first-line indents. The frame and empty anchor share one footer band. A right-aligned frame over an empty paragraph can contain plain text around a simple or complex PAGE field. The empty paragraph sets the flow height. The frame retains its own spacing, except that fixed paragraph spacing suppresses its extra leading space. In a header, an auto-sized frame that opens the header and holds a PAGE field or plain text shares the first line of the next paragraph at the left, center, right, inside, or outside margin, and adds no height. Inside and outside alternate with the physical page, so a page number restart does not change the side. If the frame would meet the text of that paragraph, a table, a drawing, or a paragraph border, the header keeps ordinary flow. Headers also support bounded page-anchored plain-text frames with numeric positions and widths. Adjacent paragraphs with identical direct frame properties share one frame, including its paragraph borders and auto or minimum height. These frames do not increase the body inset. Ordinary header paragraphs and inline images keep their flow positions. This subset requires an ordinary paragraph and nonoverlapping content. Headers with fields or revisions, and frames with exact heights, negative positions, or unsupported properties, keep ordinary flow. Frames with unsupported content and groups that block a full fresh page use ordinary flow. All frame properties survive save.',
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
      'The toolbar toggle creates the numbering definition on first use, so a document that never carried a list can start one. Known single-byte Symbol and Wingdings bullets use Unicode fallback when their font is unavailable. Saved numbering stays unchanged. It also applies the List Paragraph style, the way Word does, which is what closes the space between consecutive items. Turning the list off leaves the paragraph in List Paragraph, and indented, as Word does; pressing Enter on an empty item leaves the list and returns to the margin. Enter within a list item continues a single blank-paragraph separator established by preceding items at the same level, including tracked breaks. Tab and the indent buttons change the level, and the marker changes with it.',
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
      'Numbered lists take the List Paragraph style on the same terms as bulleted ones, so consecutive items close up. The tab after a number stops at the first tab stop past the number when that stop comes before the text indent, so the first line can start left of the indent and fit more text. If the document sets w:doNotUseIndentAsNumberingTabStop, the first tab stop past the number applies wherever it is, and the text indent applies only when no such stop exists. Hebrew (hebrew1, hebrew2), Arabic (arabicAlpha, arabicAbjad), and Devanagari digit (hindiNumbers) formats number in their own scripts. Other script-specific formats fall back to decimal.',
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
      'Files without a compatibility mode, and files in compatibility mode 11, 12, or 14, align the content of a top-level percentage-width table with the text column, for every alignment, indent, and layout, and measure the percentage against the text column plus the stated outer cell margins. The same settings apply in body, header, footer, text-box, and note stories. A table percentage width can be larger than 100%, up to 655.34%, and extends the table past the text column for every alignment, AutoFit and fixed layout, and compatibility mode. Fixed tables without a positive table width can use cell preferences to replace their initial grid. Each cell must have a positive absolute width and occupy one column. The largest preference in each column sets its width, even when the initial grid is wider. Hidden revision rows prevent this replacement. Other width conflicts keep their existing reconciliation. A table indent moves a left-aligned table by the full amount, also when the table is wider than the text column or the indent is wider than the space left. A negative indent moves the table into the left margin. Centered and right-aligned tables ignore the indent. A right-to-left table measures the indent from its leading edge. Nested tables ignore a negative indent. A zero indent on a table overrides the indent of its table style. An AutoFit column widens to hold its widest unbroken word, such as a long URL, with indents and cell margins; the other columns give up width in proportion to their spare room. When the minimums are wider than both the text column and the table, the columns shrink in proportion to their minimums to the wider of the two. An AutoFit column whose cells state no width is sized by its content: it takes its widest unwrapped line when the table has room, and room beyond that is shared in proportion to those widths. Columns with a stated width give way to them first; then they wrap. A cell that spans columns widens them to hold its own widest word, and the columns outside the span give up the width. A nested fixed table needs only the content it holds and paints no wider than its cell: its columns give way down to their own content. A nested AutoFit table also keeps its resolved width. Both keep their leading indent; a narrowed nested fixed table keeps the width its cells of vertical text have. Elsewhere, cells with vertical text set no minimum. Cell spacing sits on each side of every cell, so cells sit twice the spacing apart and from the table edge, within the table width.',
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
      'Hover controls insert a row or column. Drag a divider or the outer right edge to resize. Column resizing supports horizontal grid spans in left-to-right tables, including merged headers. Vertical merges, legacy horizontal merges, row offsets, and merged right-to-left tables remain unsupported for column resizing. The context menu adds seven structural actions. Both adapters ship the same table chrome. The automation object model adds rows at table edges or before and after an ordinary row. Unrelated merged headers survive row insertion. Automation row insertion refuses merged source rows and boundaries that cross vertical merges. New rows and columns copy the paragraph formatting of the cells they come from, and written values take that formatting too.',
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
      'Both adapters expose contextual toolbar controls that set borders and fill on the selected cells. Authored table and cell borders, row border exceptions (w:tblPrEx), and table-style shading render and round-trip. Direct cell shading renders. Direct table shading (w:tblPr/w:shd) is preserved but does not render. Apply shading to cells when you need a visible table background. A rule that two cells share paints once, centered on the boundary between them. With no compatibility mode, or mode 11, 12, or 14, simple single side rules are centered on the grid line. This applies to top-level, unpositioned, left-to-right tables without cell spacing. If the table has an absolute width, its side cell margins start at the center of the rule, and supported left-aligned fixed tables with automatic widths also use that margin space. Fixed tables with automatic or absolute widths align their leading cell content with the table indent when every row covers the grid and shares that leading margin. Their margins must clear half of each simple side rule. In compatibility mode 15 and later modes, both apply to centered tables with an absolute or automatic width. They also apply to left-aligned or right-aligned tables with an absolute or automatic width and one simple rule width on every cell side. Autofit and right-aligned tables use this geometry only when their outer borders fit within the available width. Tables with complete grid rows and missing side borders share the grid line with cell margins when all visible side borders use one simple rule width. These partial frames keep their existing grid position. Those tables with complete frames put the outer edge of the rule on the aligned edge, so the grid moves inward by half a rule. Other tables start the side margins at the inner edge of the rule.',
  },
  {
    id: 'tables.merge',
    name: 'Merged cells (horizontal & vertical)',
    category: 'tables',
    editing: 'none',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Authored merges render and round-trip. A vertical merge takes its height from the rows it covers, and merges that cover the same rows share that height. A vertical merge that contains other vertical merges in other columns is sized with them. A vertical merge inside repeated header rows is sized the same way on the first page and on every repeat. A merge that continues from the header rows into the body rows sizes its first header row instead. A merge that only partly overlaps another one sizes its first row instead. A row inserted at a boundary inside a vertical merge extends the merge by one row and keeps one cell per column. Deleting the row where a vertical merge starts removes that row’s content and starts the merge in the next row, unless a merged cell above on the same grid columns takes that row over. If no later row continues the merge, the surviving cell becomes unmerged. A continuation cell with no merged cell above it starts its own merge when another row continues it. The merge and split commands are declared but refused. Column insert, delete, and resize on a merged table report the engine reason.',
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
      'Empty paragraphs in table cells retain a line and caret space when w:hideMark excludes the end marker from row minimums. Rows split mid-content with correct cut borders. In a body table, pageBreakBefore on the first paragraph of the first cell starts the row on a new page. The value can come from paragraph or table styles. In documents that use Word 2013 or later layout, a row after a row that keeps with the next one does not start a new page. The break skips remaining columns and repeats header rows. A row that starts a vertical merge, or follows one that has ended, can start a new page. A row that continues a vertical merge in any column ignores the property and keeps its placement, because the editor does not split merged cell text at a row break. Nested and positioned tables also keep their existing placement. A row that cannot break across pages moves to the next page, and a row of that kind taller than a page starts on a new page and then splits. A row with a minimum height starts below other content only when the space left holds that minimum. Otherwise it moves to the next page, also when its content is taller than a page, and a keep-with-next paragraph before the table moves with it. If the minimum does not fit on a new page below any repeated header rows, the row splits where it stands. Rows of positioned tables keep their existing placement. Vertically merged cells repaint on continuation pages. In documents that use Word 2013 or later layout, a vertical merge over two rows can break right after its first row. If the merged text cannot place a line within that row’s own height, the row keeps its own height and the merged text starts beside the second row on the next page. Merges over more rows, and merged text that splits inside the first row, keep their existing placement. Repeated headers and bounded complete text rows reserve their shared horizontal border before pagination. This boundary adjustment excludes spaced cells, vertical merges, split rows, positioned tables, drawings, nested tables, and vertical text.',
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
      'The innermost table owns the resize controls, the structural edits, and the cell borders and fill. Outer tables stay unchanged through save and reopen.',
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
      'An anchored table uses tblpXSpec or tblpX across the text, margin, or page box, and tblpY or tblpYSpec against its vertical anchor. Body text wraps beside supported floating tables and below full-width tables, including authored text distances. Passages of a quarter inch or less remain empty, so captions and headings clear near-full-width tables. Text-anchored tables with numeric vertical offsets move with their following paragraph and do not add table height to paragraph flow. Negative offsets retain their position when clear of preceding text; intersecting tables move below that text. Page- and margin-anchored tables that span the text column move to the next page with their following paragraph when earlier text on the page cannot clear them and still leave room for that paragraph. Page- and margin-anchored tables that overlap the text column and reach below the bottom margin break across pages in single-column sections. Such a table starts at its authored position, or higher so that the part that fits on the page ends at the bottom edge of the page, and continues at the top of the next page. Text after the table starts below its last row, and rows split even when they are set not to break across pages. A row whose minimum height does not fit moves to the next page, and a nested table row moves whole. In documents that use Word 2013 or later layout, the first part ends at the bottom margin. In earlier layout, only a table that reaches below the bottom edge of the page breaks, and its first part can reach that edge. Tables with an exact-height row, tables with a line or row taller than the page, tables outside the text column, tables that start in the bottom margin, tables that share an anchor paragraph, tables whose anchor paragraph has a page break, column break, or space before it, and documents with doNotBreakWrappedTables keep their placement. Text-anchored tables taller than a page, using vertical alignment, or affected by earlier wrapping pictures or frames retain row pagination. A text-anchored table marked no-overlap still floats. When it would cover an earlier floating table, it moves right of that table, left of it in compatibility mode 15 and later, or below it. Floating tables can overlap one another, and the cell text of a table placed at its anchor never wraps around another. A continuous section on the same page wraps its text beside the floating tables and wrapping pictures of earlier sections. An ordinary table that would cover a floating table starts below it. Before compatibility mode 15, a right-aligned floating table in the body moves right by its table cell margin. A text-anchored table that covers the text column breaks across pages when the rest of the page cannot hold it but can hold its header rows and first body row; otherwise it moves with its following paragraph. This continuation applies to single-column sections with one table per anchor. Anchors with page or column breaks, or space before them, keep whole-table placement. Tables with text distances above or below them also keep whole-table placement. Tables that fit a full page move together when doNotBreakWrappedTables is enabled. Simple terminal empty anchors retain their shared-page layout. In a header or footer, a top-level floating table sits at its anchor position outside the story flow. In documents that use Word 2013 or later layout, the blocks after it wrap beside it or move below it, and the header or footer grows with them. Body text on every page that shows that header or footer wraps around the table in every layout mode. A page- or margin-anchored header or footer table keeps its page position, and it moves up onto the page when it would pass the bottom edge of the page. Footer text moves below such a table when the table ends above the bottom edge of the footer, and above the table when it reaches past that edge or when the text below it would pass the bottom edge of the page. Text that the table pushes down can extend past the bottom edge of the footer, but never past the bottom edge of the page. Footer text that wraps beside a narrow table grows the footer upward when it would pass the bottom edge of the page. Floating-table positioning has no editing UI.',
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
      'The engine lays out and paints embedded PNG, JPEG, and GIF at the authored size. Embedded PNG, JPEG, GIF, BMP, and WebP images use their detected format. This also applies when the file declares another format from that group. Mismatches involving SVG, TIFF, WMF, or EMF remain refused. The original bytes and package declarations survive save. JPEG validation accepts large metadata segments and accounts for EXIF-oriented intrinsic dimensions without rewriting the photo. Both adapters ship insert and overlay authoring: the Insert menu, toolbar, properties dialog, and keyboard resize through the shared engine commands. An inserted image keeps its natural size when it fits and scales down proportionally to its cell, column, or page content box when it does not. Text after an inline image starts at its edge, and a click past the image places the caret after it. An image that does not fit before a floating object continues past it on the same line, like a word. With formatting marks shown, the paragraph mark sits on the text baseline after a trailing image, at the size of the paragraph mark.',
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
      'Nine wrap modes, exclusion reflow, z-order, and drag and resize in both adapters. In-front and behind-text overlays are not cropped by their anchor cell. The wrap mode controls text flow and behind-text controls only paint order, so a behind-text object with square, tight, through, or top-and-bottom wrap still moves text. A top-and-bottom object that crosses the first line of a paragraph or its space before moves that line below the object, and the line keeps its space before. A top-and-bottom object positioned against the page or a margin keeps that position wherever its anchor paragraph is, and moves only the lines it crosses, before or after its anchor. Authored anchor text distances are preserved. Text clears rectangular gaps narrower than the next glyph. A line break with w:clear restarts the following text below the floating objects on one side: left clears objects that block the start of the line, right clears objects past the break, and all clears every wrapping object. In a table cell, an object with layoutInCell off is placed against the page in compatibility mode 14 or earlier, or when the document declares no mode, and the table rows it touches move below it. In Word 2013 mode and later it stays in the cell, as in Word. A floating object above a table cell paragraph, or beside the lines it holds, does not change how that paragraph breaks or where its lines start. Objects that must not overlap move beside each other before they move down. Before Word 2013 mode, header and footer text outside tables does not wrap around the objects in that header or footer. Header and footer objects paint under the body text and body objects, in the editor and in PDF export. In-front and behind-text order them only against the header or footer text. Both share setImageWrapType and toolbarCommandState.',
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
      'The browser rasterizes the metafile and the editor paints it at the authored extent. A metafile that will not convert keeps its extent and shows a labelled placeholder. The original bytes round-trip untouched.',
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
      'The browser decodes baseline TIFF and the editor paints it at the authored extent. A multi-page file shows its first page. A flavour that will not decode keeps its extent and shows a labelled placeholder. Inserting a new TIFF is not supported yet.',
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
      'Anchored text boxes render their content clipped inside the authored extent. Empty anchor paragraphs flow around preceding floating objects. An empty paragraph keeps its place beside a floating object that leaves a passage, and moves below one that covers the whole column. This works in the body, in headers, and in footers, including page-relative anchors. PAGE, NUMPAGES, and SECTIONPAGES fields inside a header or footer text box are evaluated per page. Insert → Text Box creates an editable rectangular box from a body paragraph. Unrotated body text boxes support typing, paragraph editing, text formatting, plain-text paste, undo, deletion, dragging, and resizing. These edits synchronize during collaboration, with remote cursors and text selections. Clicking text shows the caret and frame handles. Text boxes with tables and text boxes in headers or footers remain read-only. The automation API reads, searches, and edits floating and inline text box stories in the body, headers, and footers through Shape.body. Saving writes edited text box text into the legacy VML copy too. Inline text boxes take their extent on the line, stand on the baseline, and render their content clipped inside the extent, in the body, in table cells, and in headers and footers. Inline text boxes in the body support the same text editing as anchored ones, and these edits synchronize during collaboration. Inline text boxes move with their line and cannot be dragged or resized. Half of a text box outline width also insets its content. Legacy VML text boxes on rectangles, rounded rectangles, and text box shapes render the same way, floating or inline, with their inset margins and solid fill and outline. Find reaches them, and body boxes take the same text editing, while the VML shape itself stays read-only. A rounded VML text box paints square corners, and vertical VML text flow keeps the shape opaque. A text box inside another text box, linked chains, autofit, and rotation render as a placeholder or clip.',
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
      'Solid rectangles, ellipses, diagonal lines, bounded polygon geometry, and grouped shapes render with sRGB or theme colors. An outline keeps its full width past the edge of the drawing. An inset outline (algn=in) draws inside its geometry. Vertical and horizontal lines render, standalone or inside a group. A shape group can also hold one embedded picture below its shapes. The picture must be visible, unrotated, unflipped, and rectangular. It must have no fill rectangle offsets, image effects, visible outline, shape effects, or 3D properties. It renders in its own frame, in the editor and in PDF export. Groups and their members must have supported visibility, effects, and 3D settings. A group renders completely or not at all: when any member cannot render, it follows the rule for unsupported groups. Other payloads reserve their extent with a placeholder. In mc:AlternateContent, an unsupported payload shows no placeholder and no part of itself, for example a group that holds a nested group. If it floats with square, tight, through, or top-and-bottom wrapping, text still flows around its wrap area. Text box members of a group render their text in the editor and in PDF export, in the scaled member box with their own insets, vertical anchor, and wrapping. Find reaches that text and selects the group. The text is read-only. A rotated member turns its text with it, a vertical flip turns the text upside down, and a horizontal flip does not mirror it. A rotated or flipped group still follows the rule for unsupported groups.',
  },
  {
    id: 'images.legacy-vml',
    name: 'Legacy VML pictures, annotation groups & straight WordArt',
    category: 'images',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'community',
    docsLink: '/docs/2.x/guides/images',
    notes:
      'Standalone w:pict supports bounded unrotated photos and groups of photos, inline photos with one uniform single-line border on all four sides, simple solid geometry including rounded rectangles, arrowed lines, and straight fit-to-box WordArt. Floating lines drawn between from and to points render in the editor and in PDF export. Floating shape paths with two explicit points and one zero extent also render as native lines. Invalid zero coordinate axes remain opaque. Aligned positions (left, center, right, top, bottom, inside, outside) are supported. A shape without absolute positioning is inline. Previews do not replace canonical VML or add media parts. Unknown templates, unsupported members, rotation, and clipped groups remain opaque as a whole. VML-only MC fallbacks are unchanged.',
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
      'Brightness, contrast, grayscale, and bilevel black-and-white adjustments render in the editor. Image alpha and authored adjustment markup are preserved. The PDF exporter applies fixed image opacity but reports unsupported color adjustments.',
  },
  {
    id: 'images.effects',
    name: 'Picture effects (shadow, glow, reflection)',
    category: 'images',
    editing: 'none',
    rendering: 'none',
    roundTrip: 'preserved',
    tier: 'community',
    notes:
      'Not painted and not editable. Authored effect markup and effectExtent spacing are preserved.',
  },
  {
    id: 'images.charts',
    name: 'Charts (DrawingML)',
    category: 'images',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'community',
    docsLink: '/docs/2.x/guides/images',
    notes:
      'The extent is reserved with a labelled placeholder. The chart payload is preserved generically, not edited.',
  },
  {
    id: 'images.smartart',
    name: 'SmartArt & diagrams',
    category: 'images',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'community',
    docsLink: '/docs/2.x/guides/images',
    notes: 'Same placeholder policy as charts. The payload is preserved inertly.',
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
      'The layout engine uses page breaks, paragraph keep rules, and section settings to calculate pages. You can insert a hard page break, which writes `w:br w:type="page"`. Manual page breaks inside table cells retain their document offsets but do not add lines, line height, or pages. Line wrapping, tab alignment, bidirectional text order, and text wrap around floating pictures ignore them. If the font of the run has Arabic glyphs, layout measures Arabic letters on the two sides of a break as one joined word. If the font has no Arabic glyphs, the browser fallback measures each side separately, so the width can differ from the same text without the break. Manual line breaks still start a new line. When a paragraph starts with a manual page break and has text after the break, the text starts on the next page, even when the current page has no room for another line. A list number or bullet goes to the next page with the text. The top border of the paragraph also goes to the text on the next page, and lines that hold only page breaks draw no border. The space before of the paragraph goes there too, reduced by the space after of the paragraph above. Shading fills each break line where it sits. A break that the current view hides does not count. Paragraphs with only a page break, or with anchored floating tables, text frames, or drawings, keep the ordinary rule, so after a full page their text starts one page later.',
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
      'Page size, orientation, and margins are editable per section or for the whole document, from the Page Setup dialog or a ruler drag. Each section uses its own page dimensions and margins for pagination. A negative top or bottom margin sets the exact distance from the page edge to the text. A taller header or footer then overlaps the text and does not move it. In that overlap, text, links, note references, pictures, and form fields take the pointer, and a closed header or footer highlights only its part in the page margin. To edit the header or footer, double-click it in the page margin, or on its content where no text is under the pointer. You can insert a next-page or a continuous section break; a continuous one keeps the new section on the sheet the previous section ended. This also applies when the new section has a taller header or footer, or a different first page. That sheet keeps its header, footer, and text area, and the header and footer of the new section start on the next sheet. A different page size or orientation starts a new sheet. When a section has other content, the empty paragraph that ends it before a continuous section takes no vertical space. A manual page break followed by an empty section-break paragraph advances one page when the next section starts on a new page, so no blank page appears between them. An empty section-break paragraph after other content in its section ignores its own page break before, so it does not add a blank page. An odd-page or even-page section starts on a page whose number has that parity. With different odd and even pages turned on, a section that restarts its page numbering starts on a sheet whose position has the parity of the restarted number. When the next sheet has the wrong parity, layout inserts one empty sheet with no header, footer, or content. `NUMPAGES` counts that sheet, and `SECTIONPAGES` does not. You cannot insert odd-page or even-page section breaks. Per-section columns render from w:cols, but column editing controls are unavailable.',
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
      'Both adapters have scoped header and footer editing: enter and exit the story, create and remove it, link and unlink to the previous section, and set the title-page and even/odd options. They also insert PAGE, NUMPAGES, and SECTIONPAGES. `editHeaderFooter` takes `variant`, `evenPage`, and `firstPage` on the shared Editor contract. Per-section first, even, and default variants paint like Word. Editing inside a header or footer matches the body: lists, tables, content controls, pictures, fonts, comments, bookmarks, and page setup all act on the story you are in. Tracked changes work in a header or footer: you can suggest an edit there, and the review list shows it with the accept and reject verbs. Selection and comment highlight bands paint in the body only. Watermark authoring is not supported.',
    docsLink: '/docs/2.x/guides/headers-footers',
  },
  {
    id: 'layout.watermarks',
    name: 'Watermarks (text & image)',
    category: 'layout',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'community',
    notes:
      'The supported unrotated standalone VML subset can paint in header parts. Rotated or curved watermark templates remain opaque, and watermark authoring is unavailable. Authored markup and package relationships are preserved through save.',
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
      'The document API exposes Body.footnotes and Body.endnotes in reference order, including scoped table-cell reads. Existing note bodies support edits; API note creation remains unsupported. Both adapters have a typed note model, note layout (pageBottom, beneathText, sectEnd, docEnd), scoped note editing, insert, delete, convert, and chrome slots. A paragraph reference stays when a legal note opening fits below it, even if the whole note fits a fresh page. Note paragraphs respect w:keepLines and w:widowControl; without widow control, one note line can start there. This admission applies to full-width, single-column body paragraphs in every compatibility mode. Note keep-with-next groups and notes containing tables retain whole-note admission. A splittable continuation returns when its required body opening and complete attached notes fit; later references outside that opening add no demand. A reference in a table row keeps its note with that row. The row moves with the note only when the note can place fewer than two lines below the row; otherwise the note continues on the next page. A row that every cell lets split below the reference line continues on the next page below that split; w:cantSplit and exact-height rows do not split there, nor do w:keepLines or widow-controlled cell paragraphs in Word 2013 layout, unless the row is too tall to stay whole. A returning paragraph continuation includes its earlier fragment when checking note space. If the returning reference leaves no note space, the previous split decision stays in place. A reference paragraph that keeps with its successor includes the notes in that successor’s required opening. A successor opening without a reference adds no footnote reserve. Paragraphs ahead of a moved reference return to the earlier page when they fit, unless they keep with the reference paragraph; multi-column sections keep that room, and so does a reference on the second line of a widow-controlled paragraph whose note could not start on the earlier page. A reference on the second line of a widow-controlled paragraph can keep the first two lines on the page while its whole note starts on the next page. The note area can use the space below the text of the last body line with single or multiple line spacing, while a line whose note starts on the same page keeps its full height above the notes in every column. A note taller than the page note column continues across pages. Page-bottom and beneath-text footnotes reserve authored continuation notices, including empty paragraphs, below notes that continue. Notices remain noneditable furniture. Live header changes that resize the body area also update footnote pagination. Oversized notices report note-continuation-notice-height-cap without stopping note text. Section-end and document-end notices remain unsupported. The w:separator rule takes its thickness and its offset above the baseline from the strikeout metrics of the run font. Overflow sheets retain separate page rectangles for painting and hit testing. Editing inside a note matches the body: lists, tables, content controls, pictures, fonts, comments, bookmarks, and page setup. Suggesting mode tracks an inserted reference and requires reference deletion to propose note removal. Notes in headers and footers are out of scope.',
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
      "Section w:cols count, gap, separator, and equal or unequal widths paginate into columns. Decimal and unit-suffixed widths and gaps truncate to whole twips. A w:col without a gap has no gap, and one without a width spans the text area. Widths and gaps that do not fit the page are kept, so later columns can extend past the page edge. Equal columns narrow to a minimum of 0.01 inch and keep their gaps. If a w:col width or gap cannot be used, or there are fewer w:col elements than columns, the section uses equal columns. An explicit column break leaves the break paragraph's empty remainder at the top of the next column. Continuous multi-column sections balance. Column editing chrome is not exposed.",
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
      "The page number in the document selects the first, even, or default variant, so the alternation carries across section breaks. You can edit each variant in an open furniture scope. `editHeaderFooter({ variant: 'even' })` creates or opens the even story and enables `w:evenAndOddHeaders` in one undo unit. Header and footer chrome in both adapters can toggle different even and odd pages.",
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
      'Suggesting mode, review markup, and review actions require the EigenPal Pro License. Opening and saving existing revisions require no review module. The document API tracks text, fonts, paragraph formatting, list membership, and paragraph insertion. Table suggestions support complete insertion, value replacement, row additions, and partial row deletions. Eligible nonempty text can become a proposed text or date control outside collaboration. Tracked ranges across paragraphs and table or cell value replacement refuse in collaboration. Row deletion suggestions must leave a row without a pending deletion. Existing table properties and columns require permanent edits; eligible complete proposed tables support configuration. The editor offers Simple Markup, All Markup, No Markup, Original, author filters, and filtered bulk decisions. Hidden authors and unsupported changes remain pending during filtered bulk decisions. The editor and the document API can change the author, and optionally the date, of pending changes without accepting or rejecting them. Original restores prior run and paragraph formatting; prior table, row, cell, and section formatting remains unsupported. Author filters change the display without changing saved revisions. The Track changes options dialog and viewer markup preferences configure revision marks, named colors, optional text backgrounds, change bars, and cell shading through the API and review dialog. Text backgrounds default to none and remain local viewer preferences. Cell shading supports named colors and revision author colors. The dialog adapts to narrow screens. React and Vue support popup replacement, named dialog parts, and custom draft controls. Track formatting can leave future formatting edits untracked while text edits remain tracked. Suggesting mode requires an author. Editor list, indent-level, tab-stop, and table-property changes remain untracked. Malformed revision wrappers refuse resolution and preserve their content. With `pairReplacements`, the review queue lists a deletion and the insertion that directly follows it from the same author as one replacement item. `getReviewItemsAt` and `getReviewItemRects` return review items and their bands on painted pages, so a host can draw its own balloons or margin markers. The review pane settings `opening` and `overflow` keep the pane closed until the host opens it, or shrink a fit-width page so the full card column fits.',
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
      'Review actions require the EigenPal Pro License. Accept or reject one change with acceptReviewItem, rejectReviewItem, or the sidebar. The Review menu also resolves changes shown by active filters. Hidden authors and unsupported changes remain pending. The automation API supports individual decisions and strict or partial batches. Deletion and addition revisions keep independent accept and reject decisions, even when their author, ID, and editing time match. Source revision dates survive save. Opening and saving existing revisions require no review module. The revisionsIn review pane setting lists changes in the review pane or opens each change in a balloon at its text, with replies, a reply field, and accept and reject controls. A balloon opens on a click in the page, Next Change, or Previous Change, and a caret move alone does not open it. A balloon that Next Change opens takes the keyboard focus and is announced to screen readers. An adjacent deletion and insertion from one author open as one replacement.',
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
      'Comment authoring and review controls require the EigenPal Pro License. Opening and saving existing comments require no review module. The review rail shows threads, replies, and resolution controls. React hosts use `@docx-editor.dev/pro/react`; Vue hosts use `@docx-editor.dev/pro/vue` with the same engine commands. Saving normalizes recognized empty comment parts when no markers or retained relationship dependencies remain. The commentMarkers review pane setting draws collapsed thread markers as author initials badges with a reply count and a resolved check mark, or as comment icons.',
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
      'The automation object model requires the EigenPal Pro License. Manual line breaks use U+000B in text reads and writes, including tracked insertion. Column breaks read as U+000E and refuse text writes. Paragraph separators remain carriage returns. It writes native tracked changes. It works over DOCX bytes on a server, or over an editor open in a page.',
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
    notes:
      'Internal links jump to their bookmark and move the caret. This includes a target on a page the editor has not painted yet. Creating and renaming bookmarks is deferred.',
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
      'The document API inserts inert TOC fields with supported switches; API entry calculation remains unavailable. Insert a body TOC from the shared Insert menu, then refresh it from document headings or TC entry fields. Unsupported source switches preserve the cached table and refuse refresh. A refresh can update the page numbers only. Tab leaders, section-formatted page numbers, and bookmark links all work. The generated rows are read-only navigation links. Ordinary text outside the field boundaries remains editable, including text in the same paragraph.',
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
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'community',
    notes:
      'The saved result displays for a complex field and for w:fldSimple. Line breaks inside a saved result start another line. Page breaks follow the surrounding story rules; page breaks in table cells do not add pages. The field still moves as one unit with the caret. Leading direction marks remain in results without replacing the first visible result run’s formatting. The saved result of a field nested inside another field’s instruction displays nothing, and Find skips it; the outer field keeps its normal display behavior. Field codes round-trip unchanged. Option+F9 on macOS and Alt+F9 on Windows toggle instruction display without changing the document. Some Mac keyboards require Fn. SYMBOL renders its character with the requested font and size. MACROBUTTON and GOTOBUTTON render display text without running the macro or jump. TITLE, AUTHOR, SUBJECT, KEYWORDS, LASTSAVEDBY, COMMENTS, and matching DOCPROPERTY fields render sanitized document metadata. DATE-valued properties stay inert. DATE, TIME, FILENAME, SEQ, LISTNUM, and EQ do not calculate a new value. The editor never runs macros, DDE instructions, or external include instructions.',
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
      'Block, inline, row, and cell controls are addressable across stories, including tables, headers, footers, and notes. Value updates preserve enclosing table structure and formatting after saving and reopening. Typing replaces placeholder prompts inside their controls, including controls inside tracked insertions. The editor rejects updates that would discard tables or nested controls. Find, create, fill, and remove controls by tag, title, or file ID. Inserting at the caret creates an empty control with a placeholder as one undo step. Tag, title, and lock values are editable through the API. All four `w:lock` modes apply, including enclosing locks and nested bound controls. Locks affect the control and its content. Under forms protection, only control content is editable. Repeating-section and custom-XML-bound controls are preserved. Bound content cannot be edited; control removal remains available.',
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
      'Protection settings round-trip. Forms protection permits supported legacy text field fills, legacy checkbox toggles and dropdown selections, edits inside unlocked content controls, and edits in unprotected sections. Other content edits are refused with a locked result and a reason; packaged controls disable refused commands. Forms protection disables suggesting mode. Read-only protection opens in viewing mode and refuses content edits and comment writes. Comments-only protection permits adding, replying to, resolving, reopening, and deleting comments in editing mode. Tracked-changes protection requires suggesting mode for edits, with a review module and an author. Explicit view mode refuses all writes, including the protection toggle. Review > Protect Document for Forms enables forms protection or stops an enforced restriction without a password. Each toggle creates one undo step. Stopping protection retains the restriction with enforcement off. The editor cannot set other protection modes, set or verify passwords, or enable forms protection over a different recorded restriction. Permission exception ranges (w:permStart) do not grant editing access. Remote collaboration updates bypass local protection checks.',
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
      'Yjs replicates text, formatting, document structure, review content, tables of contents, notes, headers, footers, drawings, and custom nodes. Presence includes participants, carets, and cross-paragraph selections. Each participant can undo only their edits. One simultaneous run-formatting split converges without duplicate text. A later split after one concurrent run-formatting round can duplicate text. Replicas still converge. Use WebRTC, Hocuspocus, or another Yjs 13 provider. Optional offline editing merges buffered changes after reconnection. Applying an edited ProseMirror document is unavailable while a replica is attached.',
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
      'Searches the body, headers, footers, footnotes, and endnotes, including table cells and saved field results. Find also searches anchored and inline text boxes in the body, headers, and footers. Text boxes in notes are excluded. Selecting a text-box match selects its drawing. Click inside a supported body text box to edit its paragraphs. Cmd+F on macOS, or Ctrl+F elsewhere, opens Find while focus is in the editor. Find highlights every match and the active match. Use setHighlights or useHighlights to highlight your own ranges, such as glossary terms, and createDocumentSearch to drive Find from code. Highlights are not saved or shared.',
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
      'Copy writes plain text and HTML with an embedded document fragment. Pasting that fragment restores styles, lists, tables, links, images, footnotes, and endnotes. Pasted Microsoft Word HTML restores footnotes, endnotes, and equations. Recovered inline and display equations replace their fallback pictures and retain color, highlight, size, bold, and upright text. Equation editing follows the supported math subset. If equation recovery fails, the fallback picture remains. MathML import supports presentation markup. Unknown MathML elements contribute their children, and annotations are omitted. Copied equations reach Microsoft Word as equations, other applications as MathML, and plain text in their linear form. A display equation pasted beside text becomes an inline equation. Sections, headers, footers, and comments do not travel on the clipboard. Suggesting mode and non-body scopes use plain-text paste.',
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
    id: 'collab.i18n',
    name: 'Editor UI in 12 languages',
    category: 'collaboration',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes: 'de, en, es, fr, he, hi, id, ja, pl, pt-BR, tr, and zh-CN via @docx-editor.dev/i18n.',
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
      'Accept complete DOCX results in React and Vue without replacing the editor instance. Preserve scroll by default. Reject local edits, stale results, and collaborative sessions. Present temporary paragraph highlights with configurable color, opacity, padding, corners, borders, CSS decoration, and separate entrance and exit fades. Select changes by ID. Auto-dismiss highlights after a configurable timeout and respect reduced motion. Customize scroll alignment, padding, motion, and focus using validated body locations or a registered review module. Report unavailable anchors with stable diagnostic codes and their requested locations. Match paragraph IDs without case sensitivity. Processor descriptions support review lists for structural changes and deletions without a body location. Reload resets selection and undo history. Arbitrary file comparison and merging are outside this API.',
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
      'The automation object model requires the EigenPal Pro License. Manual line breaks use U+000B in text reads and writes, including tracked insertion. Column breaks read as U+000E and refuse text writes. Paragraph separators remain carriage returns. It follows a documented subset of the Word JavaScript API. The server entry works over bytes and reports exceeded resource limits with typed errors. The browser entry works over an open editor. Core metadata supports author, title, subject, keywords, comments, and category reads and writes. The last saved author is read-only. Collaborative metadata writes require an existing core-properties part. Standard core, extended, and custom properties can be removed outside collaboration. Removal is the only write in its sync. Other document content remains unchanged. Metadata writes require tracking to be off. It ships no model integration, tool catalog, or MCP transport.',
    docsLink: '/docs/2.x/editor-api',
  },
];

/** Lookup by stable id; used by <FeatureBadge id="..."/>. */
export const wordFeatureById: Record<string, WordFeature> = Object.fromEntries(
  wordFeatures.map((f) => [f.id, f])
);
