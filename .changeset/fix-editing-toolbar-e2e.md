---
'@eigenpal/docx-editor-core': patch
'@eigenpal/docx-editor-react': patch
'@eigenpal/docx-editor-vue': patch
---

Fix editing/toolbar regressions: close history on Backspace/Delete so undo restores deleted text, portal the hidden body PM outside the paged scroller, add Mod alignment shortcuts, stop table Tab from being swallowed by insertTab, and make list Tab/Shift+Tab indent at a caret.
