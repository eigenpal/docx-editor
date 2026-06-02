---
'@eigenpal/docx-editor-agents': patch
---

Headless agent bridge: paragraphs with no `w14:paraId` are now addressable. `read_document` already labels such paragraphs by their ordinal index, but the bridge only registered paragraphs that carried a paraId — so every paraId-anchored op (comments, tracked changes, and formatting/style) rejected the id the agent was given, and `find_text` skipped those paragraphs entirely. Documents without paraIds (common in Word output) were effectively read-only through the bridge. The bridge now keys those paragraphs by the same ordinal index it reports, and `find_text` surfaces them with that ordinal id — so a phrase it returns is anchorable by the mutate tools.
