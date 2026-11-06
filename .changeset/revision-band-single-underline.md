---
'@docx-editor.dev/core': patch
---

An open tracked change no longer draws a second line under its text. The active band kept its deeper fill but dropped the 1px rule at its foot, which sat under the insertion's own underline in a different colour and read as a double underline. The unused `--doc-revision-insertion-active-border` and `--doc-revision-deletion-active-border` tokens are removed.
