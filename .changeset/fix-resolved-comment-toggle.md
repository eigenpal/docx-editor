---
'@eigenpal/docx-js-editor': patch
---

Fix a regression where clicking the checkmark of a resolved comment did not re-open the comment card (issue #268). `PagedEditor.updateSelectionOverlay` fired `onSelectionChange` from every overlay redraw — including ResizeObserver and layout/font callbacks — not only on actual selection changes. When the sidebar card resize (or any window resize) triggered a redraw, the parent received a spurious callback with the unchanged cursor and cleared the just-set expansion. Dedup by PM state identity (immutable references) so consumers are only notified for real selection / doc / stored-marks changes.

Also: cursor-based sidebar expansion now skips resolved comments. Moving the cursor through previously-commented text no longer re-opens old resolved threads — they stay collapsed to the checkmark marker until the user explicitly clicks it.
