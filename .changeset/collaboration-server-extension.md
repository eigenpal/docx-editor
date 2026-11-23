---
'@docx-editor.dev/pro': minor
---

Add `collaborationServerExtension`, a Hocuspocus extension that checks client and room formats, prepares and stores rooms with a DOCX export, and upgrades a stored room of an earlier collaboration format when the server loads it. The Hocuspocus provider now sends its collaboration format in the `collaborationFormat` query parameter of the server URL. A server with the extension refuses clients that do not send the parameter, so update clients first.
