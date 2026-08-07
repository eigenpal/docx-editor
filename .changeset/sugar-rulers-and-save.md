---
'@docx-editor.dev/react': minor
---

`<DocxEditor>` now shows rulers, and `onSave` no longer draws a button. The horizontal ruler compensates for the navigation shift and the review gutter itself, so it only measures correctly in the row above the scroll container — a slot the packaged host is the only thing that can offer, which meant a host mounting it by hand got ticks that drifted off the page. Pass `rulers={false}` for a bare page. Separately, setting `onSave` also rendered an inline-styled Save button into the title bar that a host could not remove; `onSave` is now just the action, and File -> Save still invokes it.
