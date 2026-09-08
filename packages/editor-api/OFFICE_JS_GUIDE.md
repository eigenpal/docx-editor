# Office.js patterns for server agents

The public document model follows a documented subset of Word's Office.js API. Host creation,
authentication, collaboration transport, and job lifetime belong outside that model.

## A complete server example

This function returns a DOCX containing one pending replacement. Supply the agent's author name.
The runtime owns the opened document and is always disposed.

```ts
import { DocxEditor } from '@docx-editor.dev/editor-api';

export async function redlineQuote(
  bytes: Uint8Array,
  quote: string,
  replacement: string,
  author: string
): Promise<Uint8Array> {
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

The same `run()` block works on `DocxEditor.createCollaborative(...)`. Its commits reach connected
peers through the collaboration session. See the [complete Hocuspocus worker](https://github.com/eigenpal/docx-editor/blob/main/examples/server-agent-review/README.md#copyable-server-integration)
for joining a room, waiting for outbound synchronization, and cleanup.

## Load deliberately and batch reads

Only load properties you will read. Navigation properties and property assignments do not need a preceding load.
Use `load('items')` before iterating a collection. Queue member loads together, then sync once:

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

This follows Microsoft's [split-loop and correlated-objects guidance](https://learn.microsoft.com/en-us/office/dev/add-ins/concepts/correlated-objects-pattern).
Bound model input and member-property loads. The collection's `items` load still enumerates its members;
the slice above does not promise server-side collection pagination.

A sync is needed before this implementation can address a newly returned proxy. For example, sync after
`insertText()` before loading its returned range. Nested collection loads and arbitrary dependent commands
within one batch are not yet supported. These limits are explicit; do not assume full Office.js behavior.

## Give each sync a purpose

A sync either supplies data for the next decision or commits a complete edit. Batch independent reads and writes.
For progressive agent review, one completed suggestion per sync is intentional: peers see each suggestion as it is ready.
For independent edits in different paragraphs, multiple edits can share one sync and one transaction.
Edits that claim the same paragraph can conflict; reconsider their anchors between commits.

Always await sync. Do not replace sequential syncs with `Promise.all()` or `forEach(async ...)`.
Use an explicit final sync when writes remain queued. Do not add an empty sync after a completed read-only batch.
These conventions follow Microsoft's [application-specific API model](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/application-specific-api-model).

## Keep proxy lifetimes clear

Keep document proxies within their `runtime.run()` callback. Return plain text or structured snapshots to the model,
not `Range` or `Paragraph` objects. Do not retain a proxy in a job record or reuse it after its run finishes.
Explicit tracked-object adoption exists for advanced cases; fresh reads are simpler for background workers.

If model generation happens inside a run, commit against the revision that run read. If it happens outside,
keep a validated snapshot and re-anchor in a new run. The example's tool adapter checks both the paragraph snapshot
and document digest. On `StaleDocument`, read again and reconsider the proposal. Do not blindly replay old text.

## Use errors to recover deliberately

Use `isDocxEditorError(error)` and branch on `error.code`. `error.target` identifies the failing public member.
Do not parse message strings. A refused sync does not apply its queued document edits or tracking-mode changes.
Earlier successful syncs remain committed. Failed batches are discarded and are never automatically replayed.

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

| Intent                               | Office-shaped API                                                      |
| ------------------------------------ | ---------------------------------------------------------------------- |
| Track this server agent's text edits | `context.document.changeTrackingMode = 'TrackMineOnly'`                |
| Insert before or after a range       | `range.insertText(text, 'Before')` or `'After'`                        |
| Replace a range                      | `range.insertText(text, 'Replace')`                                    |
| Delete range content                 | `range.delete()` or `range.clear()`                                    |
| Read the current mode                | `document.load('changeTrackingMode')`, then sync and read the property |
| Make an intentional permanent edit   | Explicitly set `changeTrackingMode = 'Off'`                            |

`Off` is the initial server mode. `TrackMineOnly` needs a configured author and persists for that host session.
It does not change peers' editing modes or persist a document-wide policy. `TrackAll` and browser-host mode control refuse.
Tracked edits support inline text in one paragraph, including table cells, and refuse targets touching pending revisions.
Structural and formatting mutations while tracking refuse. Comments and revision decisions remain available.
Never silently fall back to `Off` when an edit cannot be tracked.

Standard `insertText('', 'Replace')` means deletion, and an empty insertion is a no-op. Agent tools should require
nonempty insertion/replacement text and expose deletion as an explicit model decision. The shipped worker does this.
The [compatibility manifest](https://github.com/eigenpal/docx-editor/blob/main/packages/editor-api/compat/manifest.json) records measured members and behavioral differences.
