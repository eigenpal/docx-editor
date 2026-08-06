---
'@docx-editor.dev/pro': minor
---

Custom node writes now return the id of the control they authored, so a host can follow a node across a rewrite. Clicking a chip also activates reliably: activation is driven by the press and release rather than `click`, which the browser does not fire at all when the press repaints the control.
