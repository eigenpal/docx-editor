# Office.js patterns for server agents

The public document model follows a documented subset of Word's Office.js API. Host creation, authentication, collaboration transport, and job lifetime belong outside that model.

## A complete server example

This function returns a DOCX containing one pending replacement. Supply the agent's author name. The `finally` block disposes the runtime after the job.

```ts
import { DocxEditor } from '@docx-editor.dev/editor-api';

export async function redlineQuote(
  bytes: Uint8Array,
  quote: string,
  replacement: string,
  author: string
): Promise<Uint8Array> {
  if (typeof replacement !== 'string' || replacement.length === 0) {
    throw new Error('Replacement text is required. Use an explicit deletion to remove the quote.');
  }
  const runtime = await DocxEditor.createServer(bytes, { author });
  try {
    await runtime.run(async (context) => {
      const matches = context.document.body.search(quote, { matchCase: true });
      matches.load('items');
      await context.sync();
      if (matches.items.length !== 1) throw new Error('Choose one unique quote');

      context.document.changeTrackingMode = 'TrackMineOnly';
      matches.items[0]!.insertText(replacement, 'Replace');
      await context.sync();
    });
    return await runtime.save();
  } finally {
    runtime.dispose();
  }
}
```

The same `run()` block works on `DocxEditor.createCollaborative(...)`. Its commits reach connected peers through the collaboration session. See the [complete Hocuspocus worker](https://github.com/eigenpal/docx-editor/blob/main/examples/server-agent-review/README.md#copyable-server-integration) for joining a room, waiting for outbound synchronization, and cleanup.

## Load deliberately and batch reads

Only load properties you will read. Navigation properties and property assignments do not need a preceding load. Use `load('items')` before iterating a collection. Queue member loads together, then sync once:

```ts
const snapshot = await runtime.run(async (context) => {
  const paragraphs = context.document.body.paragraphs;
  paragraphs.load('items');
  await context.sync();

  const page = paragraphs.items.slice(0, 40);
  for (const paragraph of page) paragraph.load('text');
  await context.sync();
  return page.map((paragraph) => paragraph.text);
});
```

This follows Microsoft's [split-loop and correlated-objects guidance](https://learn.microsoft.com/en-us/office/dev/add-ins/concepts/correlated-objects-pattern). Bound model input and member-property loads. The collection's `items` load still enumerates its members; slicing the array does not paginate the collection on the server.

Supported read-derived proxies can share one `sync()` with their edits. For example, `body.getRange().insertText(text, 'Replace')` and `table.getCell(0, 0).value = text` resolve their reads before one atomic write transaction. This can use extra read-only transport calls. Every phase uses the same revision; concurrent changes cause `StaleDocument`.

Proxies returned by insertions require a completed `sync()` before dependent operations. Do not configure a newly inserted table, image, list, or text range before that sync. If a prerequisite fails, the runtime commits no queued writes. Completed prerequisite reads can remain loaded after a later command fails.

## Preserve Office.js enum property types

Like Office.js, `Document.changeTrackingMode` and `PageSetup.orientation` use unions of the enum and its string literals for both reads and writes. Enum constants and the corresponding string literals are accepted by the type system. This matches Microsoft's [change-tracking declaration](https://learn.microsoft.com/en-us/javascript/api/word/word.document#word-word-document-changetrackingmode-member) and [page-orientation declaration](https://learn.microsoft.com/en-us/javascript/api/word/word.pagesetup#word-word-pagesetup-orientation-member).

Let TypeScript infer a property's type, or use an indexed-access type when saving its value. An enum-only annotation is narrower than the Office.js property type:

```ts
import { ChangeTrackingMode, type Document } from '@docx-editor.dev/editor-api';

const mode = await runtime.run(async (context) => {
  context.document.load('changeTrackingMode');
  await context.sync();
  const current: Document['changeTrackingMode'] = context.document.changeTrackingMode;
  return current;
});
const trackingMine = mode === ChangeTrackingMode.trackMineOnly;
```

For orientation, use `PageSetup['orientation']` in the same way after loading and syncing that property. Type compatibility does not imply support for every enum value: `TrackAll` fails with `NotSupported` at `sync()`.

## Give each sync a purpose

A sync either supplies data for the next decision or commits a complete edit. Batch independent reads and writes. For progressive agent review, one completed suggestion per sync is intentional: peers see each suggestion as it is ready. For independent edits in different paragraphs, multiple edits can share one sync and one transaction. Edits that claim the same paragraph can conflict; reconsider their anchors between commits.

Always await sync. Do not replace sequential syncs with `Promise.all()` or `forEach(async ...)`. Use an explicit final sync when writes remain queued. Do not add an empty sync after a completed read-only batch. These conventions follow Microsoft's [application-specific API model](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/application-specific-api-model).

## Keep proxy lifetimes clear

Keep document proxies within their `runtime.run()` callback. Return plain text or structured snapshots to the model, not `Range` or `Paragraph` objects. Do not retain a proxy in a job record or reuse it after its run finishes. Explicit tracked-object adoption exists for advanced cases; fresh reads are simpler for background workers.

If model generation happens inside a run, commit against the revision that run read. If it happens outside, keep a validated snapshot and re-anchor in a new run. The example's tool adapter checks both the paragraph snapshot and document digest. On `StaleDocument`, read again and reconsider the proposal. Recheck the target before retrying.

## Use errors to recover deliberately

Use `isDocxEditorError(error)` and branch on `error.code`. `error.target` identifies the failing public member. Do not parse message strings. A failed sync does not apply its queued document edits or tracking-mode changes. Earlier successful syncs remain committed. Failed batches are discarded and are never automatically replayed.

| Code                 | Next action                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `PropertyNotLoaded`  | Load the named property and await sync before reading it.                                                           |
| `InvalidObjectPath`  | Sync before using a newly returned proxy, or acquire a fresh proxy in a new run.                                    |
| `StaleDocument`      | Re-read, re-anchor, and reconsider the model proposal.                                                              |
| `ConflictingChanges` | Separate edits that claim the same paragraph and reconsider anchors between commits.                                |
| `NotSupported`       | Check the host, tracking mode, author, and operation against the subset below.                                      |
| `NotImplemented`     | Check the documented subset, including pending-revision boundaries. Reconsider the target; do not disable tracking. |
| `InvalidArgument`    | Validate the argument and consult the member's JSDoc.                                                               |

## Tracking subset

| Intent                             | Office.js-compatible API                                               |
| ---------------------------------- | ---------------------------------------------------------------------- |
| Track this agent's text edits      | `context.document.changeTrackingMode = 'TrackMineOnly'`                |
| Insert before or after a range     | `range.insertText(text, 'Before')` or `'After'`                        |
| Replace a range                    | `range.insertText(text, 'Replace')`                                    |
| Delete range content               | `range.delete()` or `range.clear()`                                    |
| Read the current mode              | `document.load('changeTrackingMode')`, then sync and read the property |
| Make an intentional permanent edit | Explicitly set `changeTrackingMode = 'Off'`                            |

`Off` is the initial runtime mode. Browser tracked writes require the review module; this property does not change the editor UI mode. `TrackMineOnly` needs a configured author and persists for that host session. It does not change peers' editing modes or persist a document-wide policy. `TrackAll` fails with `NotSupported`. Browser UI modes remain controlled by the editor host. Tracked edits support inline text in one paragraph, including table cells. The runtime rejects targets that touch pending revisions. The runtime rejects tracked deletion or replacement of simple fields containing nested fields or other result containers. Direct result runs remain supported. The runtime rejects structural and formatting edits while tracking changes. Comments and revision decisions remain available. Never silently fall back to `Off` when an edit cannot be tracked.

Standard `insertText('', 'Replace')` means deletion, and an empty insertion is a no-op. Agent tools should require nonempty insertion/replacement text and expose deletion as an explicit model decision. The shipped worker does this. The [compatibility manifest](https://github.com/eigenpal/docx-editor/blob/main/packages/editor-api/compat/manifest.json) records measured members and behavioral differences.

## Pictures and page fields

Insert PNG or JPEG images with `range.insertInlinePictureFromBase64(data, 'After')`. Sync before setting properties on the returned picture. Width and height use points. New pictures lock the aspect ratio. Set `lockAspectRatio = false` before setting independent dimensions. Set `altTextDescription` to describe the image. Deletion preserves shared media relationships.

Insert a page field with `range.insertField('After', 'Page')` or `'NumPages'`. Sync before using the returned field. `field.code = 'NUMPAGES'` changes its instruction; `field.updateResult()` computes and stores its result. These calls use separate syncs. Field updates can share a sync with other field updates. They cannot share a sync with layout-changing writes.

Headless field calculation requires an explicit `pagination.measurer` when creating the server runtime. Use measurements from the document's fonts. Browser runtimes use the editor's measured layout. Without pagination, `updateResult()` fails with `NotSupported`. Other field instructions remain inert. The authoring subset refuses unsupported field codes and formatting switches.

Character formatting also supports underline, strikethrough, exact Word-palette highlighting, subscript, and superscript. `font.underline = 'None'` removes an underline. Setting one script mode to `true` clears the other mode. The highlight setter keeps Office's pinned `string` type, although Microsoft documents runtime `null` for clearing. The runtime accepts this clearing value. The runtime rejects unsupported highlight colors.

The workflow tests cover both hosts and save/reopen: `model-font-editing.test.ts`, `model-pictures.test.ts`, `model-fields.test.ts`, and `model-picture-field-parity.test.ts`. The final test includes primary footer creation and a saved `NUMPAGES` result.
