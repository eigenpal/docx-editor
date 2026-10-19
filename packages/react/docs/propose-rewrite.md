<!-- Generated from docs/site/content/recipes by scripts/sync-agent-docs.mjs. Edit the source and run `bun run docs:agent`. -->

# Propose an AI rewrite as tracked changes

An agent that rewrites a paragraph should propose the smallest set of tracked changes, not one replacement of the whole paragraph. `proposeRewrite` from `@docx-editor.dev/editor-api/agent` does this in one call. It sends the paragraph to your model, compares the answer with the original words, and writes each difference as a tracked change.

## Rewrite a paragraph

Pass the request context, the paragraph, and a function that calls your model. The following example rewrites the first paragraph on a server:

```ts
import { DocxEditor } from '@docx-editor.dev/editor-api';
import { proposeRewrite } from '@docx-editor.dev/editor-api/agent';

const runtime = await DocxEditor.createServer(bytes, { author: 'Rewrite agent' });
try {
  const result = await runtime.run(async (context) => {
    const paragraph = context.document.body.paragraphs.getFirst();
    return proposeRewrite(context, paragraph, (draft) => callModel(draft.prompt), {
      instruction: 'Make this clause shorter. Keep its meaning.',
    });
  });
  console.log(`${result.changes} changes: ${result.proposed}`);
  const saved = await runtime.save();
} finally {
  runtime.dispose();
}
```

`draft.prompt` holds your instruction, the placeholder rules, a legend of the placeholders, and the paragraph text. To write your own prompt, use `draft.text` and `draft.placeholders` instead. The changes use the runtime's `author`. In a page, create the runtime with `DocxEditor.createBrowser` from `@docx-editor.dev/editor-api/browser`, and give the editor the review module.

To rewrite several paragraphs, call `proposeRewrites(context, items)` with a list of `{ paragraph, rewrite }` items. It rewrites them one after another and returns one result for each item, shaped like a `Promise.allSettled` result. A refused paragraph does not stop the others.

To check a draft before you write it, call `prepareRewrite(context, paragraph, options)`. It returns the same draft, and `draft.apply(modelText)` writes the answer.

## Guarantees

- Either every change lands and the paragraph reads as the model's answer, or the paragraph stays as it was. A failed write rejects only the changes that this rewrite made, also in a collaboration session. Other participants' changes stay.
- The helper checks the answer before it writes anything. An answer that breaks a placeholder rule writes nothing.
- If tracking is off, the helper turns on `TrackMineOnly` for its writes and turns it off again. It never turns tracking off.
- Fields, pictures, equations, note references, and content-locked controls reach the model as numbered placeholders, such as `⟦1⟧`. They change whole or not at all.

## Handle errors

The helper throws a `RewriteError`. When `error.isModelError` is `true`, nothing was written, and `error.message` explains the broken rule in words that you can send back to the model. `proposeRewrite` does this on its own: it calls your function again with `draft.feedback` set and the reason in `draft.prompt`. It also prepares the paragraph again after a `stale` error. The `retries` option caps both and defaults to `2`.

| `code` | Meaning | What to do |
| --- | --- | --- |
| `invalid-output` | The answer is empty or has a line break. | Ask the model again. |
| `placeholder-unknown` | The answer has a placeholder that the paragraph does not have. | Ask the model again. |
| `placeholder-moved` | The answer changes the order of the placeholders. | Ask the model again. |
| `placeholder-repeated` | The answer has a placeholder more than once. | Ask the model again. |
| `placeholder-missing` | With `keepPlaceholders: true`, the answer leaves out a placeholder. | Ask the model again. |
| `text-attached` | The answer attaches text to a placeholder, such as `⟦1⟧;`. | Ask the model again. |
| `punctuation-repeated` | The answer repeats the punctuation that a placeholder already holds. | Ask the model again. |
| `pending-changes` | The paragraph has tracked changes. | Accept or reject them first. |
| `tracking-unavailable` | The runtime cannot record tracked changes. | Create the runtime with an `author`. In a page, give the editor the review module. |
| `draft-used` | The draft already wrote to the paragraph. | Prepare the paragraph again. |
| `too-long` | The paragraph and the answer are too long to compare. | Rewrite a shorter paragraph. |
| `stale` | Another edit changed the document during the rewrite. The rewrite was rolled back. | Prepare the paragraph again. |
| `locked` | An edit touched protected content. The rewrite was rolled back. | Keep the content whole. |
| `write-failed` | The document refused an edit. The rewrite was rolled back. `error.cause` holds the reason. | Read `error.cause`. |
| `verification-failed` | The paragraph would not read as the answer. The rewrite was rolled back. | Keep the spacing around each placeholder. |
| `rollback-failed` | A write failed, and rejecting the rewrite's changes failed too. | Review the paragraph. `error.cause` holds both errors. |

## How it works

1. The helper splits the paragraph into word ranges with `getTextRanges([' ', '\t'])`. It reads the `fields`, `inlinePictures`, and `contentControls` of every range in one sync.
1. It shows each atom to the model as a placeholder, with a legend of the exact text that the atom holds.
1. It compares the answer with the original words by longest common subsequence. Each run of differences becomes one call: `insertText(text, 'Replace')`, `delete()`, or `insertText(text, 'Before')` or `'After'`.
1. It writes the calls from the last one to the first, one sync each, so the earlier ranges stay valid.
1. It reads the result with `getReviewedText('Current')` and compares it with the answer.
1. If a step fails, it finds the paragraph again by its `uniqueLocalId` and rejects the revisions by the runtime's author. The paragraph had none before the rewrite, so those revisions are the rewrite's own.

A left-out placeholder deletes what it stands for as one tracked deletion. This works for fields and note references. A deletion of a whole equation fails with `verification-failed`, and a deletion of a whole content-locked control fails with `locked`. In both cases the rewrite rolls back. To refuse a left-out placeholder before anything is written, pass `keepPlaceholders: true`.

For the word-range rules, see [Text and ranges](https://www.docx-editor.dev/docs/2.x/editor-api/text-and-ranges#split-text-into-word-ranges). For tracked edit limits, see [Tracked changes](https://www.docx-editor.dev/docs/2.x/editor-api/revisions).
