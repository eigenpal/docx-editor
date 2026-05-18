---
'@eigenpal/docx-editor-core': patch
---

Annotate every subpath barrel with `@packageDocumentation` + `@public` so API Extractor can extract them in the next phase. The exports map is unchanged; the published surface is unchanged. Doc-only.
