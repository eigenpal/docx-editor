---
'@docx-editor.dev/core': patch
---

Fix four Word-fidelity layout bugs: custom tab stops are no longer preempted by the default tab grid (right/center-aligned header, footer, and body tabs now reach their stops), paragraph borders and their `w:space` insets now occupy flow height so adjacent boxed callouts keep their spacing, positioned tables honor `tblpXSpec` horizontal alignment and anchor `vertAnchor="text"` offsets to their flow position, and right-tab-anchored lines preserve authored spaces around field results (e.g. "Page 2 of 25").
