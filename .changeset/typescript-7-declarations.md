---
'@docx-editor.dev/core': patch
---

The `@docx-editor.dev/i18n` type declarations are now valid when a project type-checks its dependencies with `skipLibCheck` turned off. Some declared types print in a different form, such as `DocumentOutline` as a `MemoExoticComponent`, with the same meaning.
