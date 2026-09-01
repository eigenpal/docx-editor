# DOCX to Markdown demo

A standalone browser demo for the private `@docx-editor.dev/docx-to-markdown` package. It keeps the
editable, Word-style paginated document on the left and renders the exporter's real `pages[]` result
on the right.

```bash
bun dev:markdown
```

Open <http://localhost:5177>. Upload or drag in a `.docx`, edit it, and pause briefly to refresh the
Markdown. Preview mode renders GitHub-flavored Markdown, including tables and task lists; Source mode
shows the exact Markdown for each page's body, header, and footer.

The preview uses `react-markdown`, `remark-gfm`, `rehype-raw`, and `rehype-sanitize`. It does not
implement a Markdown parser. Because GFM cannot represent a table inside another table, the exporter
uses narrowly scoped inline HTML for nested tables; the demo's sanitizer admits only those known
span classes and ARIA roles.

The demo uses the same font ordering as production export: packaged metric-compatible faces first,
then the opt-in Google Fonts resolver for families declared by the current document. Both the editor
and exporter receive the same on-demand origins. Proprietary families absent from the DOCX, packaged
set, and pinned Google catalog remain reported as unresolved rather than receiving an invented
metric substitute. Raw file-derived HTML is never trusted; generated inline HTML is parsed and
sanitized before rendering.
