---
'@docx-editor.dev/react': patch
---

Fix ruler behavior on narrow viewports: the horizontal ruler now clamps to the page's left edge instead of overflowing on both sides, and the vertical ruler hides while the page is wider than the viewport instead of scrolling out of view.
