---
'@docx-editor.dev/pro': minor
---

`createWebrtcCollaboration` and the React and Vue `useWebrtcCollaboration` hooks now require `signaling` and no longer fall back to the public demo endpoints, so add your own signaling URLs, `DEMO_SIGNALING_ENDPOINTS` for demos, or `[]` for tabs of one browser. Each WebRTC room now reaches only the signaling servers it lists, and closing the last room on a server closes its connection. Fixes #1345
