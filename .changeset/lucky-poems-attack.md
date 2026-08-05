---
'@docx-editor.dev/core': minor
---

The root entry and the `contracts/*` entries now export the types their own signatures hand
out — `CanResult` from `can()`, `TextMatch` from `findText()`, `TableContext` from `query()`
and around 60 more that were previously unnameable from the entry point that returns them.
The root re-exports the whole `Editor` contract rather than a hand-listed subset, so it cannot
drift from it again.

Removes `@docx-editor.dev/core/contracts/plugin` and `@docx-editor.dev/core/contracts/mcp`.
Every function in them threw, and `coreTools` had no runtime binding at all. Extensions and
MCP are deferred to a separately specified contract; `EditorModule` is the supported seam.
