---
'@docx-editor.dev/react': patch
---

Enforce a content control's lock and its data binding against everything that would change what it holds, and lay out a control around a table row or cell as that row or cell.

A lock on an inline control now refuses the edits that address the characters inside it: typing, deleting and formatting are resolved against the control's own span, and a selection that crosses its boundary is refused whole rather than partly applied. A lock is also met by the writes that are not typing — accepting or rejecting a tracked change inside a control, retargeting or unlinking a hyperlink it holds, and document-wide writes such as page setup — instead of only by the text vocabulary.

Every edit inside a control bound to a custom XML part is refused with the same named reason a value write already gave, so the document and the part it mirrors cannot drift apart through ordinary typing. Removing such a control is allowed and takes the binding with it; the control's tag and title stay writable.

A `w:sdt` around a table row or a table cell is laid out as that row or cell — measured, painted, and addressable, with its grid column, `w:gridSpan`, header repeat and vertical merge unchanged. Such a row or cell was previously dropped from the page entirely.
