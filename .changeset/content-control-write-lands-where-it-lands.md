---
'@docx-editor.dev/react': patch
---

Resolve a content-control write against every control it would land in, not only the control it names. Inserting text at the start or the end of an unlocked, unbound control whose content began or ended with a nested control wrote into that nested control, so a `sdtContentLocked` field could be typed into and a custom-XML-bound one could be desynchronised from its part.
