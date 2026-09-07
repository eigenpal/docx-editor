# DOCX to Markdown demo

A standalone browser demo for the private `@docx-editor.dev/docx-to-markdown` package. It keeps the
editable, Word-style paginated document on the left and renders the exporter's real `pages[]` result
on the right.

```bash
bun dev:markdown
```

Open <http://localhost:5177>. Upload or drag in a `.docx`, edit it, and pause briefly to refresh the
Markdown. Preview mode renders GitHub-flavored Markdown, including tables and task lists; Source mode
shows the exact Markdown for each page's body, header, and footer. Comments are presented from the
separate review sidecar: Preview pairs each thread with its selected Markdown range, while Source
shows the same information as plain text without modifying the exported document Markdown.

The preview uses `react-markdown`, `remark-gfm`, `rehype-raw`, and `rehype-sanitize`. It does not
implement a Markdown parser. Because GFM cannot represent a table inside another table, the exporter
uses narrowly scoped inline HTML for nested tables; the demo's sanitizer admits only those known
span classes and ARIA roles.

Pictures still participate in Core layout so page boundaries reflect their geometry, but this v1
Markdown projection deliberately omits image content. A portable asset contract will be designed
before image syntax becomes part of the package API.

The demo uses the same font ordering as production export: packaged metric-compatible faces first,
then the opt-in Google Fonts resolver for families declared by the current document. Both the editor
and exporter receive the same on-demand origins. Proprietary families absent from the DOCX, packaged
set, and pinned Google catalog remain reported as unresolved rather than receiving an invented
metric substitute. Raw file-derived HTML is never trusted; generated inline HTML is parsed and
sanitized before rendering.

The API tab shows a Node.js example using the current filename and selected page fields. Preview
settings only choose which returned fields to display; they do not change the export result.
The example includes the same Google Fonts fallback as the demo and uses the default resource timeout. Font
resolution details remain available in the complete live JSON response.

Copy follows the active view: the Node.js example, the live JSON response, or the full-document
Markdown. Download saves `result.markdown` as a `.md` file using the input filename. Full-document
Markdown excludes repeated headers and footers; those remain available on individual pages.

The favicon is the SVG served by `https://www.docx-editor.dev/icon0.svg`, stored locally so the
standalone deployment shares the main site's branding without a runtime request to that site.
