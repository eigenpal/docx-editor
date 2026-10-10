# Paste from Google Docs Formatting Preservation

## Problem

When pasting content from Google Docs, multiple formatting attributes are lost:

1. **Text alignment** — Google Docs sends alignment as inline `text-align` CSS on `<p>` elements. Centered, right-aligned, and justified text all paste as left-aligned.

2. **Line spacing and indentation** — Google Docs uses inline CSS `lineHeight`, `marginLeft`, `marginTop`, `marginBottom` on `<p>` elements. Line spacing (single, 1.5, double) and paragraph indentation are lost.

3. **Heading levels** — Google Docs converts most headings to `<p>` tags with inline `font-size`/`font-weight` instead of semantic `<h1>`-`<h6>`. Only H2 may be preserved as it uses a real `<h2>` tag.

4. **Table cell styles** — table cell background colors, borders, padding, and vertical alignment are sent as inline CSS on `<td>` elements but not extracted during paste parsing.

## Scope

- Extract text-align from pasted `<p>` elements
- Extract line spacing from `lineHeight` CSS
- Extract indentation from `marginLeft` CSS
- Detect heading levels from font-size/font-weight patterns
- Extract table cell styling from inline CSS

## Out of scope

- Paste from Word (uses different clipboard format)
- Paste from other editors
- Image paste handling
