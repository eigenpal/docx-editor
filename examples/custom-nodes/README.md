# Custom nodes

An inline node type you define, stored as a Word content control. This example defines a legal
citation: insert one at the caret, see it painted as a chip, right-click to edit it, and save.

```bash
bun install
bun run build:packages   # from the repo root, once
bun run dev:custom-nodes # http://localhost:5179
```

Open any `.docx`, put the caret somewhere, and click **Insert citation**.

## What to read

| File | What it shows |
|---|---|
| `src/citation.ts` | `defineCustomNode`: identity, tag prefix, recognition, chip colour, sidebar card |
| `src/App.tsx` | Registering the module, `CustomNodeChrome`, the context menu, insert and update |

## The round trip

Save the document and open it in Word. The citation is an ordinary content control there, so
Word shows its text and gives it back untouched. Reopen the file here and `fromDocx` recognizes
it from the same `w:tag`.

A reader without your definition registered sees the control's content rendered literally,
which is also what Word does. Nothing is lost either way.

## Two things the API makes you handle

**Recognition input is untrusted.** `attrs` and `text` in `fromDocx` came out of a file whoever
sent it controls end to end. They are rendered as text and nothing builds a URL or DOM from
them.

**Writes report refusal.** `insertCustomNode` and `updateCustomNode` return an `ExecResult`
rather than throwing, so a locked range or a missing caret gives you `ok: false` and a reason
to show.

## Known limit

There is no schema-driven edit dialog. The host owns the form; `updateCustomNode` rewrites a
node in place from a node id, which is what `src/App.tsx` does.
