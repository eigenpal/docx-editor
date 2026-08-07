---
'@docx-editor.dev/react': patch
---

`<DocxEditor>`'s title bar and toolbar now sit on one `--doc-surface` band, closed by a hairline and a soft shadow directly under the toolbar, with the ruler row and the workspace below it on `--doc-bg`. The seam used to be a border under the title bar, which split the band in two and left the toolbar edge to edge on no ground of its own: the toolbar paints a rounded pill, so flush against the frame its radius never showed and the row read as a second flat bar. Hosts were adding their own wrapper to get the packaged chrome to look like the composed demo it is modelled on. Nothing about the API changes, and both surfaces follow the dark palette as before.
