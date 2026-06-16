---
'@eigenpal/docx-editor-agents': patch
---

Reach paragraphs inside table cells from the headless review tools. `find_text`, `suggest_change`, and `add_comment` now locate and edit paragraphs in `w:tbl > w:tr > w:tc > w:p`, addressed by the same paraId / ordinal index as body paragraphs, so a tracked change can be authored inside a table cell.
