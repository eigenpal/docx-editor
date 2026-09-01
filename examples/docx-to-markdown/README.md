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

The demo uses the same font ordering as production export: packaged metric-compatible faces first,
then the opt-in Google Fonts resolver for missing families. Raw file-derived HTML is never trusted;
generated inline HTML is parsed and sanitized before rendering.
