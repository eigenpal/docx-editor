---
'@eigenpal/docx-editor-core': patch
---

Fix headless agent edits corrupting the document. `cloneDocument` (run on every agent edit) used `JSON.parse(JSON.stringify())`, which silently dropped values JSON can't represent: the `headers`/`footers`/`media` `Map`s became `{}` and `originalBuffer` became `{}`. As a result, the first edit broke export — `repackDocx` threw `Can't read the data of 'the loaded zip file'` (dead `originalBuffer`) or `map.entries is not a function` (dead headers/footers) — and dropped every image. Clone with `structuredClone` instead, sharing the read-only `originalBuffer` and shallow-copying the immutable `media` map so large binary payloads aren't copied on every edit.
