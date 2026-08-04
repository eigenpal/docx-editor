---
'@docx-editor.dev/react': minor
---

Add the review surface: tracked changes and comments as one queue, with accept, reject and threaded reply. `DocxEditor.Review` renders it in React, over a `useReview()` hook for hosts that want their own.

The toolbar's mode control switches between Editing, Suggesting and Viewing. In Suggesting, typing and deleting are written as tracked changes, so every edit arrives in the review pane as a proposal to accept or reject. Typing over a selection reads as one "Replaced x with y" card, including when the replaced text spans an endnote or footnote reference.

Comment threads are read from `commentsExtended.xml`, from `@w16cid:parentId`, or from the anchors themselves when a file carries neither, so replies stay nested under the comment they answer instead of appearing as separate cards.

Selecting text offers a button to comment on it. Commented and changed text is highlighted in the document, faintly while pending and deepened for the one the caret is in. The toolbar's comments button shows and hides the pane; the document and ruler re-centre together, and the collapsed pane keeps a marker per item.
