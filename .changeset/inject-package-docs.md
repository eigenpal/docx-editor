---
'@eigenpal/docx-editor-core': patch
---

Add `@packageDocumentation` blocks to every public subpath across the published packages, and a small post-build step (`scripts/inject-package-doc.mjs`) that re-prepends the source's head doc-block to the dist `.d.ts` after tsup runs. tsup's rollup-plugin-dts hoists transitive type imports above the file-head comment, which previously stripped the description from the published types. Consumers now see the package-level prose in their IDE hover and the API Extractor snapshots no longer flag "No @packageDocumentation comment for this package".
