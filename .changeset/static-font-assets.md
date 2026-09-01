---
'@docx-editor.dev/fonts': patch
---

Preserve one literal asset URL per packaged font face in the ESM browser build so Next.js with
Turbopack, Vite, and webpack resolve every requested filename instead of collapsing dynamic URLs
to one font. Keep the CommonJS build resolving the same packaged files in Node.
