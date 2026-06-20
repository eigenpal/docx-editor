---
'@eigenpal/docx-editor-core': minor
---

Add an `{ all: true }` option to `setContentControlContent`, `setContentControlValue`, and `removeContentControl` to apply the change to every content control matching the filter — across headers and footers with `{ includeHeadersFooters: true }` — instead of only the first. This covers one logical value that recurs under a shared tag (e.g. a name in the body, a running header, and several table cells). The default stays first-match. An `{ all: true }` run is atomic: if any matched control is refused by a lock, type, or data-binding guard, nothing is written unless `{ force: true }`.
