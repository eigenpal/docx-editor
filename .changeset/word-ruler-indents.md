---
'@docx-editor.dev/react': major
---

The horizontal ruler carries Word's four indent handles: first line, hanging, the left box and right. Dragging one previews live and commits a single undo step on release, snapping to the eighth-inch grid with Alt for continuous placement. The handles show on a read-only document and refuse the drag rather than disappearing, and each is operable by arrow key. Two toolbar steppers set the same indents to an exact typed value.

Indent now reads through the style and numbering cascade, so a list item reports the indent its numbering gives it rather than zero. A selection whose paragraphs disagree shows the first paragraph's values, as Word does, instead of going blank.

Two round-trip fixes come with it: a negative `w:firstLine` is no longer flattened to zero on a non-list paragraph, and setting one indent no longer drops the paragraph's others.

Breaking: `HorizontalRulerProps` replaces `indentLeft` / `indentRight` / `firstLineIndent` / `hangingIndent` and their three callbacks with `indent`, `onIndentChange`, `onIndentDragEnd`, `showIndentHandles` and `indentEditable`. The `setIndent` command takes one signed `firstLine` in place of the `firstLine` / `hanging` pair, and accepts `null` to clear an indent back to the paragraph's style.
