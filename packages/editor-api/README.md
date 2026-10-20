<p align="center">
  <a href="https://www.docx-editor.dev/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/readme-logo-dark.svg" />
      <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/readme-logo-light.svg" />
      <img src="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/readme-logo-light.svg" alt="DOCX Editor by EigenPal" width="320" height="90" />
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@docx-editor.dev/editor-api"><img src="https://img.shields.io/npm/v/@docx-editor.dev/editor-api.svg?style=flat-square&color=3B5BDB" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@docx-editor.dev/editor-api"><img src="https://img.shields.io/npm/dm/@docx-editor.dev/editor-api.svg?style=flat-square&color=3B5BDB" alt="npm downloads" /></a>
  <a href="https://github.com/eigenpal/docx-editor/blob/main/packages/editor-api/LICENSE.md"><img src="https://img.shields.io/badge/license-EigenPal_Pro_License-blue.svg?style=flat-square&color=3B5BDB" alt="EigenPal Pro License" /></a>
  <a href="https://docx-editor.dev/editor"><img src="https://img.shields.io/badge/Live_Demo-3B5BDB?style=flat-square&logo=vercel&logoColor=white" alt="Demo" /></a>
  <a href="https://www.docx-editor.dev/docs"><img src="https://img.shields.io/badge/Docs-3B5BDB?style=flat-square&logo=readthedocs&logoColor=white" alt="Documentation" /></a>
</p>

# @docx-editor.dev/editor-api

Edit DOCX files through a supported subset of the Office.js object model. The API includes paragraphs, ranges, comments, and revisions. Use `load()` to queue reads and `sync()` to apply each batch atomically.

