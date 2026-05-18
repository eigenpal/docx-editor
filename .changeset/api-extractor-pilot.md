---
'@eigenpal/docx-editor-agents': patch
---

Wire API Extractor on `@eigenpal/docx-editor-agents/server`. Tag the 11 public exports with `@public`. Commits the first `etc/agents-server.api.md` snapshot; CI now fails on undocumented public-surface drift via `bun run api:check`. No runtime change.
