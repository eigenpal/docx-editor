---
'@docx-editor.dev/pro': patch
---

Removing a hyperlink or content control, accepting or rejecting a change, and a tracked deletion inside a container keep one tracked change as one piece, so typing and decisions reach all of it; in a collaboration session, a concurrent accept, reject, or deletion also reaches every character it names. Fixes #1701
