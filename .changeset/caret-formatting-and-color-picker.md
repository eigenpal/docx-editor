---
'@docx-editor.dev/react': minor
---

Toolbar state now follows the caret the way Word's does. Placing the cursor in a bold, italic, colored, or styled run lights the matching controls; the font and size boxes always show the effective values, resolved through the paragraph style chain, document defaults, and theme fonts when runs carry no direct formatting. Strikethrough (and every toggle) turns off again on a second press. Undo and redo grey out when there is nothing left to undo or redo. The caret is visible in a new empty paragraph after pressing Enter. The font color and highlight controls open a full picker with Automatic/No Color, the document's theme color matrix, standard colors, and a custom hex field; `getDocumentThemeColors()` exposes the document theme palette.
