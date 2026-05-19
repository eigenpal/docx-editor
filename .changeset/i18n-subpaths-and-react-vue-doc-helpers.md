---
'@eigenpal/docx-editor-i18n': patch
'@eigenpal/docx-editor-react': patch
'@eigenpal/docx-editor-core': patch
---

Add per-locale subpath imports to `@eigenpal/docx-editor-i18n` so dynamic
locale loading can code-split a single locale instead of bundling the whole
set:

```ts
// Static — bundler ships only this locale's strings
import pl from '@eigenpal/docx-editor-i18n/pl';

// Dynamic — splits into its own chunk, loaded on demand
const pl = (await import('@eigenpal/docx-editor-i18n/pl')).default;
```

Subpaths ship for every locale: `/en`, `/de`, `/he`, `/pl`, `/pt-BR`, `/tr`,
`/zh-CN`. The named exports on the package root still work — pick the
ergonomic path for static lists, the subpath for runtime locale switching.

Also re-export `createEmptyDocument`, `createDocumentWithText`, and
`CreateEmptyDocumentOptions` from `@eigenpal/docx-editor-react` and
`@eigenpal/docx-editor-vue` so the common "spawn a blank editor"
affordance no longer requires installing `-core` alongside the adapter.

Surface `Comment`, `CommentRangeStart`, `CommentRangeEnd`,
`TrackedChangeInfo`, `TrackedRunChange`, `Insertion`, `Deletion`,
`MoveFrom`, `MoveTo`, and `ParagraphContent` from the main
`@eigenpal/docx-editor-core` entry. They were already public via
`@eigenpal/docx-editor-core/headless`; the main entry just hadn't been
re-exporting them.
