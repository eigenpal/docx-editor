---
'@docx-editor.dev/pro': minor
---

`createWebrtcCollaboration` and the WebRTC collaboration hooks now require `signaling` and no longer fall back to the public demo endpoints; pass your own signaling URLs, or pass `DEMO_SIGNALING_ENDPOINTS` explicitly for demos. Fixes #1345
