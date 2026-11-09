/**
 * DOCX feature support matrix: single source of truth.
 *
 * Rendered on docx-editor.dev at /docs/2.x/docx-fidelity via the site's
 * <FeatureMatrix> / <FeatureBadge> components (the site syncs this file at
 * build time, same pipeline as docs/site/content). The `tier` field exists
 * so the same data can drive feature access and pricing pages.
 *
 * Status axes:
 * - editing:   can the user (or code driving the editor) change it in the editor?
 * - rendering: does it display as the OOXML specification and the document settings define?
 * - roundTrip: does it survive open -> edit -> save -> reopen without loss?
 *
 * Honesty rule: when in doubt, downgrade. A "partial" that turns out to be
 * full delights; a "full" that turns out to be partial burns trust.
 *
 * Notes rule: notes render inside a table cell. Use at most three short sentences. Write
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
      'Export the document as Markdown with a configured menu.exporters.markdown handler. Missing handlers show a setup error; export keeps the source document unchanged.',
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
      'Export PDF on Node.js with a configured menu.exporters.pdf handler and the EigenPal Pro License. Export supports review markup and comments, with font and drawing limits. Missing handlers show a setup error.',
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
      'Print through a configured menu.exporters.pdf handler with the EigenPal Pro License. Choose which tracked changes and comments to print. Missing handlers show a setup error; browsers without a PDF viewer offer an Open PDF link.',
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
      'Apply formatting to selected text or the word at the caret. At a word boundary or in an empty paragraph, formatting applies to the next text you type.',
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
      'Type with your operating system input method, including in empty paragraphs and beside inline pictures. Committed text supports undo, collaboration, and saving. Candidate-window placement depends on the browser and operating system.',
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
      'Copy character formatting, plus paragraph formatting when your selection includes the paragraph mark. The target keeps its paragraph borders and character styles.',
  },
  {
    id: 'text.sub-superscript',
    name: 'Subscript & superscript',
    notes:
      'Raised and lowered text increases automatic and minimum line heights to fit. Exact line spacing keeps its specified height.',
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
      'Choose fonts and sizes from the picker, or configure custom, packaged, and Google Fonts sources. Accurate line wrapping requires font files; substitute fonts can change line breaks. Fonts can load in the background, but export waits for them.',
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
      'The editor loads embedded fonts without configuration or network requests and uses them to measure text. Saving preserves the font files. You cannot embed additional fonts through the editor.',
  },
  {
    id: 'text.color',
    name: 'Text color (RGB + theme colors)',
    category: 'text',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Apply RGB colors or document theme colors to text. Saving preserves theme references so colors can follow the document theme.',
  },
  {
    id: 'text.highlight',
    name: 'Highlight & shading',
    category: 'text',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Apply standard highlight colors or custom shading fills. Shading patterns display as solid colors that approximate their average tone.',
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
      'Edit Arabic, Hebrew, Persian, and Urdu text with mixed-direction paragraphs, lists, tables, and columns. Arabic letters join across supported formatting changes, but kerning across those changes remains unsupported. Some characters have no separate caret position.',
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
      'Type and format Chinese, Japanese, and Korean text with your operating system input method. Configure regional fonts through googleFonts({ cjk: true }) or @docx-editor.dev/fonts-cjk. Vertical text displays only in table cells.',
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
      'Solid, opaque RGB text outlines display. Other outlines, shadows, embossing, and emphasis marks remain saved but do not display. The editor has no text-effect controls.',
  },
  {
    id: 'text.fit-text',
    name: 'Fit text (w:fitText)',
    category: 'text',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Existing fit-text groups expand or compress to their specified width and wrap as one unit. Text typed inside a group joins it. You cannot apply fit text through the editor controls.',
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
      'Hidden text occupies no space and remains in the saved document. Supported hidden paragraph marks join visible text into one flow; other paragraphs stay separate. The editor has no option to show hidden text.',
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
      'View inline and display equations, and edit supported fractions, radicals, scripts, and operators through the equation popover. Unsupported equations show text instead, and edits that cannot preserve their properties are unavailable. Saving preserves unedited equation markup.',
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
      'Insert and delete symbols as single characters. Symbols without a Unicode equivalent require their original font, and Find does not match symbols. You cannot edit existing symbol formatting.',
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
      'Apply left, center, right, justified, or distributed alignment. Justified paragraphs keep natural spacing on their final line; distributed paragraphs stretch it. Compatibility settings affect spacing around tabs, breaks, floating objects, and spaces beside East Asian text.',
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
      'Document settings control spacing between scripts, punctuation compression, and punctuation at line ends. Behavior depends on document fonts, language, and compatibility settings. The editor has no typography controls or vertical Japanese composition.',
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
      'Thai, Lao, Khmer, and Myanmar text wraps at character clusters, without dictionary-based word breaks. Insert a zero-width space (U+200B) to mark a word boundary. Table AutoFit keeps unspaced text together.',
    docsLink: '/docs/2.x/docx-fidelity',
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
      'Set paragraph spacing and single, multiple, exact, or minimum line spacing. Contextual spacing removes gaps between adjacent paragraphs with the same style. Document grids and compatibility settings affect spacing and page breaks.',
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
      'Set keep-with-next, keep-lines, widow control, and page-break-before options in the Paragraph dialog. These settings control paragraph and table placement across pages. Explicit page breaks and section boundaries end keep-with-next groups.',
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
      'Set left, right, first-line, and hanging indents. Indent controls change the level of list items. Tab and Shift+Tab adjust paragraph indents, but move between cells inside tables.',
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
      'Apply document paragraph styles, including custom styles with numbering and indents. Enter starts the next paragraph with the following style specified by the current style. You cannot define styles through the editor controls.',
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
      'Edit paragraph shading and display existing paragraph borders. Common line borders display; decorative and three-dimensional borders use approximations. Saving preserves borders, but you cannot add, change, or remove them through the editor.',
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
      'Set and clear tab stops in the Paragraph dialog, including stops inherited from styles. Existing alignment tabs and dot, hyphen, or underscore leaders display. Bar tabs remain saved but do not display and cannot be edited.',
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
      'Supported text frames display in single-column sections, including single-line left-to-right drop caps. Unsupported frame layouts use ordinary paragraph flow, and exact-height frames can clip text. Text stays editable, but you cannot create, move, or resize frames.',
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
      'The editor preserves document hyphenation settings but does not hyphenate automatically. An optional hyphen permits a line break and appears at that line end. U+00AD displays as a hyphen without permitting a break.',
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
    docsLink: '/docs/2.x/guides/toolbar#create-and-continue-lists',
    notes:
      'Create bulleted lists, continue existing lists, and change levels with Tab or the indent controls. Switching between bullets and numbers preserves item indents. List changes support tracked changes.',
  },
  {
    id: 'lists.numbered',
    name: 'Numbered lists (decimal, roman, letters)',
    category: 'lists',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    docsLink: '/docs/2.x/guides/toolbar#create-and-continue-lists',
    notes:
      'Create numbered lists with decimal, Roman numeral, letter, and supported script-specific formats. Unsupported script-specific formats use decimal numbers. Document settings control marker spacing and indents.',
  },
  {
    id: 'lists.custom-numbering',
    name: 'Custom numbering definitions & style-linked numbering',
    category: 'lists',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Apply styles with custom numbering definitions. Numbering follows the document style rules.',
  },
  {
    id: 'lists.continuation',
    name: 'List continuation & restart',
    category: 'lists',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Lists that share a numbering definition count together. A start override restarts the shared count at its specified level. Headers and footers share a separate count from the body.',
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
      'Existing picture bullets display in the editor and PDF export. Missing or unsupported images use the bullet text instead. Saving preserves picture bullet definitions, but you cannot choose or change them through the editor.',
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
      'Insert tables and edit cell text with fixed or automatic column widths. Document settings control widths, indents, and cell spacing. Compatibility modes can change alignment and sizing.',
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
      'Existing right-to-left tables display and support cell editing, including merged cells and repeated headers. Selection and column controls follow the displayed cell order. You cannot change table direction or resize the outer right edge.',
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
      'Both adapters let you insert, delete, and resize rows and columns. Some merged cells limit resizing and automated row insertion. Suggesting mode does not support moving or deleting a whole table.',
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
      'Both adapters let you edit cell borders and fill. Diagonal borders display, but you cannot edit or copy them through HTML. Direct table shading stays saved but does not display; use cell shading instead.',
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
      'Merge rectangular cell selections or split cells into rows and columns. Suggesting mode permits these operations only inside your own pending table insertion. Concurrent merging can discard text that another participant types into a previously empty cell.',
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
      'Tables continue across pages with repeated headers and row splitting. Row heights, merged cells, and compatibility settings affect page breaks. Some oversized rows in older compatibility modes extend beyond the page or split differently.',
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
      'Edit and resize nested tables without changing their outer tables. Nested tables can continue across pages. Header rows and merged cells affect where they split.',
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
      'Table styles control borders, cell shading, and text formatting, including header rows and banding. Conditional cell margins and whole-table conditional shading do not apply. The editor has no table-style picker.',
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
      'Text wraps around floating tables at their saved positions. Page breaks depend on the anchor, available space, and document compatibility settings. You cannot edit floating-table positions from the interface.',
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
      'Existing top-to-bottom and bottom-to-top cell text displays and survives saving. Bottom-to-top text can clip at the cell edge. You cannot change cell text direction from the interface.',
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
      'Both adapters let you insert, paste, and resize PNG, JPEG, and GIF images. Inserted images shrink proportionally when they exceed the available space. Place the caret in text before inserting another picture.',
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
      'Both adapters support dragging, resizing, and nine text wrap modes for floating images. Text follows the saved wrap distances and image positions. Compatibility settings can change wrapping and page placement.',
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
      'Existing BMP and WebP images display at their saved size. You cannot insert these formats through the image controls.',
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
      'Embedded SVG images display at their saved size. Scripts and external references inside the SVG stay inactive. You cannot insert SVG images through the image controls.',
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
      'WMF and EMF images display as raster images in the editor and as vectors in PDF export. Failed conversions show a placeholder in the editor; PDF export omits them and reports a diagnostic. Saving preserves the original image bytes.',
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
      'Supported TIFF images display in the editor and PDF export; multi-page files show only their first page. Unsupported formats show a placeholder. You cannot insert TIFF images through the image controls.',
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
      'Suggesting mode tracks image insertion and deletion; review actions require the EigenPal Pro License. Image property edits apply directly without tracked changes, and suggesting mode refuses picture replacement. Opening and saving existing image revisions require no review module.',
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
      'Edit text in supported upright text boxes in the body, headers, and footers, including during collaboration. Tables and rotated text remain read-only. Nested boxes, linked boxes, and automatic text shrinking can clip or show a placeholder.',
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
      'Preset shapes and supported custom shapes display with fills, outlines, and outer shadows. Shapes and grouped text remain read-only; additional effects require the drawing module. Unsupported shapes or groups show a placeholder and retain their text wrap area.',
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
      'Supported legacy VML pictures, simple shapes, and annotation groups display without changing their saved source. Unsupported rotation, clipping, or group members prevent the whole group from displaying.',
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
      'Both adapters let you edit picture cropping as percentages. Existing crop settings display and survive saving.',
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
      'The editor displays brightness, contrast, grayscale, and black-and-white adjustments. PDF export applies fixed image opacity but reports unsupported color adjustments. Saving preserves the original adjustment settings.',
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
      'Pictures display supported outlines, outer shadows, and preset shapes in the editor and PDF export. Rotated pictures omit outlines and shadows; additional effects require the drawing module. You cannot edit effects, but saving preserves their settings.',
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
      'The drawing module displays glow, inner shadows, soft edges, supported reflections, and dark bevel rims. It requires the EigenPal Pro License; PDF export includes the module. Effects remain read-only, and unsupported reflections and 3-D materials do not display.',
  },
  {
    id: 'images.wordart',
    name: 'VML text paths',
    category: 'images',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'premium',
    docsLink: '/docs/2.x/pro/drawing',
    notes:
      'The drawing module displays supported VML text paths with fills, outlines, shadows, and rotation. It requires the EigenPal Pro License; PDF export includes the module. Unsupported gradients, perspective extrusion, and missing shape definitions do not display.',
  },
  {
    id: 'images.charts',
    name: 'Charts (DrawingML)',
    category: 'images',
    editing: 'partial',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'premium',
    docsLink: '/docs/2.x/guides/charts',
    notes:
      'You can insert seven chart types, resize, move, and wrap them, and edit their data and format in the Chart pane. The drawing module paints charts and requires the EigenPal Pro License. You can copy and paste one chart within the page; external data loading is unavailable.',
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
      'The drawing module displays waterfall, funnel, histogram, Pareto, and box and whisker charts read-only from saved values. It requires the EigenPal Pro License; some labels and layouts can differ. Treemap, sunburst, and map charts use saved fallbacks or show a placeholder.',
  },
  {
    id: 'images.smartart',
    name: 'DrawingML diagrams',
    category: 'images',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'community',
    docsLink: '/docs/2.x/pro/drawing',
    notes:
      'DrawingML diagrams display read-only from their saved drawing, including in PDF export. Diagrams without a saved drawing require the drawing module and EigenPal Pro License. Unsupported content shows a placeholder; changed diagram layouts do not recalculate.',
  },
  {
    id: 'images.ink',
    name: 'Ink annotations (w:ink)',
    category: 'images',
    editing: 'none',
    rendering: 'none',
    roundTrip: 'preserved',
    tier: 'community',
    notes: 'Ink annotations do not display and cannot be edited. Saving preserves their markup.',
  },

  // --- Page layout, headers & footers --------------------------------------
  {
    id: 'layout.pagination',
    name: 'True pagination (font-metric pages)',
    category: 'layout',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Page breaks, paragraph rules, fonts, and section settings determine pagination. You can insert manual page breaks and display their formatting marks. Manual page breaks inside table cells stay saved but do not start new pages.',
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
      'Set page size, orientation, and margins for one section or the whole document. Insert next-page or continuous section breaks. Existing odd-page and even-page breaks display, but you cannot insert them.',
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
      'Both adapters let you edit headers and footers, including tables, pictures, page numbers, and tracked changes. Set first-page variants or link a section to the previous section. Selection and comment highlights display only in the body.',
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
      'Insert text or picture watermarks across the whole document. Watermarks display in the editor and PDF export. Separate watermarks for individual sections are unavailable.',
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
      'Both adapters let you insert, edit, delete, and convert footnotes and endnotes. Notes continue across pages according to their placement and paragraph settings. The automation API edits existing notes but cannot create them; notes in headers and footers are unsupported.',
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
      'Existing sections display equal or unequal text columns, gaps, and separators. Continuous sections balance their final page unless older compatibility settings disable balancing. The editor has no column editing controls.',
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
      'Existing page borders display with their saved offsets and first-page settings. Art borders do not display. You cannot edit page borders from the interface.',
  },
  {
    id: 'layout.line-numbers',
    name: 'Line numbers (lnNumType)',
    category: 'layout',
    editing: 'none',
    rendering: 'none',
    roundTrip: 'full',
    tier: 'community',
    notes: 'Line number settings survive saving. Line numbers do not display in the margin.',
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
      'Both adapters let you edit separate first-page, even-page, and default headers and footers. Displayed page numbers determine which even or default variant appears. Opening an even variant enables different even and odd pages.',
  },
  {
    id: 'layout.vertical-align',
    name: 'Section vertical alignment (vAlign)',
    category: 'layout',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Supported sections align body text at the center or bottom, or distribute space between paragraphs. Pages with multiple sections, columns, notes, or floating content stay top-aligned. Justified pages with tables also stay top-aligned.',
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
      'Page background colors and images do not display and cannot be edited. Saving preserves their markup and relationships.',
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
      'Page fields use the saved section numbering start and format unless the field specifies another format. Total-page fields use decimal numbers unless the field specifies another format. The editor has no section numbering controls.',
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
      'Suggest and review text, formatting, and supported table edits with the EigenPal Pro License. Unsupported edits and some collaborative replacements are refused. Compare documents records differences as tracked changes outside collaboration.',
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
      'Accept or reject individual changes or filtered groups through the interface or API with the EigenPal Pro License. Hidden authors and unsupported changes remain pending. Opening and saving existing changes requires no review module.',
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
      'Add comments, replies, and resolutions with the EigenPal Pro License. Comments can target body text, headers, footers, and supported text boxes. Opening and saving existing comments requires no review module.',
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
      'Propose native tracked changes through the document API on a server or in an open editor. Read accepted or rejected text and target word ranges for edits. The automation object model requires the EigenPal Pro License.',
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
      'Existing tracked moves survive save and reopen. Display and review controls require the review module and the EigenPal Pro License. Direct creation of move revisions is unsupported.',
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
      'Set colors for inserted, deleted, merged, and split cells through viewer preferences. Existing cell revisions and tracked rows determine the shading. Creating arbitrary cell merge and split revisions is unsupported.',
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
      'Insert, edit, and remove links with the toolbar, context menu, or Ctrl+K and Cmd+K. Links open only after user action and permit http, https, mailto, tel, and ftp targets. Field-based links work but remain read-only in the link panel.',
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
      'Add, find, navigate to, and delete bookmarks through the interface or document API. Internal links move the caret to their bookmark. Protected bookmarks and bookmarks inside data-bound controls refuse changes.',
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
      'Page fields calculate page numbers and totals in the body, headers, and footers. Supported number formats follow section settings or field switches. Unsupported switches keep saved results, and wider calculated values do not move following text.',
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
      'Insert a table of contents and refresh its entries or page numbers from headings and entry fields. Generated entries provide read-only navigation links. Unsupported source switches prevent refresh, and suggesting mode prevents removal.',
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
      'REF and NOTEREF resolve supported bookmark text, paragraph numbers, and note numbers in the body and notes. Unsupported switches and targets keep saved results. Header, footer, and text-box references also keep saved results.',
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
      'AUTONUM, AUTONUMLGL, and AUTONUMOUT generate separate numbering sequences with supported number formats. They do not restart at headings, and unsupported switches produce no generated value. Saving preserves the source fields without adding results.',
    docsLink: '/docs/2.x/guides/fields',
  },
  {
    id: 'fields.listnum',
    name: 'LISTNUM field numbers',
    category: 'fields',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'LISTNUM fields calculate numbers from document lists in the main text. Level and start switches control the number. Fields in headers, footers, notes, and text boxes keep saved results.',
    docsLink: '/docs/2.x/guides/fields',
  },
  {
    id: 'fields.styleref',
    name: 'Style header references',
    category: 'fields',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'community',
    notes:
      'Header STYLEREF fields display text from supported character or paragraph styles by name. Unsupported switches and missing matches keep saved results. References in the body and footers also keep saved results.',
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
      'Most fields display saved results without recalculation; supported symbol and metadata fields display their values. You can enable editing for selected field results outside collaboration. The editor never executes macros or external field instructions.',
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
      'The editor preserves citation fields, bibliography fields, and their source data. It does not calculate or edit citations.',
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
      'Fill supported text, number, and date fields, toggle checkboxes, and select dropdown entries, including under forms protection. Unsupported formats and fields with complex results remain preserved without filling. Disabled fields, viewing mode, and suggesting mode restrict changes.',
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
      'Find, create, fill, and remove content controls through the interface or API. Control locks restrict edits, and data-bound text remains read-only. Supported value changes can become tracked changes, except in temporary controls or block controls with multiple paragraphs.',
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
      'The editor displays and preserves repeating sections. Adding or removing items and changing section settings are unsupported.',
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
      'Fill dropdown, checkbox, date, picture, and gallery controls through controls that validate each value. Gallery choices support self-contained document blocks, but external templates and blocks with external dependencies are unsupported. Tracked text and date control creation works outside collaboration.',
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
      'The editor preserves custom XML parts and data-binding markup when you save. It does not evaluate general custom XML bindings.',
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
      'The editor preserves breaks placed outside text runs without starting a line or page. Surrounding text remains visible and editable. Deleting text across these breaks keeps them.',
  },
  {
    id: 'structure.out-of-order-markup',
    name: 'Out-of-order and repeated markup',
    category: 'structure',
    editing: 'full',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'The editor recovers editable text from supported repeated or misplaced markup. Saving writes recovered content in schema order. Unsupported structures remain hidden and unchanged.',
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
      'The editor never executes macros. It preserves the vbaProject part when you open and save the document.',
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
      'The editor preserves embedded objects and shows supported inline preview pictures as read-only content. It never executes, loads, or updates embedded objects. Floating and linked objects show no preview, and clipboard operations refuse object content.',
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
      'Protection settings restrict editing, comments, or form filling according to the document mode. The editor cannot set or verify passwords, and permission exception ranges do not grant access. Remote collaboration updates bypass local protection checks.',
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
      'Yjs synchronizes supported document edits, participant cursors, and selections, with separate undo history for each participant. Offline edits merge after reconnection. Formatting can be lost when another participant moves the same text to another paragraph.',
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
      'Search body text, tables, headers, footers, notes, and saved field results. Find also searches text boxes outside notes; selecting a match selects the drawing. Search highlights stay local and do not appear in saved files.',
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
      'Scroll to paragraphs by ID without changing selection, focus, or undo history. Highlight body paragraphs, table cells, and block content controls. Text boxes and invalid or ambiguous references are unsupported.',
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
      'Rich paste restores supported formatting, tables, images, notes, equations, fields, and tracked changes from compatible clipboard content. Sections, headers, footers, and comments do not transfer. Paste outside the body uses plain text.',
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
      'Undo and redo restore edits and their selections. Typing groups end after a 1-second pause or 2 seconds of continuous input. Caret movement and other edits start separate steps, including during collaboration.',
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
      'Move an editor between same-origin windows without losing its document, selection, undo history, or collaboration session. Detached editors still save, run commands, and receive remote edits. Cross-origin windows are unsupported.',
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
      'Use @docx-editor.dev/i18n to translate editor controls into 14 languages. Arabic and Hebrew interfaces use right-to-left layouts. LocaleProvider also accepts an explicit direction for other languages.',
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
      'Automatic zoom fits the page width between 50% and 100%. Hosts can choose fixed zoom, uncapped width fitting, or smaller pages beside the review pane. Navigation and review panels adjust the available page width.',
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
      'Load server-generated DOCX updates without replacing the editor instance, with optional change highlights. Updates preserve scroll but reset selection and undo history. Local edits, stale results, and collaborative sessions prevent replacement; this API does not compare or merge files.',
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
      'Automate documents on a server or in an open editor with a documented subset of the Office.js document API. The automation object model requires the EigenPal Pro License. It includes no model integration, tool catalog, or MCP transport.',
    docsLink: '/docs/2.x/editor-api',
  },
];

/** Lookup by stable id; used by <FeatureBadge id="..."/>. */
export const wordFeatureById: Record<string, WordFeature> = Object.fromEntries(
  wordFeatures.map((f) => [f.id, f])
);
