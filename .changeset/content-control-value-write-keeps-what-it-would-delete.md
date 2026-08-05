---
'@docx-editor.dev/react': patch
---

Refuse a content-control value write, and a removal that does not keep the content, when it would destroy a control nested inside the named one. Setting an unlocked control's value rebuilt its content from nothing, so a `sdtContentLocked` field nested in it was deleted rather than protected and a custom-XML-bound one was discarded in silence. Removing a control while keeping its content still reaches nothing nested, and a control with no protected descendants is replaced exactly as before.
