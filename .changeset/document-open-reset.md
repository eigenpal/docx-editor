---
'@docx-editor.dev/react': patch
---

Opening a document now starts it at the first page instead of the previous file's scroll position. The review rail hides the read-only "changed the document structure" cards by default (opt back in with `structural` on `DocxEditor.Review`) and spaces unmeasured cards so dense redlines no longer paint cards over each other. The packaged File › Open reports the opened file through the new `onOpenFile` menu prop and names the default Save download after it.
