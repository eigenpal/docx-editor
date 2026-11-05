---
'@docx-editor.dev/core': patch
---

In suggesting mode, typing in a text box and choosing a dropdown, combo box, date, or checkbox content control value now record tracked changes, as does `ContentControl.setValue` with change tracking on, Next and Previous Change now reach changes inside text boxes, and you can comment on text in a text box. Moving or resizing a picture or text box applies directly because it has no tracked form, and a legacy form checkbox or dropdown refuses the change with a reason instead of ignoring the press.
