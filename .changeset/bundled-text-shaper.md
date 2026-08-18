---
'@docx-editor.dev/core': patch
---

The text shaper now ships inside the package, so a browser build no longer fails with `Module not found: Can't resolve 'module'`. Next.js, and any other bundler, needs no `resolve.fallback` or `resolveAlias` for it. Fixes #282
