---
'@docx-editor.dev/agents': minor
---

Reach a document's content controls from the document object model, and honour the locks and form protection they carry.

`document.contentControls`, `body.contentControls` and `control.contentControls` answer the controls a story or a control holds, in document order. Each one reads its tag, its title, the kind of control it is, the characters it encloses, the paragraphs it holds, the two halves of its lock, whether it is showing its prompt and whether it removes itself on the first edit. `getById`, `getByTag` and `getByTitle` find a control the way a template author names it, and a control the file gave no `w:id` — or gave the same one twice — is still reachable, because a control's identity is not its number.

`setValue` writes the value the control's own type accepts: a declared item for a dropdown, free text for a combo box, an ISO instant for a date picker (which writes both the date and the text it formats to), and a state for a checkbox (which writes the glyph the file declares for it). `insertText`, `getRange`, `tag`, `title`, `cannotEdit`, `cannotDelete` and `delete(keepContent)` complete the surface. Writing into a control that was showing its prompt replaces the whole prompt and clears the flag, and clearing a value brings the prompt back.

Every one of these goes through the same write path a keystroke takes, so a locked control, a control bound to a custom XML part, and a value a control's type does not accept are refused with the same named reason a typed edit gets — and a document protected for forms only lets a script edit what a person could. Block, inline, row and cell controls are addressable in every story, including table cells, headers, footers and note bodies.

Picture controls, repeating sections, docPart galleries, smart tags and custom XML bindings are preserved exactly as the file wrote them rather than typed, and `appearance`, `color`, `placeholderText`, the numeric `id` and Word's own subtype wording are recorded omissions with a reason each.
