---
'@eigenpal/docx-editor-core': patch
---

Tolerate stray `&` in DOCX XML parts. Previously, a single unescaped ampersand anywhere in `document.xml`, a header, footer, or comments part would fail the whole parse with "Invalid character in entity name". Stray ampersands are now escaped before handing off to the underlying XML parser, and when a parse error still escapes through, the message includes a snippet of the bytes around the offending column.
