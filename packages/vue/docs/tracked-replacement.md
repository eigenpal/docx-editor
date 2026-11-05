<!-- Generated from docs/site/content/recipes by scripts/sync-agent-docs.mjs. Edit the source and run `bun run docs:agent`. -->

# Replace as a tracked change

Find text with `editor.findMatches` and replace a match with the `replaceMatch` command in suggesting mode. On a server, set `document.changeTrackingMode` and call `insertText(text, 'Replace')`.

## Replace text in the editor

The following button proposes a replacement for the first body match, so the body must be the open story. `replaceMatch` also accepts a match in the open header, footer, or note, and refuses text-box matches. The editor needs an `author` and `reviewModule()` in its modules, or `setEditingMode('suggesting')` refuses.

```vue
<script setup lang="ts">
import { useDocxEditor } from '@docx-editor.dev/vue';

const props = defineProps<{ from: string; to: string }>();
const editor = useDocxEditor();
function run() {
  const current = editor.value;
  if (!current || !current.setEditingMode('suggesting').ok) return;
  // Body matches have no `scope`. replaceMatch needs the match's story open.
  const match = current.findMatches(props.from, { matchCase: true }).find((found) => !found.scope);
  if (!match) return;
  const result = current.exec({ type: 'replaceMatch', match, text: props.to });
  if (!result.ok) console.warn(result.code, result.reason);
}
</script>

<template>
  <button @mousedown.prevent @click="run">Propose {{ to }}</button>
</template>
```

The replacement is a tracked change by the editor's `author`. The button prevents its `mousedown` default, so the selection and scroll position do not move. To replace every match in one undo step, run `{ type: 'replaceAllMatches', query, text }` through `exec`.

## Replace text on a server

The following example records a tracked replacement and saves the result:

```ts
import { DocxEditor } from '@docx-editor.dev/editor-api';

const runtime = await DocxEditor.createServer(bytes, { author: 'Review bot' });
try {
  await runtime.run(async (context) => {
    context.document.changeTrackingMode = 'TrackMineOnly';
    const found = context.document.body.search(from, { matchCase: true });
    found.load('items');
    await context.sync();
    found.items[0]?.insertText(to, 'Replace');
    await context.sync();
  });
  const saved = await runtime.save();
} finally {
  runtime.dispose();
}
```

End with `await context.sync()` to send the queued replacement. Never turn tracking off to make a refused tracked edit succeed.

## See also

- [Tracked changes in the editing API](https://www.docx-editor.dev/docs/2.x/editor-api/revisions)
- [Propose an AI rewrite as tracked changes](./propose-rewrite.md)
- [Comment on found text](./comment-on-found-text.md)
