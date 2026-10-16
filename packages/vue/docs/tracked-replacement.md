<!-- Generated from docs/site/content/recipes by scripts/sync-agent-docs.mjs. Edit the source and run `bun run docs:agent`. -->

# Replace as a tracked change

In a browser host, find the text with `editor.findMatches` and replace one match with the `replaceMatch` command. In suggesting mode, the replacement is a tracked change as the editor's `author`. The selection and the scroll position do not move.

`findMatches` also returns matches in headers, footers, notes, and text boxes. Those matches have a `scope`. `replaceMatch` replaces text only in the story that the reader has open, and refuses the others, so the example keeps body matches: the ones without a `scope`.

```vue
<script setup lang="ts">
import { useDocxEditor } from '@docx-editor.dev/vue';

const props = defineProps<{ from: string; to: string }>();
const editor = useDocxEditor();
function run() {
  const current = editor.value;
  if (!current || !current.setEditingMode('suggesting').ok) return;
  const match = current.findMatches(props.from, { matchCase: true }).find((found) => !found.scope);
  if (match) current.exec({ type: 'replaceMatch', match, text: props.to });
}
</script>

<template>
  <button @click="run">Propose {{ to }}</button>
</template>
```

Suggesting mode needs an editor `author`. Without one, `setEditingMode('suggesting')` refuses. To replace every match in one undo step, run the `replaceAllMatches` command, `{ type: 'replaceAllMatches', query, text }`, through the editor's `exec`.

## Replace in a headless pipeline

In the editing API, set `document.changeTrackingMode` to `'TrackMineOnly'`, and then replace the found range with `insertText(text, 'Replace')`.

```ts
import { DocxEditor } from '@docx-editor.dev/editor-api';

const runtime = await DocxEditor.createServer(bytes, { author: 'Review bot' });
await runtime.run(async (context) => {
  context.document.changeTrackingMode = 'TrackMineOnly';
  const found = context.document.body.search(from, { matchCase: true });
  found.load('items');
  await context.sync();
  found.items[0]?.insertText(to, 'Replace');
  await context.sync();
});
const saved = await runtime.save();
runtime.dispose();
```

Both paths save the same `w:del` and `w:ins` structure, with the same author and date format. Never turn tracking off to make a refused tracked edit succeed.
