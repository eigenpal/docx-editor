---
'@eigenpal/docx-editor-core': patch
'@eigenpal/docx-editor-react': patch
---

Harden `openPrintWindow` to build the print window via DOM APIs instead of `document.write`, so a crafted document title cannot break out into executable markup. The framework-agnostic print helpers are now exported from `@eigenpal/docx-editor-core` as the single source of truth, and the React package re-exports them unchanged.
