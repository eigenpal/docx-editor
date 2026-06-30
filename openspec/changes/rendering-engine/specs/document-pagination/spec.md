## Requirements

### OOXML and CSS units

The renderer SHALL use 1440 twips per inch, 20 twips per point, and 914400 EMU per inch. On-screen output SHALL use 96 CSS pixels per inch before zoom.

### Paragraph layout

Paragraphs SHALL wrap using resolved OOXML fonts, sizes, indentation, tabs, spacing, and line-spacing rules. Empty paragraphs SHALL retain a visible line height. Floating drawings SHALL reduce the usable line width in the bands they overlap.

### Sections and pages

Page dimensions, margins, columns, orientation, and section starts SHALL follow `w:sectPr`. Header and footer content SHALL occupy their authored bands and SHALL push body content only when those bands exceed the available margin space. Exact-fit content SHALL NOT create a trailing blank page.

### Break behavior

The renderer SHALL honor `w:pageBreakBefore`, page breaks in runs, `w:keepNext`, `w:keepLines`, widow/orphan behavior, and contextual paragraph spacing. A paragraph crossing a page boundary SHALL split on line boundaries while retaining its document-position ranges.

### Tables

Tables SHALL continue across pages according to `w:cantSplit`, `w:tblHeader`, and `w:vMerge`. Oversized rows MAY continue at whole-line boundaries. Continuation pages SHALL retain visible table boundaries.

### Footnotes and columns

Footnote bodies SHALL appear on the page carrying their references, reserve body space, and continue when necessary. Multi-column sections SHALL fill columns in OOXML order and use their declared widths and gaps.

### Drawings and text boxes

Inline drawings SHALL participate in text flow. Anchored drawings and text boxes SHALL use their OOXML positioning and wrapping properties without incorrectly advancing body content.

### Supported package surface

The core package SHALL expose rendered documents, pages, CSS-pixel boxes, caret lookup, and selection rectangles through one stable API entry. Internal conversion, measurement, page-flow, and paint details SHALL NOT be supported package subpaths or appear in that entry's declarations.
