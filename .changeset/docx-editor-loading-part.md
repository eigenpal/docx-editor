---
'@docx-editor.dev/react': minor
---

Add `DocxEditor.Loading`, a composition part that renders a loading screen while there is no document to paint and nothing once there is. Supply your own children, or omit them for a spinner drawn from the theme tokens. Its `when` prop ORs in the host's own async, so a single declaration covers both fetching the bytes and starting the editor.
