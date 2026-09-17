<p align="center">
  <a href="https://www.docx-editor.dev/">
    <img src="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/header.png" alt="DOCX Editor — .docx in, .docx out. Open source, client-side." width="500" />
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@docx-editor.dev/editor-api"><img src="https://img.shields.io/npm/v/@docx-editor.dev/editor-api.svg?style=flat-square&color=3B5BDB" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@docx-editor.dev/editor-api"><img src="https://img.shields.io/npm/dm/@docx-editor.dev/editor-api.svg?style=flat-square&color=3B5BDB" alt="npm downloads" /></a>
  <a href="https://github.com/eigenpal/docx-editor/blob/main/packages/editor-api/LICENSE.md"><img src="https://img.shields.io/badge/license-EigenPal_Pro_Evaluation_1.0-blue.svg?style=flat-square&color=3B5BDB" alt="license" /></a>
  <a href="https://docx-editor.dev/editor"><img src="https://img.shields.io/badge/Live_Demo-3B5BDB?style=flat-square&logo=vercel&logoColor=white" alt="Demo" /></a>
  <a href="https://www.docx-editor.dev/docs"><img src="https://img.shields.io/badge/Docs-3B5BDB?style=flat-square&logo=readthedocs&logoColor=white" alt="Documentation" /></a>
</p>

# @docx-editor.dev/editor-api

`@docx-editor.dev/editor-api` edits DOCX files through a supported subset of Word's JavaScript object model, including paragraphs, ranges, comments, and revisions. Use `load()` to queue reads and `sync()` to apply each batch atomically.

