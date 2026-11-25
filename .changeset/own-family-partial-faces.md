---
'@docx-editor.dev/core': patch
'@docx-editor.dev/docx-to-pdf': patch
---

A font family with faces under its own name, from your font resolver or embedded in the DOCX, now draws each face it lacks as a synthesized style of its nearest own face, in measurement, paint, and PDF export. Before, those faces measured in the class fallback while paint synthesized them.
