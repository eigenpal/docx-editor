---
'@docx-editor.dev/react': patch
---

Fix where an edit at a content control's edge lands and who refuses it. Text typed at a control's leading edge goes into the control, so a locked field refuses it instead of accepting it silently; the trailing edge stays outside. Inserting text into a control through the automation API now writes inside the control at both ends rather than beside an inline one. A control's lock no longer freezes the document's own page setup, section furniture or note numbering, and a form-protected document lets an unlocked inline field be filled in while the text around it stays read-only.
