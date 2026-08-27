---
'@docx-editor.dev/pro': patch
---

WebRTC room encryption no longer uses the public room id as the password; pass a `#collab=` URL fragment secret or signaling stays unencrypted.
