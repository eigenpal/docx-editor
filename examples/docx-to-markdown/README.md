# DOCX to Markdown demo

Edit a DOCX and preview its Markdown page by page. This demo uses the private
`@docx-editor.dev/docx-to-markdown` workspace package.

## Run the demo

From the repository root, run:

```bash
bun dev:markdown
```

Open [the local demo](http://localhost:5177). Upload or drag in a `.docx`, then edit it.
The Markdown refreshes after you pause typing.

- **Preview** renders GitHub-flavored Markdown (GFM), including tables and task lists.
- **Source** shows each page's Markdown, header, and footer.
- Both views show comments separately from the exported Markdown.

## Fonts and output

The editor and exporter use the same fonts: packaged substitutes first, then Google Fonts.
The Google Fonts resolver makes network requests. Fonts unavailable in the document, packaged
set, or pinned Google catalog are reported as unresolved.

Images affect page layout but are omitted from Markdown. Nested tables use inline HTML.
The preview renders and sanitizes output with `react-markdown`, `remark-gfm`, `rehype-raw`,
and `rehype-sanitize`.

## API example and downloads

The API tab shows a Node.js example using the current filename and selected page fields. Preview
settings only choose which returned fields to display; they do not change the export result.
The example uses Google Fonts and the default resource timeout. Font resolution details remain available in the complete live JSON response.

Copy follows the active view: the Node.js example, the live JSON response, or the full-document
Markdown. Download saves `result.markdown` as a `.md` file using the input filename. Full-document
Markdown excludes repeated headers and footers; those remain available on individual pages.

The favicon is the SVG served by `https://www.docx-editor.dev/icon0.svg`, stored locally so the
standalone deployment shares the main site's branding without a runtime request to that site.
