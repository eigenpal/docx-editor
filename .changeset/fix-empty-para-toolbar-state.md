---
'@docx-editor.dev/core': patch
'@docx-editor.dev/react': patch
---

Persist empty-paragraph formatting through focus/selection churn and keep the toolbar in sync with stored marks. Mark toggles rebind to the editor schema (and match by name) so bold/italic turn off correctly when duplicate ExtensionManager copies are loaded. Fixes empty-run bold/italic/font toggles being lost after Enter or delete-and-retype.
