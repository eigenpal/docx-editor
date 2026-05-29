---
'@eigenpal/docx-editor-react': patch
---

Fix Find navigation in the paged editor. Matches are now searched against the live document so they map to current editor positions, the visible page scrolls to the active match, and pressing Enter advances through results instead of snapping back to the first. The Vue adapter routes find scrolling through the same visible-page path. Fixes #321.
