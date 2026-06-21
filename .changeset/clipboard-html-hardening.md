---
'@eigenpal/docx-editor-core': patch
---

Harden clipboard HTML paste against script injection and slow-input denial of service. Pasted HTML is now sanitized (via DOMPurify) and parsed into an inert document instead of being assigned to `innerHTML`, so embedded scripts, event handlers, and `javascript:` URLs cannot run. Word comment stripping and Office/Word namespace-tag removal now use linear scans that cannot backtrack on hostile input or leave a stray comment opener behind.