Run the API on a server over DOCX bytes or in the browser against an open editor. See [Office.js compatibility](https://www.docx-editor.dev/docs/2.x/editor-api/office-js-api) for supported members and differences from Word.

```bash
npm install @docx-editor.dev/editor-api @docx-editor.dev/core
```

Server use requires Node.js `^20.16.0 || >=22.3.0`.

## Guides by task

Start with [Runtime and setup](https://www.docx-editor.dev/docs/2.x/editor-api/runtime) and [Batching, loading, and errors](https://www.docx-editor.dev/docs/2.x/editor-api/batching-and-errors).

| Task                                                      | Guide                                                                                              |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Read, insert, replace, or remove text                     | [Text and ranges](https://www.docx-editor.dev/docs/2.x/editor-api/text-and-ranges)                 |
| Find matches, split paragraphs, or use bookmarks          | [Search and navigation](https://www.docx-editor.dev/docs/2.x/editor-api/search-and-navigation)     |
| Set fonts, paragraph properties, styles, or links         | [Formatting and styles](https://www.docx-editor.dev/docs/2.x/editor-api/formatting)                |
| Create and configure lists                                | [Lists and numbering](https://www.docx-editor.dev/docs/2.x/editor-api/lists)                       |
| Work with table values, rows, columns, and cells          | [Tables and cells](https://www.docx-editor.dev/docs/2.x/editor-api/tables)                         |
| Insert and resize images                                  | [Inline pictures](https://www.docx-editor.dev/docs/2.x/editor-api/pictures)                        |
| Calculate PAGE and NUMPAGES                               | [Fields and pagination](https://www.docx-editor.dev/docs/2.x/editor-api/fields)                    |
| Set page geometry and edit headers, footers, or notes     | [Page layout and stories](https://www.docx-editor.dev/docs/2.x/editor-api/page-layout-and-stories) |
| Fill template controls and edit their metadata            | [Content controls](https://www.docx-editor.dev/docs/2.x/editor-api/content-controls)               |
| Discuss content and manage threads                        | [Comments](https://www.docx-editor.dev/docs/2.x/editor-api/comments)                               |
| Create, inspect, accept, or reject tracked changes        | [Tracked changes](https://www.docx-editor.dev/docs/2.x/editor-api/revisions)                       |
| Find any public object, method, property, or support type | [API member directory](https://www.docx-editor.dev/docs/2.x/editor-api/reference)                  |

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
    await context.sync(); //  one atomic batch: all of the writes, or none
    return matches.items.length;
  });
  console.log(`replaced ${filled}`);
  await writeFile('contract.filled.docx', await runtime.save());
} finally {
  runtime.dispose();
}
```

`createServer` finishes its bounded parse before its promise resolves and does not retain the input `Uint8Array`; you may reuse or transfer that buffer afterward. Every `save()` returns a fresh, caller-owned `Uint8Array`, so transferring or mutating one result does not affect the runtime or a later save. Detached edits remain detached until your application explicitly loads the returned bytes into a live editor.

## Create tracked changes on a server

Start with the [Office.js developer guide](https://github.com/eigenpal/docx-editor/blob/main/packages/editor-api/OFFICE_JS_GUIDE.md) for a complete server example and batching conventions.

Set `document.changeTrackingMode = 'TrackMineOnly'`, then use standard Word editing methods. Supply the agent's `author` when opening the server or collaborative runtime:

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

This is a supported Office.js subset. `TrackMineOnly` applies to this server host and persists across its `run()` calls. It does not change peers' tracking settings or save a document-wide tracking policy. `TrackAll` fails with `NotSupported`. Browser tracked writes require the Pro review module; the runtime setting does not change the editor UI mode. Tracked text edits support one paragraph, including table-cell text. The runtime rejects targets touching pending revisions, including text inside a row with a pending insertion or deletion. The runtime also rejects structural and formatting changes while tracking. Comments and revision decisions remain available. Set `Off` explicitly when permanent edits are intended.

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

## Resolve revisions in a batch

Use `RevisionCollection.resolve('accept')` or `resolve('reject')` to process supported changes in one story. To select changes, pass revision objects as the second argument. API batches don't inherit editor filters. Read `result.value` after `context.sync()` for resolved and skipped decisions and the remaining count.

To require every change in the story to resolve, use `acceptAll()` or `rejectAll()`. These methods fail if any revision is unsupported. See [Resolve a batch of changes](https://www.docx-editor.dev/docs/2.x/editor-api/revisions#resolve-a-batch-of-changes) for examples and result handling.

## Range snapshots

Ranges retain the paragraph offsets where they were found. They do not follow later text edits inside those paragraphs, even when their proxies are tracked. After editing a paragraph, search again before acting on another target there. Use the range returned by `insertText()` after sync to address its inserted text. See [Text and ranges](https://www.docx-editor.dev/docs/2.x/editor-api/text-and-ranges) for snapshot and same-batch editing limits.

## Programming model

- Load properties before reading them. Load collection `items` before item properties.
- Batch independent writes with `sync()`. A failed batch applies no writes; earlier successful syncs remain committed.
- Sync after insertion before using the returned object.
- Keep proxies inside `runtime.run()`, or explicitly track and adopt them across runs.
- Check `isNullObject` after sync when using a null-object accessor.
- Check nullable font values and review dates before using them.

See [Batching, loading, and errors](https://www.docx-editor.dev/docs/2.x/editor-api/batching-and-errors) for transaction limits, proxy lifetimes, and error recovery.

## Office.js compatibility

The API implements a documented subset of Word's JavaScript object model. It runs independently of Office and does not require a Microsoft package. See [Office.js compatibility](https://www.docx-editor.dev/docs/2.x/editor-api/office-js-api) for supported operations, runtime differences, and compatibility reports.

Server page-field updates require a measurer configured with font resources. See [Fields and pagination](https://www.docx-editor.dev/docs/2.x/editor-api/fields) for setup and a runnable report agent.

To upgrade from the former reviewer, bridge, MCP, or chat APIs, see [Migration](https://github.com/eigenpal/docx-editor/blob/main/packages/editor-api/MIGRATION.md).

## Packages

| Package                                                                                    | Description                                                                                       |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| [`@docx-editor.dev/react`](https://www.npmjs.com/package/@docx-editor.dev/react)           | React adapter. `<DocxEditor>`, provider primitives, hooks, and compound chrome.                   |
| [`@docx-editor.dev/core`](https://www.npmjs.com/package/@docx-editor.dev/core)             | Framework-agnostic engine: OOXML read/write, canonical document tree, layout, paint.              |
| [`@docx-editor.dev/i18n`](https://www.npmjs.com/package/@docx-editor.dev/i18n)             | Shared locale strings and types.                                                                  |
| [`@docx-editor.dev/pro`](https://www.npmjs.com/package/@docx-editor.dev/pro)               | Tracked changes, comments, and custom nodes.                                                      |
| [`@docx-editor.dev/editor-api`](https://www.npmjs.com/package/@docx-editor.dev/editor-api) | Office.js-compatible editing API: a batching object model, on a server or against an open editor. |

## License

This package uses the [EigenPal Pro License](https://github.com/eigenpal/docx-editor/blob/main/packages/editor-api/LICENSE.md). See [pricing](https://www.docx-editor.dev/pricing) for license and support options.

## Contributing

Contributions welcome. See [CONTRIBUTING.md](https://github.com/eigenpal/docx-editor/blob/main/CONTRIBUTING.md) for setup, tests, and the one-time CLA signature.

## Commercial support

> [!TIP] Questions or custom features? Email **[docx-editor@eigenpal.com](mailto:docx-editor@eigenpal.com)**.
