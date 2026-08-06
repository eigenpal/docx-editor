---
'@docx-editor.dev/core': minor
---

Tracked changes and comments inside footnotes and endnotes now reach the review queue: they get cards, `getTrackedChanges` names the story holding them, opening a card enters that note, and accept/reject resolves against the note's own part. Commenting works outside the body too — a range selected in a header, footer or note now offers the comment affordance and the comment lands in that story rather than being refused. `focus(scope)` honours its argument instead of ignoring it.
