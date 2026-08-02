---
'@docx-editor.dev/react': minor
---

Add `DocxEditor.Loading`, a composition part that renders a loading screen while the editor is still waiting for a document. It needs no condition wired up, and it is safe to gate the editor's mount point on. Supply your own children — composing `DocxEditor.Loading.Spinner` back in if you want the packaged indicator — or omit them for a spinner with a translated label.
