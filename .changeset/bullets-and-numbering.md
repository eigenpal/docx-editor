---
'@docx-editor.dev/react': patch
---

Bullets and Numbering are wired to the toolbar. Toggling either on creates the list definition on first use — including `numbering.xml`, its relationship and its content-type entry — so a document that has never carried a list can start one. An existing definition of the same kind is reused rather than duplicated, and toggling the same kind again removes the list while leaving the rest of the paragraph's formatting alone.

The buttons show a pressed state, and only when the whole selection is that kind of list.
