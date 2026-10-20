# Edit memory profiler

`bun run memory:edits` tells you whether editing a document keeps growing the heap, and
what holds the memory that grows. It opens a `.docx` file in the demo in Chrome, runs three
batches of one kind of edit, and takes a V8 heap snapshot after each batch.

The undo history keeps every old tree revision alive. A cache that keys answers by node
identity keeps an entry for every revision of an edited node, so memory can grow with each
edit even when nothing is wrong with the edit itself. This tool finds those caches.

## Run the profiler

1. Start the demo:

   ```bash
   bun run dev
   ```

1. In a second terminal, run the profiler on a document:

   ```bash
   bun run memory:edits -- --file path/to/document.docx --edits enter
   ```

The tool prints the heap after each batch, the growth per edit in the last batch, the named
caches that grew, and the leak clusters from [memlab](https://facebook.github.io/memlab/).
It writes the snapshots, `summary.json`, and `memlab-report.txt` to `local/memory-profile`,
which git ignores.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `--file` | | The document to open. |
| `--edits` | `enter` | The edit kind: `enter`, `toggle`, `type`, or `mixed`. |
| `--batches` | `20,40,60` | The edit counts at the three snapshots. |
| `--url` | `http://localhost:5173` | The demo address. |
| `--out` | `local/memory-profile` | The output directory. |
| `--min-retained` | `20000` | The smallest retained size, in bytes, that memlab reports. |
| `--max-kb-per-edit` | | If set, the tool exits with status 1 when the last batch grew the heap by more than this per edit. |
| `--channel` | `chrome` | The Playwright browser channel. |

## Read the results

- **Last batch.** The heap growth per edit between the second and third snapshots. The
  edits themselves add a little memory, because the undo history keeps up to 200 revisions.
  A growth that stays the same size as the document grows, or that does not slow down, is a
  leak.
- **Named caches.** The `Map`, `WeakMap`, `Set`, and `WeakSet` objects held by a module or
  closure variable, by the variable name, and how much more each one retains per edit. Search
  the code for the variable name.
- **memlab clusters.** Objects allocated during the second batch that are still alive after
  the third, grouped by retainer path. Each path names the variables and properties that hold
  the memory. The current layout is always alive, so a path that ends in the live layout
  session is usually expected.

## Fix patterns

- A cache keyed by a node whose answer grows with the subtree (every id under the body, every
  row of a table) keeps one copy per revision. Use `createSubtreeAggregateMemo` from
  `packages/core/src/store/package/subtree-memo-policy.ts`, which keeps a large answer only for
  the latest revision of its node id.
- A cache keyed by a table can key by the table's `w:tblPr` node instead, which edits share,
  and check the table identity on read.
- A memo that stores an input object only to compare it later can store a numeric id for it.
- In V8, every closure created in one function call shares one context. If any closure in the
  call names a variable, every closure from that call keeps it alive. Do not name an older
  cache entry in a closure next to callbacks that a new result keeps.
