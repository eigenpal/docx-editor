# `@docx-editor.dev/docx-to-markdown`

> Private workspace package. Publishing is intentionally deferred to the final release step.

Server-first DOCX to Markdown conversion using the same semantic layout records as the editor
and future exporters. It needs no DOM, browser, editor instance, or CLI.

```ts
import { readFile } from 'node:fs/promises';
import { exportMarkdown } from '@docx-editor.dev/docx-to-markdown';

const result = await exportMarkdown(new Uint8Array(await readFile('document.docx')));
console.log(result.markdown);
```

The Node defaults use the metric-compatible faces from `@docx-editor.dev/fonts`, HarfBuzz
shaping, bounded image-header decoding, and the core export session. Pass `measurer` only when
you deliberately need host-owned metrics. Use `openDocumentForExport` plus
`exportMarkdownFrom` to reuse one settled layout for several translations.

Document-embedded fonts are not automatically admitted by the Node defaults yet. A DOCX that
depends on `w:embedRegular`, `w:embedBold`, `w:embedItalic`, or `w:embedBoldItalic` can therefore
paginate differently from the browser editor, which does auto-wire those faces. Until headless
embedded-font lifecycle and process-budget ownership are available in core, provide a host-owned
`measurer` (and matching `producer`) when browser-identical per-page output for such documents is
required. Logical full-document Markdown remains independent of page breaks.

The `image` mapper is synchronous. Upload or persist validated media before translation, then
return URLs from a precomputed map; returning a Promise is rejected instead of emitting a broken
Markdown destination.

EMF, WMF, and TIFF remain labelled placeholders by default because Node cannot decode them
without a format-specific dependency. Pass `convertPreservedImage` to `openDocumentForExport`
or `exportMarkdown` to convert those bytes to a supported raster format. The converter receives
the preserved MIME type, resource limits, and the session abort signal.

Markdown is a semantic degradation: page headers and footers are returned per page; merged
table cells are flattened; positioned anchored images are emitted in stable record order;
anchored text boxes are omitted because they have no unambiguous linear position. Office Math
uses the core semantic equation fallback. A note continued onto a page without its reference is
emitted there as a labelled `Footnote` or `Endnote` continuation block so page Markdown remains
visible when rendered independently.

The browser and headless exporter use the same core layout coordinator. Existing core projection
and layout improvements therefore flow into Markdown automatically. When core introduces a new
semantic record field or kind, compile-time policy ratchets require Markdown to represent or
explicitly classify it as callback-exposed, layout-only, or omitted. Focused output tests remain
the behavioral authority for represented semantics.
