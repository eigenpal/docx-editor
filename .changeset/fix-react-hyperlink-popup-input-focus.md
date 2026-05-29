---
'@eigenpal/docx-editor-react': patch
---

Fix hyperlink popup text and URL inputs being uneditable. The editor container's focus and keydown handlers were redirecting focus to the document, so the popup inputs could never hold focus or accept typing.
