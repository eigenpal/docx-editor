---
'@docx-editor.dev/core': patch
---

Fix tracked-change and comment positions in paragraphs containing hyperlinks, footnote or endnote references, and fields. Comments anchored on or after link text no longer report as unanchored, two comments on adjacent links no longer merge into one thread, and a suggested edit in a paragraph with a note reference or a field lands where the caret is. Deleting a field as a suggestion now proposes the whole field, and typing at a field's edge places the text beside it. Sections keep their own page setup when tracked changes are hidden.
