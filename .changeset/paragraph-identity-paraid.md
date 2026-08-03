---
'@docx-editor.dev/react': minor
---

Every paragraph now carries Word's stable identity, `w14:paraId` — the same value Office JS exposes as `uniqueLocalId`. Documents that already have ids keep them byte-for-byte; documents without get valid ids on open, the way Word assigns them on save. Pressing Enter keeps the original paragraph's id and gives the new paragraph a fresh one, joins keep the survivor's, and undo restores exactly what was there — so comment threads and tracked changes anchored to a paragraph survive editing.

The editor now answers in that vocabulary: `snapshot().selection` reports the selected paragraphs as a `DocRange` of paraId anchors, the `paragraphs` query lists every editable paragraph with its `paraId`, text and style, and `setSelection` accepts paraId anchors — including a `search` phrase that must match exactly once (or an explicit `occurrence`) to place the caret or select a span inside a paragraph.
