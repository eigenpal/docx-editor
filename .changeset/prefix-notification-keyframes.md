---
'@docx-editor.dev/react': patch
---

The error notification toast animates with a `docx-` prefixed keyframes name from the core stylesheet instead of injecting a global `@keyframes slideIn`, so it no longer collides with a host application's animation of the same name. Fixes #485
