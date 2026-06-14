---
'@eigenpal/docx-editor-vue': patch
'@eigenpal/docx-editor-core': patch
---

Polish the Vue toolbar and comment cards to match React. The toolbar font-size box is now correctly editable (typing commits on Enter/blur; +/− and arrow steppers no longer revert; the preset dropdown opens positioned), is the same height as React's, and steps by 1 beyond the preset list; the style-picker dropdown previews match React's sizes/weights and the menu is the same compact width instead of ballooning. Comment and tracked-change cards now use the shared near-white card color and drop shadow (new `--doc-card`/`--doc-card-shadow` tokens, sourced once in core) in both collapsed and expanded states, instead of a blue tint and a divergent shadow, matching React.

Further menu and submenu parity with React: the top menu bar (File/Format/Insert/Help) items and triggers use full-strength text instead of muted grey, with matching shortcut hints and submenu borders; the style dropdown no longer clips its last entries; font-picker group labels render Title Case; the alignment control is now a horizontal icon strip with a blue active state (matching React's AlignmentButtons) instead of a vertical labeled menu; and the comments sidebar width matches React (340px).
