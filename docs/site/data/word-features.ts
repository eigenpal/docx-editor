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
      'Custom fonts registered via the fonts prop (loadFonts fetches and hash-verifies app-specified URLs); theme fonts resolved from the OOXML theme. Word-accurate wrap and pagination need font bytes for shaped measurement — the optional @docx-editor.dev/fonts package supplies metric-compatible substitutes for the Word defaults (Carlito, Caladea, Liberation). The fonts prop also accepts a resolver called once per load with the families a document declares, so an app can opt into loading only those; googleFonts() serves them from a pinned, hash-checked catalog.',
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
      'Fonts embedded in the file (word/fonts) are de-obfuscated and wired into shaped text measurement automatically on load — no configuration or network. The embedded binaries round-trip on save; the editor does not add new embedded fonts.',
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
      'w:outline, w:shadow, w:emboss, w:imprint and w:em render and round-trip; not settable from the toolbar. w14 glow and gradient text fill are not supported.',
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
      'w:vanish runs are not drawn and take no space, so pages break where Word breaks them; the text survives a round trip. There is no "show hidden text" view option, and a paragraph whose MARK is vanished still occupies a line.',
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
      'Equations round-trip verbatim (raw OMML) and show a styled text fallback. Laid-out math and equation editing are not built yet.',
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
      'Symbol runs render and survive ProseMirror edits and save. Symbols can be inserted from the Insert menu, but existing symbol-run properties are not directly editable.',
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
      'Space before/after and line spacing (single, multiple, exactly, at least) all reach pagination, so a 1.5- or double-spaced document breaks pages where Word breaks them. Font external leading is excluded from line boxes, and trailing auto-spacing may cross the bottom text margin when the glyphs fit, matching Word’s vertical pagination. The paragraph mark’s w:sz participates in the last line’s metrics, matching Word when a cover-page mark is taller than the visible runs. Contextual spacing drops the gap between same-style neighbours, the way Word’s List Paragraph style intends. Automatic spacing (w:beforeAutospacing / w:afterAutospacing) replaces the authored measurement with 14pt in body paragraphs and 0pt in list items and table cells.',
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
      'Left, right, first-line and hanging indents all reach line geometry, so an indented first line starts where Word starts it and wraps with the room it actually has. Increase/Decrease Indent is on the toolbar and on Tab / Ctrl+M; inside a list it changes the level, so the marker changes with it.',
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
      'Style picker applies document styles, including custom styles with their numbering and indents. Defining new styles in the UI is not supported yet.',
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
      'Paragraph shading (w:shd) is editable. Borders render common ST_Border line styles (single, double, dashed, dotted, and CSS approximations for thick/3-D/inset/outset); decorative art borders paint as a solid rule. Thin doubles inflate to a visible compound band in layout, matching table borders. Borders round-trip but cannot be added, changed or removed from the editor yet.',
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
      "Existing tab stops render, including right/decimal tabs and dot, hyphen and underscore leaders. Positional tabs (w:ptab) render too, so a table-of-contents line reads as one: entry left, leader dots between, page number flush right. The document's own w:defaultTabStop is honoured, so a metric-locale grid lands where Word puts it, in headers and footers as well as the body. A tab-stop editing UI is not built yet.",
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
      'Toolbar toggle creates the definition on first use, numbering.xml included, so a document that has never carried a list can start one. Tab and the indent buttons change the level, and the marker changes with it.',
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
      'Not rendered or editable; the numPicBullet definition and its authored markup are preserved on save.',
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
      'Core store and React paginated editor: hover row/column insertion, adjacent divider and outer-right resize, and seven table context-menu structural actions. Vue toolbar and context-menu value UI remain deferred; Vue inherits shared command types only. Tables remain read-only in the automation object model.',
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
      'Selected-cell borders and fill through React contextual toolbar controls (allowlisted styles, nullable clear fill). Vue value chrome deferred. Existing table/cell borders and table-style shading still render and round-trip.',
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
      'Authored merges render and round-trip. Merge and split commands are declared but refused; column insert/delete/resize on merged tables shows the engine reason.',
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
      'Rows split mid-content with correct cut borders; vertically merged cells repaint on continuation pages like Word.',
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
      'Innermost nested table owns resize furniture, structural edits, and selected-cell borders/fill in the React editor; outer tables stay isolated through save/reopen. Vue table chrome deferred.',
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
      'Table styles resolve through their basedOn chain: borders, cell margins, shading and the paragraph/run formatting a conditional format carries (so a header row comes out bold and centred) all come from styles.xml, gated by w:tblLook, with an explicit w:cnfStyle taking precedence. Conditional cell margins and switching table styles from the UI are not built yet.',
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
      'An anchored table lands where Word puts it across the page: tblpXSpec/tblpX against the text, margin or page box, plus a tblpY offset from the text anchor. Text does not yet wrap beside it, and page- or margin-anchored vertical positions keep their place in the flow.',
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
      'tbRl/btLr cell text renders via writing-mode and round-trips; not settable from the UI.',
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
      'Engine layout and paint for embedded PNG/JPEG/GIF at authored wp:extent; React insert/overlay authoring (toolbar, properties, keyboard resize). Vue authoring UI deferred to vue-drawing-authoring-parity — shared engine commands only.',
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
      'Nine wrap choices, exclusion reflow, z-order, and anchored drag/resize in React. Vue wrap/alt/properties chrome deferred; engine setImageWrapType and toolbarCommandState are shared.',
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
      'Decoded natively by the browser and painted at the authored size, like PNG or JPEG. BMP covers what older documents carry (including top-down bitmaps and the 12-byte BITMAPCOREHEADER); WebP covers lossy, lossless and extended containers. Inserting a new one is not supported yet.',
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
      'Embedded SVG paints at the authored size. Rendered in the browser secure static mode, so scripts and external references inside the file stay inert. Inserting a new SVG is not supported yet.',
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
      'Rasterized in the browser and painted at the authored extent. A metafile that will not convert keeps its extent and a labelled placeholder. Original bytes round-trip untouched.',
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
      'Baseline TIFF is decoded in the browser and painted at the authored extent; the first page of a multi-page file is used. A flavour that will not decode keeps its extent and a labelled placeholder. Inserting a new TIFF is not supported yet.',
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
      'Revision wrappers preserved inertly; accept/reject and suggesting-mode delete owned by typed-revisions-and-comments.',
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
      'Anchored text boxes render their story content clipped inside the extent — in the body, headers, and footers, including page-relative anchors — with PAGE / NUMPAGES / SECTIONPAGES fields inside header/footer text boxes evaluated per page. Read-only: inner stories are not editable. Inline text boxes, linked chains, autofit, and rotation still render as placeholders or clip.',
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
      'Charts, groups, canvases, and custom geometry reserve extent with placeholders; unsupported payloads stay generic in the canonical tree.',
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
      'Crop renders and round-trips; React properties dialog edits crop in UI percent. Vue deferred.',
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
      'Transparency, brightness, contrast and grayscale project where supported; authored adjustment markup is preserved on save.',
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
      'Not painted or editable; authored effect markup and effectExtent spacing are preserved.',
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
      'Extent reserved with labelled placeholder; chart payload preserved generically, not semantically edited.',
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
    notes: 'Same placeholder policy as charts; payload preserved inertly.',
  },
  {
    id: 'images.ink',
    name: 'Ink annotations (w:ink)',
    category: 'images',
    editing: 'none',
    rendering: 'none',
    roundTrip: 'preserved',
    tier: 'community',
    notes: 'Not rendered or editable; ink markup is preserved generically on save.',
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
      'The layout engine paginates like Word: page breaks, keep rules, split paragraphs marked across pages. Hard page breaks are insertable and write `w:br w:type="page"`.',
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
      'Page size, orientation and margins editable per section or whole document (Page Setup dialog, ruler drags); each section paginates against its own geometry, so mixed portrait/landscape documents render as Word shows them. Section breaks insertable. Even/odd-page break parity (the blank page Word inserts to reach the right parity) and per-section columns are not modelled yet.',
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
      'React: typed scoped header/footer editing (enter/exit story, create/remove, link/unlink to previous, title-page and even/odd options) with PAGE/NUMPAGES/SECTIONPAGES insert chrome. `editHeaderFooter` accepts `variant` / `evenPage` / `firstPage` on the shared Editor contract. Per-section first/even/default variants paint like Word. Vue chrome deferred; Vue can still call the shared commands. Tracked changes, watermark/drawing authoring, and structural table ops inside furniture are not claimed.',
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
      'Watermarks live as VML/drawings inside header parts. Typing, layout, and editing are deferred to the drawings lane; Editor.getWatermark() is a stub. Structural markup may survive in the header part but is not a supported watermark feature.',
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
      'React: typed note model, layout (pageBottom/beneathText/sectEnd/docEnd), scoped note editing, insert/delete/convert, chrome slots. Vue deferred. Tracked note inserts and notes-in-HF layout out of scope.',
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
      "Section w:cols count, gap, separator and equal/unequal widths paginate into columns; explicit column breaks leave the break paragraph's empty remainder at the top of the next column. Balancing continuous multi-column sections is supported. Column editing chrome is not exposed.",
  },
  {
    id: 'layout.page-borders',
    name: 'Page borders',
    category: 'layout',
    editing: 'none',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes: 'Render with z-order, offset modes and first-page filters; not editable from the UI.',
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
      "First, even, and default variants are selected by the page's number in the document (so the alternation carries across section breaks) and editable in an open furniture scope. Programmatic `editHeaderFooter({ variant: 'even' })` (or `evenPage: true`) creates/opens the even story and enables `w:evenAndOddHeaders` in one undo unit. React header/footer chrome can toggle different even and odd pages; Vue chrome deferred.",
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
    notes: 'Not rendered or editable; authored background markup and relationships are preserved.',
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
      'Section numbering start, format, chapter style, and chapter separator parse and serialize. Allowlisted PAGE fields in headers/footers honour authored start and fmt (e.g. lowerRoman); NUMPAGES/SECTIONPAGES stay decimal. There is no pgNumType authoring UI yet.',
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
      'Full revision model incl. structural changes (paragraph breaks, paragraph props, table rows/cells). Tracked insertions and deletions around a field result (cross-reference, page number, form field) paint as tracked, not as ordinary text. Opens cleanly in Word’s review pane.',
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
      'Per-change accept/reject in the sidebar and through acceptReviewItem/rejectReviewItem, plus revision.accept()/reject() and whole-document revisions.acceptAll()/rejectAll() through the automation object model. The sidebar itself offers no bulk control: resolve the queue with the per-item call over every item.',
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
      'Word-native tracked changes written through the automation object model, against DOCX bytes on a server or an editor open in a page.',
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
    notes: 'Imported moves render distinctly from insert/delete and round-trip.',
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
      'Insert, edit and remove with Ctrl/Cmd+K or the toolbar. Targets are allowlisted ' +
      '(http(s), mailto, tel, ftp); anything else renders inert and still round-trips. ' +
      'Opening a document never requests a link target — activation is an explicit gesture.',
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
      'Internal links jump to their bookmark and move the caret, including targets on ' +
      'pages that have not been painted yet. Creating and renaming bookmarks is deferred.',
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
      'Allowlisted PAGE, NUMPAGES, and SECTIONPAGES (complex or w:fldSimple) project in headers/footers at layout time (PAGE respects section pgNumType start/fmt), including fields hosted inside anchored header/footer text boxes and allowlisted page fields nested inside a non-page simple field such as STYLEREF. Insertable from React header/footer chrome (including Page X of Y). Other field instructions stay inert; body field evaluation is deferred.',
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
      'Body TOCs can be inserted from the shared Insert menu and refreshed from document headings, including page-numbers-only updates, tab leaders, section-formatted page numbers, and bookmark links. Generated rows are read-only navigation links.',
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
      'Last-computed field results display for complex fields and w:fldSimple; the field codes themselves round-trip untouched. Painted results carry Word-like grey field shading (always for legacy form fields unless w:doNotShadeFormData; otherwise per the fieldShading option: never / when-selected / always). Field instructions are never executed.',
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
      'CITATION/BIBLIOGRAPHY fields remain inert and the b:Sources store is preserved; citation evaluation and editing are not supported.',
  },
  {
    id: 'fields.legacy-forms',
    name: 'Legacy form fields (FORMTEXT, FORMCHECKBOX, FORMDROPDOWN)',
    category: 'fields',
    editing: 'none',
    rendering: 'partial',
    roundTrip: 'preserved',
    tier: 'community',
    notes:
      'The field result shows as static text with Word-like form-field shading unless the document sets w:doNotShadeFormData; w:ffData, including checkbox state and constraints, is preserved but the control is not interactive.',
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
      'Block, inline, row and cell controls are typed and addressable in every story (table cells, headers, footers and note bodies included); a control around a table row or cell lays out as that row or cell, keeping its grid column, span and row semantics. Discover, create, fill and remove them by tag, title or file id from the document object model; content is editable, and tag, title and lock are writable through the API but have no toolbar chrome. All four `w:lock` modes are enforced against what an edit would actually change — including the characters inside an inline control, a tracked-change decision, and a hyperlink write — an enclosing control’s lock wins over an inner one, and text typed at a control’s leading edge counts as inside it, because that is where Word puts it. A write addressed at one control is resolved against every control it would actually land in, so filling in an outer control cannot put text inside a locked or bound control nested at its edge — including an empty paragraph such a control holds, where the write has to create the run it lands in. Replacing a control’s whole value, or deleting a control together with its content, is refused when it would destroy a locked or bound control nested inside it; removing the wrapper while keeping the content leaves those controls untouched and is allowed. A control’s lock protects the control and its content, not the document: page setup, section furniture and note numbering stay editable beside a locked field. Under `w:documentProtection w:edit="forms"` only control content is editable, resolved from what an edit addresses — so an inline field can be filled in while the sentence around it stays read-only. Picture and repeating-section controls, custom-XML-bound controls and docPart galleries are preserved as they were rather than typed; every edit inside a bound control is refused instead of desynchronising it from its part, while removing the control is allowed and takes the binding with it.',
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
      'Add and remove items from the editor; the section configuration itself is read-only. A repeating section is not typed as a content control in the document object model — it is preserved as authored, so a script reaches the controls inside it rather than the section itself.',
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
      'Each control takes the value its own type accepts: a dropdown must name an item it declares, a combo box also takes free text, a date validates an ISO instant and writes both `w:fullDate` and the formatted text, and a checkbox writes its declared glyph and state together. A literal prompt is replaced whole on the first write; without a durable prompt source, clearing the value later leaves the control empty. A `w:temporary` control removes its own wrapper on the first edit and leaves the content.',
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
      'customXml parts and w:dataBinding round-trip with structural fidelity; no binding evaluation.',
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
      'Never executed, by design (client-side security); the vbaProject part survives open -> save.',
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
      'Never executed or rendered; OLE markup and embedded binary payloads are preserved through editing and save.',
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
      'Protection settings round-trip. Forms protection is enforced: only addressed content-control content remains editable, while the surrounding document stays read-only. Other protection modes are not enforced, and inline permission ranges may be dropped.',
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
    id: 'collab.agent-tools',
    name: 'Document automation object model',
    category: 'collaboration',
    editing: 'full',
    rendering: 'full',
    roundTrip: 'full',
    tier: 'community',
    notes:
      'Batching object model shaped after a documented subset of the Word JavaScript API; server entry over bytes, browser entry over an open editor. No model integration, tool catalog or MCP transport ships with it.',
    docsLink: '/docs/2.x/editor-api',
  },
];

/** Lookup by stable id; used by <FeatureBadge id="..."/>. */
export const wordFeatureById: Record<string, WordFeature> = Object.fromEntries(
  wordFeatures.map((f) => [f.id, f])
);
