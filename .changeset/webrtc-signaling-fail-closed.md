---
'@docx-editor.dev/pro': minor
---

`createWebrtcCollaboration` and the WebRTC collaboration hooks now require `signaling`, so pass your own signaling URLs, or pass `DEMO_SIGNALING_ENDPOINTS` explicitly for demos. Each WebRTC room now reaches only the signaling servers it lists, and closing the last room on a server closes its connection. Fixes #1345
