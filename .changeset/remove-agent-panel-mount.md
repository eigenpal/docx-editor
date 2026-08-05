---
'@docx-editor.dev/react': major
---

Remove the agent panel mount from the editor shell. `DocxEditorShell` no longer takes `agentPanel`, `agentPanelOpen` or `onAgentPanelClose`, and the panel component they rendered is gone: it resolved against a chat surface the current packages no longer ship, so it rendered nothing. Drive the document through `DocxEditor` from `@docx-editor.dev/editor-api` and render your own panel around it.
