---
'@eigenpal/docx-editor-core': patch
---

Harden handling of untrusted input: reject zip-bomb DOCX archives (per-entry and total decompression limits), constrain rendered image sources to safe URL schemes, validate agent/MCP edit positions before they touch the document, cap the MCP stdio input buffer, drop prototype-polluting keys in the VML style parser, and validate DrawingML color values at the parse boundary.
