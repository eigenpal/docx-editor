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
