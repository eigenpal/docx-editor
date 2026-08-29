---
'@docx-editor.dev/fonts': patch
---

Register a packaged face from the bytes already loaded, so it costs no second request and an injected `fetcher` sees every byte read for it. A face that fails to load still registers by URL. Fixes #596.
