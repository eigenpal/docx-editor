---
'@eigenpal/docx-editor-core': patch
---

Tolerate a stray unescaped `&` in DOCX XML parts (document, headers, footers, comments) instead of failing the whole parse with "Invalid character in entity name". Stray ampersands are escaped before parsing, and any remaining parse error now includes a snippet of the bytes around the offending column.
