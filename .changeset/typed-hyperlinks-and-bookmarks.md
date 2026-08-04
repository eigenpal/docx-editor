---
'@docx-editor.dev/react': minor
---

Hyperlinks and bookmarks: link text now renders, and links can be inserted, edited, followed and removed.

`w:hyperlink` is a typed node, so the words inside a link are laid out, painted and selectable like any other text — previously they were dropped and a sentence with links rendered with holes in it. Clicking an external link opens a popover (`DocxEditor.HyperLink`) with the target, copy, edit and unlink; clicking an internal link scrolls to its bookmark and moves the caret, including targets on pages that have not been painted yet. Ctrl/Cmd+K and the toolbar's link button insert or edit at the selection.

A link's text takes direct formatting like any other text — select it and make it red, bold or larger, and the change wins over the `Hyperlink` character style without removing it. This also fixes run formatting in any paragraph that contains a link: a range edit now addresses the runs after a link at their real offsets instead of landing inside the link.

Targets are allowlisted at the trust boundary: `http(s)`, `mailto`, `tel` and `ftp` only, and an external target must be an absolute URL. Anything else renders inert and still round-trips unchanged. Opening a document never requests a link target.
