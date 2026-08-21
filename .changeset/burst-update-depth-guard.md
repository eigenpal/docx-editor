---
'@docx-editor.dev/react': patch
---

Sustained key repeat against a fast document no longer risks React's maximum update depth guard; state notifications yield to a task when a notification-wave streak goes unbroken.
