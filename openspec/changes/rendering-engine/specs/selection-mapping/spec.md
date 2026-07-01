## Requirements

### Painted position anchors

Painted text and block DOM SHALL carry half-open document-position ranges using `data-doc-from` and `data-doc-to`. Body, header, and footer lookups SHALL be scoped to their independent editing regions.

### Pointer placement

A pointer over painted content SHALL resolve to the nearest document character boundary. Clicks beyond a short line or below the last line SHALL fall back to the nearest valid position. Table-cell placement SHALL remain correct when a table continues onto another page.

### Caret geometry

A document position SHALL map to a zero-width CSS-pixel caret box. Its height SHALL follow the run at that position, including mixed-size text and empty paragraphs. Geometry SHALL remain stable while a virtualized page is waiting to repaint.

### Selection rectangles

A non-collapsed range SHALL produce one or more clipped boxes for every painted line it covers. Cross-page ranges SHALL return boxes associated with each page. Coordinates SHALL be local to the pages host and scale linearly with zoom.

### Editing regions and IME

Only one body, header, or footer editing region SHALL own focus at a time. During IME composition, the visible caret SHALL remain at the last committed geometry until composition ends. Moving from a header or footer back to the body SHALL not drop the next keystroke.
