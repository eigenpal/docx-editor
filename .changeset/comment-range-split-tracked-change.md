---
'@eigenpal/docx-editor-core': patch
---

Fix duplicate comment range markers when commenting across a tracked change. A comment whose range was interrupted by an inserted or deleted run now serializes as a single commentRangeStart/End pair instead of multiple, which Word rejected as unreadable content.

Fixes #914
