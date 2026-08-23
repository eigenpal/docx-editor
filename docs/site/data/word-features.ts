/**
 * Word feature support matrix — single source of truth.
 *
 * Rendered on docx-editor.dev at /docs/2.x/word-fidelity via the site's
 * <FeatureMatrix> / <FeatureBadge> components (the site syncs this file at
 * build time, same pipeline as docs/site/content). The `tier` field exists
 * so the same data can later drive plan gating and pricing pages; today
 * everything ships in `community`.
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

export type FeatureTier = 'community' | 'premium';

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
  | 'collaboration';

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
  // --- Text & formatting -----------------------------------------------
  {
    id: 'text.basic-formatting',
    name: 'Bold, italic, underline, strikethrough',
    category: 'text',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
  },
  {
    id: 'text.sub-superscript',
    name: 'Subscript & superscript',
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
      'Register custom fonts with the fonts prop. The editor fetches your URLs and checks each hash. Theme fonts come from the OOXML theme. Word-accurate wrap and pagination need real font bytes, so the optional @docx-editor.dev/fonts package supplies metric-compatible substitutes for the Word defaults. The fonts prop also takes a resolver, so an app can load only the families a document declares.',
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
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes: 'Bidi layout with mirrored alignment; Hebrew locale ships in @docx-editor.dev/i18n.',
  },
  {
    id: 'text.effects',
    name: 'Text effects (outline, shadow, emboss, emphasis mark)',
    category: 'text',
    editing: 'none',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'w:outline, w:shadow, w:emboss, w:imprint, and w:em render and round-trip. You cannot set them from the toolbar. w14 glow and gradient text fill are not supported.',
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
      'The editor does not draw w:vanish runs and gives them no space, so pages break where Word breaks them. The text survives a round trip. There is no "show hidden text" option. A paragraph with a vanished mark still occupies a line.',
  },
  {
    id: 'text.math',
    name: 'Math equations (OMML)',
    category: 'text',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Equations round-trip verbatim as raw OMML and show a styled text fallback. Laid-out math and equation editing are not built yet.',
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
      'Symbol runs render and survive editing and save. You can insert a symbol from the Insert menu. Existing symbol run properties are not editable.',
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
      'Space before, space after, and line spacing (single, multiple, exactly, at least) all reach pagination. A 1.5-spaced or double-spaced document breaks pages where Word breaks them. The paragraph mark size counts in the last line metrics, like Word. Contextual spacing drops the gap between neighbours of the same style, and the Paragraph dialog sets it. Automatic spacing (w:beforeAutospacing, w:afterAutospacing) uses 14pt in body paragraphs and 0pt in list items and table cells.',
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
      'w:keepNext, w:keepLines, w:widowControl and w:pageBreakBefore all reach pagination, and the Paragraph dialog sets each of them. A value a style supplies reads through the cascade, so a checkbox shows what is in force rather than only what the paragraph authors itself.',
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
      'Left, right, first-line, and hanging indents all reach line geometry, so an indented first line starts where Word starts it. Increase Indent and Decrease Indent are on the toolbar, on Tab, and on Ctrl+M. Inside a list they change the level, so the marker changes too.',
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
      'The style picker applies document styles, including custom styles with their numbering and indents. Defining a new style in the UI is not supported yet.',
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
      "Existing tab stops render, with right and decimal tabs and dot, hyphen, and underscore leaders. Positional tabs (w:ptab) render too, so a contents line reads as one: entry left, leader dots between, page number right. The document's own w:defaultTabStop is honoured, in the body and in headers and footers. The Paragraph dialog sets, clears, and replaces tab stops, including clearing one that a style supplies. Bar tabs are preserved on save but aren't drawn or editable.",
  },
  {
    id: 'paragraphs.frames',
    name: 'Drop caps & text frames (framePr)',
    category: 'paragraphs',
    editing: 'none',
    rendering: 'none',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Parsed and round-tripped; text flows inline rather than as a drop cap or positioned frame.',
  },
  {
    id: 'paragraphs.hyphenation',
    name: 'Automatic hyphenation',
    category: 'paragraphs',
    editing: 'none',
    rendering: 'none',
    roundTrip: 'preserved',
    tier: 'community',
    notes: 'Document hyphenation settings round-trip; the layout engine does not hyphenate.',
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
      'The toolbar toggle creates the numbering definition on first use, so a document that never carried a list can start one. It also applies the List Paragraph style, the way Word does, which is what closes the space between consecutive items. Tab and the indent buttons change the level, and the marker changes with it.',
  },
  {
    id: 'lists.numbered',
    name: 'Numbered lists (decimal, roman, letters)',
    category: 'lists',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
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
    rendering: 'none',
    roundTrip: 'preserved',
    tier: 'community',
    notes:
      'Not rendered and not editable. The numPicBullet definition and its markup are preserved on save.',
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
      'Hover controls insert a row or column. Drag a divider or the outer right edge to resize. The context menu adds seven structural actions. Both adapters ship the same table chrome. Tables stay read-only in the automation object model.',
  },
  {
    id: 'tables.borders-shading',
    name: 'Cell borders & shading',
    category: 'tables',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Both adapters expose contextual toolbar controls that set borders and fill on the selected cells. Authored table and cell borders and table-style shading render and round-trip.',
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
      'Authored merges render and round-trip. The merge and split commands are declared but refused. Column insert, delete, and resize on a merged table report the engine reason.',
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
      'Rows split mid-content with correct cut borders. Vertically merged cells repaint on continuation pages, like Word.',
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
      'Table styles resolve through their basedOn chain. Borders, cell margins, shading, and conditional paragraph and run formatting come from styles.xml, so a header row comes out bold and centred. w:tblLook gates which conditional formats apply, and an explicit w:cnfStyle wins. Conditional cell margins and a table-style picker are not built yet.',
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
      'An anchored table lands where Word puts it across the page: tblpXSpec or tblpX against the text, margin, or page box, plus a tblpY offset from the text anchor. Text does not wrap beside it yet. Page-anchored and margin-anchored vertical positions keep their place in the flow.',
  },
  {
    id: 'tables.text-direction',
    name: 'Vertical cell text (textDirection)',
    category: 'tables',
    editing: 'none',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'tbRl and btLr cell text renders through writing-mode and round-trips. You cannot set it from the UI.',
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
      'The engine lays out and paints embedded PNG, JPEG, and GIF at the authored size. Both adapters ship insert and overlay authoring: toolbar, properties dialog, and keyboard resize through the shared engine commands.',
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
      'Nine wrap modes, exclusion reflow, z-order, and drag and resize in both adapters. Both share setImageWrapType and toolbarCommandState.',
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
    name: 'Tracked image insert/delete',
    category: 'images',
    editing: 'none',
    rendering: 'preserved',
    roundTrip: 'preserved',
    tier: 'community',
    notes:
      'Revision wrappers are preserved inertly. Accept, reject, and suggesting-mode delete are not built for images yet.',
  },
  {
    id: 'images.textboxes',
    name: 'Text boxes',
    category: 'images',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'community',
    docsLink: '/docs/2.x/guides/images',
    notes:
      'Anchored text boxes render their content clipped inside the authored extent. This works in the body, in headers, and in footers, including page-relative anchors. PAGE, NUMPAGES, and SECTIONPAGES fields inside a header or footer text box are evaluated per page. The content is read-only. Inline text boxes, linked chains, autofit, and rotation render as a placeholder or clip.',
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
      'Charts, groups, canvases, and custom geometry reserve their extent with a placeholder. Unsupported payloads stay generic in the canonical tree.',
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
      'Transparency, brightness, contrast, and grayscale project where supported. Authored adjustment markup is preserved on save.',
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
      'The layout engine paginates like Word: page breaks, keep rules, and paragraphs split across pages. You can insert a hard page break, which writes `w:br w:type="page"`.',
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
      'Page size, orientation, and margins are editable per section or for the whole document, from the Page Setup dialog or a ruler drag. Each section paginates against its own geometry, so a mixed portrait and landscape document renders as Word shows it. You can insert a section break. Even and odd page break parity and per-section columns are not modelled yet.',
  },
  {
    id: 'layout.headers-footers',
    name: 'Headers & footers (edit in place)',
    category: 'layout',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Both adapters have scoped header and footer editing: enter and exit the story, create and remove it, link and unlink to the previous section, and set the title-page and even/odd options. They also insert PAGE, NUMPAGES, and SECTIONPAGES. `editHeaderFooter` takes `variant`, `evenPage`, and `firstPage` on the shared Editor contract. Per-section first, even, and default variants paint like Word. Tracked changes, watermark authoring, and structural table edits inside furniture are not supported.',
    docsLink: '/docs/2.x/guides/headers-footers',
  },
  {
    id: 'layout.watermarks',
    name: 'Watermarks (text & image)',
    category: 'layout',
    editing: 'none',
    rendering: 'planned',
    roundTrip: 'preserved',
    tier: 'community',
    notes:
      'Watermarks live as VML or drawings inside header parts. Layout and editing are deferred to the drawings work, and Editor.getWatermark() is a stub. The markup can survive in the header part, but watermarks are not a supported feature yet.',
    docsLink: '/docs/2.x/guides/headers-footers',
  },
  {
    id: 'layout.footnotes',
    name: 'Footnotes & endnotes',
    category: 'layout',
    editing: 'partial',
    rendering: 'partial',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Both adapters have a typed note model, note layout (pageBottom, beneathText, sectEnd, docEnd), scoped note editing, insert, delete, convert, and chrome slots. Tracked note inserts and notes in headers and footers are out of scope.',
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
      "Section w:cols count, gap, separator, and equal or unequal widths paginate into columns. An explicit column break leaves the break paragraph's empty remainder at the top of the next column. Continuous multi-column sections balance. Column editing chrome is not exposed.",
  },
  {
    id: 'layout.page-borders',
    name: 'Page borders',
    category: 'layout',
    editing: 'none',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Page borders render with z-order, offset modes, and first-page filters. You cannot edit them from the UI.',
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
      'Section numbering start, format, chapter style, and chapter separator parse and serialize. PAGE fields in headers and footers honour the authored start and format, for example lowerRoman. NUMPAGES and SECTIONPAGES stay decimal. There is no authoring UI for pgNumType yet.',
  },

  // --- Review ---------------------------------------------------------------
  {
    id: 'review.tracked-changes',
    name: 'Tracked changes (insert, delete, format)',
    category: 'review',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'A full revision model, including structural changes to paragraph breaks, paragraph properties, and table rows and cells. A change to a paragraph mark draws a pilcrow and a change bar wherever the paragraph is, table cells included, and a mark that one author inserted and another proposed removing carries both decisions. A tracked insert or delete around a field result paints as tracked, not as ordinary text. Attribution is drawn in All Markup only, as in Word. The resolved views drop the attribution and merge the paragraphs the decision merges, so No Markup shows the document as accepting every change would leave it. Painted markup follows Word’s by-author view by default — one color per author, matched by the review cards — and named authors can take a color, a background, class names, and an avatar of their own. The output opens cleanly in Word’s review pane.',
    docsLink: '/docs/2.x/pro/tracked-changes',
  },
  {
    id: 'review.accept-reject',
    name: 'Accept / reject changes (UI + API)',
    category: 'review',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Accept or reject one change in the sidebar, or through acceptReviewItem and rejectReviewItem. The automation object model adds revision.accept(), revision.reject(), revisions.acceptAll(), and revisions.rejectAll(). The sidebar has no bulk control, so call the per-item command for every item.',
    docsLink: '/docs/2.x/pro/tracked-changes',
  },
  {
    id: 'review.comments',
    name: 'Comments (threads, replies, resolve)',
    category: 'review',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Threaded comments with replies and resolve/reopen in the review rail. React hosts use `@docx-editor.dev/pro/react`; Vue hosts use `@docx-editor.dev/pro/vue` with the same engine commands.',
    docsLink: '/docs/2.x/pro/comments',
  },
  {
    id: 'review.ai-redlining',
    name: 'Programmatic redlining (code-proposed tracked changes)',
    category: 'review',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'The automation object model writes Word-native tracked changes. It works over DOCX bytes on a server, or over an editor open in a page.',
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
    notes: 'Imported moves render distinctly from insert and delete, and they round-trip.',
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
      'Insert, edit, and remove a link with Ctrl+K, Cmd+K, or the toolbar. Targets are allowlisted: http, https, mailto, tel, and ftp. Any other target renders inert and still round-trips. A HYPERLINK field, complex or w:fldSimple, is a live link too: its target passes the same allowlist, and the link panel shows it read-only. Links in footnote and endnote text work the same way. Opening a document never requests a link target, because activation needs an explicit gesture.',
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
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'PAGE, NUMPAGES, and SECTIONPAGES project as a complex field or w:fldSimple. They evaluate in headers and footers and in the body flow, body tables included. PAGE respects the section pgNumType start and format. Fields inside an anchored header or footer text box also project, as does a page field nested inside another field — simple or complex, such as STYLEREF — up to four levels deep, evaluated per page. React header and footer chrome can insert them, including Page X of Y. A body field paints a placeholder that document layout substitutes per page. A multi-digit body value keeps the one-digit measured width, so mid-line following text does not reflow.',
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
      'Insert a body TOC from the shared Insert menu, then refresh it from the document headings. A refresh can update the page numbers only. Tab leaders, section-formatted page numbers, and bookmark links all work. The generated rows are read-only navigation links.',
  },
  {
    id: 'fields.other-codes',
    name: 'Other field codes (DATE, REF, MERGEFIELD...)',
    category: 'fields',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'community',
    notes:
      'The last computed result displays for a complex field and for w:fldSimple, and the field codes round-trip untouched. SYMBOL renders its character from the instruction, with the \\f font and \\s size honored. MACROBUTTON and GOTOBUTTON render their display text; the macro never runs and the jump never fires. A field code under a tracked edit still renders: w:delInstrText is read when no live instruction remains. Painted results carry Word-like grey field shading. A legacy form field always shades unless w:doNotShadeFormData is set; other fields follow the fieldShading option (never, when-selected, always). The editor never executes a field instruction. TITLE, AUTHOR, SUBJECT, KEYWORDS, LASTSAVEDBY, COMMENTS, and DOCPROPERTY for those names render from the document metadata in docProps, capped and sanitized. DATE-valued properties stay inert. DATE, TIME, and FILENAME are not evaluated. REF and SEQ display only their cached result; AUTONUM, LISTNUM, and EQ are not evaluated.',
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
      'FORMTEXT result text is editable inline, with an accurate caret and selection. FORMCHECKBOX renders its checked or default state from w:ffData, and an explicit w:size sets the glyph size. FORMDROPDOWN renders the cached result, or the selected list entry when the file caches none. Field markers, instructions, and w:ffData round-trip, and tracked edits survive. Form-field shading applies unless w:doNotShadeFormData is set. Checkbox and dropdown interaction, Tab navigation, ffData constraints, and forms-protection fill mode are not built.',
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
      'Block, inline, row, and cell controls are typed and addressable in every story, table cells, headers, footers, and note bodies included. A control around a row or cell lays out as that row or cell, and keeps its column, span, and row semantics. Find, create, fill, and remove a control by tag, title, or file id from the document object model. Content is editable, and tag, title, and lock are writable through the API, but they have no toolbar chrome. All four `w:lock` modes are enforced against what an edit would change, and an enclosing lock wins over an inner one. The editor resolves a write against every control it would land in, so filling an outer control cannot write into a locked or bound control nested at its edge. A lock protects the control and its content, not the rest of the document. Under `w:documentProtection w:edit="forms"` only control content is editable. Picture, repeating-section, custom-XML-bound, and docPart gallery controls are preserved as authored rather than typed; the editor refuses an edit inside a bound control, but it allows you to remove the control.',
    docsLink: '/docs/2.x/guides/content-controls',
  },
  {
    id: 'structure.repeating-sections',
    name: 'Repeating section controls',
    category: 'structure',
    editing: 'partial',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Add and remove items in the editor. The section configuration itself is read-only. The document object model does not type a repeating section as a content control, so a script reaches the controls inside it instead.',
    docsLink: '/docs/2.x/guides/content-controls',
  },
  {
    id: 'structure.typed-controls',
    name: 'Dropdown, checkbox & date controls',
    category: 'structure',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Each control accepts only the value its own type allows. A dropdown must name an item it declares, and a combo box also takes free text. A date validates an ISO instant and writes both `w:fullDate` and the formatted text. A checkbox writes its declared glyph and its state together. The first write replaces a literal prompt whole, so clearing the value later leaves the control empty. A `w:temporary` control removes its own wrapper on the first edit and keeps the content.',
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
    rendering: 'none',
    roundTrip: 'preserved',
    tier: 'community',
    notes:
      'The editor never executes or renders OLE. OLE markup and embedded binaries are preserved through editing and save.',
  },
  {
    id: 'structure.protection',
    name: 'Document protection & editing restrictions',
    category: 'structure',
    editing: 'partial',
    rendering: 'none',
    roundTrip: 'preserved',
    tier: 'community',
    notes:
      'Protection settings round-trip. Forms protection is enforced: only addressed control content stays editable, and the rest of the document is read-only. Other protection modes are not enforced, and inline permission ranges may be dropped.',
  },

  // --- Collaboration, i18n & editing UX ---------------------------------------
  {
    id: 'collab.realtime',
    name: 'Realtime collaboration (Yjs)',
    category: 'collaboration',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes: 'Live cursors, presence, comment sync, per-author tracked-change attribution.',
  },
  {
    id: 'collab.find-replace',
    name: 'Find & replace',
    category: 'collaboration',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
  },
  {
    id: 'collab.clipboard',
    name: 'Rich copy/paste (HTML clipboard)',
    category: 'collaboration',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
  },
  {
    id: 'collab.undo-redo',
    name: 'Undo / redo',
    category: 'collaboration',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
  },
  {
    id: 'collab.i18n',
    name: 'Editor UI in 9 languages',
    category: 'collaboration',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes: 'en, de, fr, he, hi, pl, pt-BR, tr, zh-CN via @docx-editor.dev/i18n.',
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
      "The default zoom mode is `auto`: it fits the page width between 50% and 100%. A container narrower than a Letter sheet shrinks the document instead of overflowing. Chrome that pads the scroll container, such as the navigation pane or the review rail, recomputes the fit. A host can pin a fixed scale with `zoom` or `zoomMode={{ type: 'fixed' }}`, or ask for uncapped fit-width. The toolbar ladder and the Ctrl+= and Cmd+= shortcuts use the same engine-owned mode.",
  },
  {
    id: 'collab.agent-tools',
    name: 'Document automation object model',
    category: 'collaboration',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'A batching object model shaped after a documented subset of the Word JavaScript API. The server entry works over bytes, and the browser entry works over an open editor. It ships no model integration, tool catalog, or MCP transport.',
    docsLink: '/docs/2.x/editor-api',
  },
];

/** Lookup by stable id; used by <FeatureBadge id="..."/>. */
export const wordFeatureById: Record<string, WordFeature> = Object.fromEntries(
  wordFeatures.map((f) => [f.id, f])
);
