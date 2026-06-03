---
'@eigenpal/docx-editor-core': minor
---

Fix watermark fidelity when saving to OOXML. Picture watermarks applied across a document's headers now bind each header to its own image relationship (previously the same relationship id was reused across header parts, which could break the image on title or even pages). Watermarks now also appear on title pages and even pages by creating the first/even header parts a section displays but lacks, without disturbing existing header inheritance. Picture watermarks keep the image's aspect ratio instead of being forced into a square.
