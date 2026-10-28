---
'@docx-editor.dev/core': patch
---

The first body row below a repeated table header reserves the wider of its own top border and the header's bottom border in compatibility mode 14 and earlier, and the border it shares with the row above it in mode 15 and later. Fixes #1561.
