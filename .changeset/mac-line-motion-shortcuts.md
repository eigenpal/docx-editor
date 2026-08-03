---
'@docx-editor.dev/react': patch
---

Cmd+Left/Right now move to the start and end of the line, and Cmd+Shift+Left/Right select to it. Line motion was previously reachable only through Home/End, which most Mac keyboards do not have.

Pasting text that spans a page break no longer does nothing. Copying across a page break produced a character that could not be written back, so the whole paste was refused — Select All, Copy, Paste was a no-op on any document longer than a page. A page break now pastes as a paragraph break.

Pasting from an application that offers only HTML on the clipboard now inserts that content's text instead of doing nothing. Paste remains plain text: no markup or structure is carried into the document.
