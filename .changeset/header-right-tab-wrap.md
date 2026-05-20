---
'@eigenpal/docx-editor-core': patch
---

Fix paragraph text wrapping onto an extra line when a right (`end`) or center tab stop is used (for example a header with a logo, a right tab, then text).

The line measurer and the page painter each had their own tab-stop code. The measurer ignored the stop's alignment and the left indent, and used a coarse default-tab grid, so right-tabbed content was measured too wide and wrapped even though the painter laid it out on one line. Both now share one tab-stop model (`calculateTabWidth`): the same stop grid, indent handling, and `end`/`center`/`bar` alignment, so measurement and paint agree.
