---
'@docx-editor.dev/editor-api': patch
---

Document and test explicit byte ownership for detached server runtimes: `createServer` completes consumption of input bytes and each `save` returns fresh caller-owned bytes.
