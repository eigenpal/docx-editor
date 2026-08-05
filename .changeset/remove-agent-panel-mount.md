---
'@docx-editor.dev/react': major
---

Remove the agent panel mount from the editor shell. `DocxEditorShell` no longer takes `agentPanel`, `agentPanelOpen` or `onAgentPanelClose`, and the panel component they rendered is gone: it resolved against a chat surface `@docx-editor.dev/agents` no longer ships, so it rendered nothing. Drive the document from the automation object model in `@docx-editor.dev/agents` and render your own panel around it.
