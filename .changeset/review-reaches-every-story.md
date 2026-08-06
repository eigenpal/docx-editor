---
'@docx-editor.dev/core': minor
---

Tracked changes and comments inside footnotes and endnotes now reach the review queue. They get cards with real geometry, `getTrackedChanges` names the story holding them, the caret can make one active, opening a card enters that note, accept and reject resolve against the note's own part, and a note card can be replied to — commenting anywhere after a note reference was refused before, because the offset walk counted note marks as no characters. Commenting outside the body works the same way: a range selected in a header, footer or note offers the affordance and the comment lands in that story. `focus(scope)` honours its argument, and a scope it cannot open is refused without first closing the story the reader had open.
