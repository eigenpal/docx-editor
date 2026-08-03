---
'@docx-editor.dev/react': minor
---

The editor now ships a menu bar — File, Format, Insert, Help — under the document title, alongside the toolbar. Open, Save and Page setup work with no configuration; `onOpen` and `onSave` replace them, and `menu={false}` removes the bar. Insert reaches page breaks and next-page section breaks, and Format carries the text and alignment commands with a live checked state.

Every row is a chrome slot, so it shares its label, icon, command and enabled state with the toolbar control for the same capability. Rows the engine cannot honour yet — image, table, table of contents, watermark, continuous section break — are shown and disabled, carrying the engine's own reason rather than being hidden.

Compose a different bar with `DocxEditor.Menu` and its parts (`.File`, `.Insert`, `.Item`, `.Row`, `.Submenu`, `.TableGrid`, …), which replace a menu or a row in place.
