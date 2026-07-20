---
'@docx-editor.dev/react': patch
'@docx-editor.dev/vue': patch
---

Fix editing/toolbar regressions: close history on Backspace/Delete so undo restores deleted text, portal the hidden body PM outside the paged scroller, add Mod alignment shortcuts, stop table Tab from being swallowed by insertTab, and make list Tab/Shift+Tab indent at a caret.