Run the API on a server over DOCX bytes or in the browser against an open editor. See [Office.js compatibility](https://www.docx-editor.dev/docs/2.x/editor-api/office-js-api) for supported members and differences from Office.js.

```bash
npm install @docx-editor.dev/editor-api @docx-editor.dev/core
```

Server use requires Node.js `^20.16.0 || >=22.3.0`.

## Guides by task

Start with [Runtime and setup](https://www.docx-editor.dev/docs/2.x/editor-api/runtime) and [Batching, loading, and errors](https://www.docx-editor.dev/docs/2.x/editor-api/batching-and-errors).

| Task | Guide |
| --- | --- |
| Read, insert, replace, or remove text | [Text and ranges](https://www.docx-editor.dev/docs/2.x/editor-api/text-and-ranges) |
| Split a paragraph with `insertText()` and `\n`, also as a tracked change | [Split a paragraph](https://www.docx-editor.dev/docs/2.x/editor-api/text-and-ranges#split-a-paragraph) |
| Find matches or use bookmarks | [Search and navigation](https://www.docx-editor.dev/docs/2.x/editor-api/search-and-navigation) |
| Set fonts, paragraph properties, styles, or links | [Formatting and styles](https://www.docx-editor.dev/docs/2.x/editor-api/formatting) |
| Create and configure lists | [Lists and numbering](https://www.docx-editor.dev/docs/2.x/editor-api/lists) |
| Work with table values, rows, columns, and cells | [Tables and cells](https://www.docx-editor.dev/docs/2.x/editor-api/tables) |
| Insert and resize images | [Inline pictures](https://www.docx-editor.dev/docs/2.x/editor-api/pictures) |
| Insert fields, write their cached results, or calculate PAGE and NUMPAGES | [Fields and pagination](https://www.docx-editor.dev/docs/2.x/editor-api/fields) |
| Insert an equation from OOXML | [Insert an equation](https://www.docx-editor.dev/docs/2.x/editor-api/text-and-ranges#insert-an-equation) |
| Propose a split, a field, or an equation as a tracked change | [Tracked changes](https://www.docx-editor.dev/docs/2.x/editor-api/revisions#propose-several-structural-edits-in-one-run) |
| Propose a model's paragraph rewrite as the fewest tracked changes | [Propose an AI rewrite](https://www.docx-editor.dev/docs/2.x/recipes/propose-rewrite), with `prepareRewrite` from `@docx-editor.dev/editor-api/agent` |
| Set page geometry and edit headers, footers, or notes | [Page layout and stories](https://www.docx-editor.dev/docs/2.x/editor-api/page-layout-and-stories) |
| Fill template controls and edit their metadata | [Content controls](https://www.docx-editor.dev/docs/2.x/editor-api/content-controls) |
| Discuss content and manage threads | [Comments](https://www.docx-editor.dev/docs/2.x/editor-api/comments) |
| Create, inspect, accept, or reject tracked changes | [Tracked changes](https://www.docx-editor.dev/docs/2.x/editor-api/revisions) |
| Find any public object, method, property, or support type | [API member directory](https://www.docx-editor.dev/docs/2.x/editor-api/reference) |

## On a server

The root entry opens DOCX bytes, edits the document, and returns the saved bytes.

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { DocxEditor } from '@docx-editor.dev/editor-api';

const runtime = await DocxEditor.createServer(await readFile('contract.docx'), {
  author: 'Review bot',
});
try {
  const filled = await runtime.run(async (context) => {
    const matches = context.document.body.search('{{cap}}', { matchCase: true });
    matches.load('items');
    await context.sync(); // Read the matching ranges.

    for (const match of matches.items) match.insertText('$500k', 'Replace');
    await context.sync(); // Commit all writes in one atomic batch.
    return matches.items.length;
  });
  console.log(`replaced ${filled}`);
  await writeFile('contract.filled.docx', await runtime.save());
} finally {
  runtime.dispose();
}
```

`createServer` parses the document before resolving and does not retain the input buffer. You can then reuse or transfer that buffer. Each `save()` returns an independent `Uint8Array`. Load the saved bytes into a live editor to display server edits.

## Create tracked changes on a server

Start with the [Office.js developer guide](https://github.com/eigenpal/docx-editor/blob/main/packages/editor-api/OFFICE_JS_GUIDE.md) for a complete server example and batching conventions.

Set `document.changeTrackingMode = 'TrackMineOnly'`, then use standard Office.js editing methods. Supply the agent's `author` when opening the server or collaborative runtime:

```ts
await runtime.run(async (context) => {
  const matches = context.document.body.search('within 7 days');
  matches.load('items');
  await context.sync();
  if (matches.items.length !== 1) throw new Error('Choose a unique target');

  context.document.changeTrackingMode = 'TrackMineOnly';
  const replacement = matches.items[0]!.insertText('within 30 days', 'Replace');
  await context.sync();
  replacement.load('text');
  await context.sync();
});
```

Use `range.insertText(text, 'Before' | 'After')` for insertions, and `range.delete()` or `range.clear()` for deletions. `insertText()` returns the inserted range. Mode assignments and edits commit together at `sync()`; failed batches preserve the previous mode and document. Load `document.changeTrackingMode` before reading it. `Off` is the initial mode.

This is a supported Office.js subset. `TrackMineOnly` applies to this server host and persists across its `run()` calls. It does not change peers' tracking settings or save a document-wide tracking policy. `TrackAll` fails with `NotSupported`. Browser tracked writes require the Pro review module; the runtime setting does not change the editor UI mode. Tracked text edits support one paragraph, including table-cell text, and adjacent sibling paragraphs outside collaboration. Tracked `Paragraph.delete()` and `Range.delete()` over whole paragraphs record deleted text and deleted paragraph marks, also in collaboration. Font, paragraph-format, paragraph-style, and `readingOrder` changes record property revisions, and paragraph insertion records inserted text and paragraph marks. Tracked edits can go inside or beside another author's pending text insertion or deletion, and each author's change stays a separate decision. The runtime refuses edits that touch your own pending change, another author's paragraph mark, formatting, move, or structural change, and text inside a row with a pending insertion or deletion. Tracked paragraph splits through `insertText()` with `\n`, fields through `insertField()` with results through `Field.result`, and one equation at a time through `insertOoxml()` produce native revisions. Other structural changes refuse while tracking. For the complete list, see [Revisions](https://docx-editor.dev/docs/2.x/editor-api/revisions). Comments and revision decisions remain available. Set `Off` explicitly when permanent edits are intended.

See the [server-agent review example](../../examples/server-agent-review/README.md) for Hocuspocus, stale-read handling, and the review lifecycle.

## In the browser

Pass an open core, React, or Vue editor to `createBrowser()`. Edits use the editor's undo history. Save through the owning editor.

```ts
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';

const runtime = DocxEditor.createBrowser(editor, { author: 'Demo Reviewer' });
try {
  await runtime.run(async (context) => {
    const heading = context.document.body.paragraphs.getFirstOrNullObject();
    heading.load('text');
    await context.sync();

    if (!heading.isNullObject) heading.font.bold = true;
    await context.sync();
  });
} finally {
  runtime.dispose();
}
```

Use the `/browser` entry for an open editor. Use the root entry on servers to exclude browser rendering code from the bundle.

Supply `author` for comments, replies, and tracked edits. Browser review writes also require the Pro review module and an editable document. Handle errors by `code`. See [Comments](https://www.docx-editor.dev/docs/2.x/editor-api/comments) and [Tracked changes](https://www.docx-editor.dev/docs/2.x/editor-api/revisions) for supported operations.

## Programming model

- Load properties before reading them. Load collection `items` before item properties.
- Batch independent writes with `sync()`. A failed batch applies no writes; earlier successful syncs remain committed.
- Sync after insertion before using the returned object.
- Keep proxies inside `runtime.run()`, or explicitly track and adopt them across runs.
- Search again after editing a paragraph. Existing ranges retain their original offsets.
- Check `isNullObject` after sync when using a null-object accessor.
- Check nullable font values and review dates before using them.

See [Batching, loading, and errors](https://www.docx-editor.dev/docs/2.x/editor-api/batching-and-errors) for transaction limits, proxy lifetimes, and error recovery.

## Office.js compatibility

The API implements a documented subset of the Office.js object model. It runs independently of Office and does not require a Microsoft package. See [Office.js compatibility](https://www.docx-editor.dev/docs/2.x/editor-api/office-js-api) for supported operations, runtime differences, and compatibility reports.

Server page-field updates require a measurer configured with font resources. See [Fields and pagination](https://www.docx-editor.dev/docs/2.x/editor-api/fields) for setup and a runnable report agent.

To upgrade from the former reviewer, bridge, MCP, or chat APIs, see [Migration](https://github.com/eigenpal/docx-editor/blob/main/packages/editor-api/MIGRATION.md).

## Packages

| Package | Description |
| --- | --- |
| [`@docx-editor.dev/react`](https://www.npmjs.com/package/@docx-editor.dev/react) | React adapter. `<DocxEditor>`, provider primitives, hooks, and compound chrome. |
| [`@docx-editor.dev/core`](https://www.npmjs.com/package/@docx-editor.dev/core) | Framework-agnostic engine: OOXML read/write, canonical document tree, layout, paint. |
| [`@docx-editor.dev/i18n`](https://www.npmjs.com/package/@docx-editor.dev/i18n) | Shared locale strings and types. |
| [`@docx-editor.dev/pro`](https://www.npmjs.com/package/@docx-editor.dev/pro) | Tracked changes, comments, and custom nodes. |
| [`@docx-editor.dev/editor-api`](https://www.npmjs.com/package/@docx-editor.dev/editor-api) | Supported Office.js subset for document editing on a server or in an open editor. |

## Which API for which job

| Job | Use |
| --- | --- |
| Build a review UI in the browser | The React or Vue adapter hooks, plus the review hooks and `DocxEditorReview` from `@docx-editor.dev/pro/react` or `@docx-editor.dev/pro/vue`. |
| Edit in a headless, server, or agent pipeline | The editing API in `@docx-editor.dev/editor-api`, which follows the Office.js object model. |

| Task | Browser host (React or Vue) | Headless, server, or agent |
| --- | --- | --- |
| [Comment on found text](https://www.docx-editor.dev/docs/2.x/recipes/comment-on-found-text) | `editor.findMatches`, `editor.selectMatch`, then `useReview().comment` | `body.search`, then `Range.insertComment` |
| Reply to a thread | `useReview().reply(item, text)` | `Comment.reply(text)` |
| [Record a tracked replacement](https://www.docx-editor.dev/docs/2.x/recipes/tracked-replacement) | Suggesting mode, then `editor.exec({ type: 'replaceMatch', match, text })` | `document.changeTrackingMode = 'TrackMineOnly'`, then `Range.insertText(text, 'Replace')` |
| [Propose an AI rewrite as tracked changes](https://www.docx-editor.dev/docs/2.x/recipes/propose-rewrite) | The same code through `DocxEditor.createBrowser` from `@docx-editor.dev/editor-api/browser` | `prepareRewrite` from `@docx-editor.dev/editor-api/agent` |
| [Accept or reject a change](https://www.docx-editor.dev/docs/2.x/recipes/accept-reject-without-scrolling) | `useReview().accept(item)` or `useReview().reject(item)` | `Revision.accept()` or `Revision.reject()` |
| [Open or reveal a change without scrolling](https://www.docx-editor.dev/docs/2.x/recipes/accept-reject-without-scrolling) | `useReview().setActive(key, { reveal: false })` | Not applicable: no viewport |
| [Highlight ranges](https://www.docx-editor.dev/docs/2.x/recipes/highlight-ranges) | `useHighlights(name, source, options)` | Not applicable |
| [Custom review rail cards](https://www.docx-editor.dev/docs/2.x/recipes/custom-review-cards) | `DocxEditorReview` with `preset` set to `false`, `useReview().items`, `useStackedReviewPositions`, and `useReviewRailMetrics` | Not applicable |
| Comment-on-selection button | `DocxEditorReview.AddComment` as a direct child of `DocxEditorReview`, or `useEditorCommand('review.addComment')` | Not applicable |
| Page setup and paragraph dialogs from a custom toolbar | `DocxEditor.PageSetupDialog` or `DocxEditor.ParagraphDialog` with `open` and a close handler (`onClose` in React, `@close` in Vue); enable the button from `usePageSetup().isEnabled` or `useParagraphFormat().isEnabled` | `Section.pageSetup`, and `Paragraph` properties such as `alignment` |

The review hooks need `reviewModule()` from `@docx-editor.dev/pro` in the editor's modules, and an editor `author` for comments and tracked changes. The editing API takes its author from the `author` option of `DocxEditor.createServer`, imported from `@docx-editor.dev/editor-api`, or of `DocxEditor.createBrowser`, imported from `@docx-editor.dev/editor-api/browser`.

This package ships the task recipes in [`docs/index.md`](./docs/index.md). They are also on the site: [Task recipes](https://www.docx-editor.dev/docs/2.x/recipes).

## License

This package uses the [EigenPal Pro License](https://github.com/eigenpal/docx-editor/blob/main/packages/editor-api/LICENSE.md). See [pricing](https://www.docx-editor.dev/pricing) for license and support options.

## Contributing

Contributions welcome. See [CONTRIBUTING.md](https://github.com/eigenpal/docx-editor/blob/main/CONTRIBUTING.md) for setup, tests, and the one-time CLA signature.

## Commercial support

> [!TIP] Questions or custom features? Email **[docx-editor@eigenpal.com](mailto:docx-editor@eigenpal.com)**.
