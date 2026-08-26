---
'@docx-editor.dev/pro': minor
'@docx-editor.dev/core': patch
---

Add the `create-or-join` collaboration bootstrap: every peer opens a room with the same options, the first peer seeds it and later peers join it, so hosts no longer decide out-of-band which peer creates the room. A room that two partitioned peers seeded concurrently reports the new terminal failure code `concurrent-seed` on every replica; recover by creating a new room from saved bytes.
