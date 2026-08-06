# Design

## Why the operation lives in automation

Pro reaches the document through `session.applyTreeOps` and nothing else, so it cannot author a package part. That is deliberate: `TreeDocumentStore.transact` is the only write path. The payload write needs package scope, which leaves two places it could go.

Putting it on the editor session makes the browser the real implementation, and the headless host — the one a server uses through `DocxEditor.createServer` — either reimplements it or does without. That is the split that produces two behaviors from one feature.

Putting it in `core/automation` means both hosts answer the same operation, because that lane exists for exactly this: one interface, a headless implementation owning bytes and a browser implementation borrowing the live session, with the operations implemented once above the protocol. It is also already transport-shaped, so the same write works behind a worker port or an HTTP boundary.

## Why the store is the source of truth

Word paints a bound control's text from the xpath and will not let a user type into it (verified, `sdt-custom-node-databinding-word-roundtrip.docx`). So the payload cannot drift from what the reader sees, and nothing has to detect or reconcile a disagreement.

This is worth stating as a constraint rather than a convenience, because it is what makes the rest simple. Two consequences follow:

- The `<label>` in the store must always carry the exact display text. An empty label is an empty chip.
- Per-run formatting inside `sdtContent` that is not reproducible from `sdtPr/rPr` does not survive a Word save, since Word regenerates the run.

## Why the sweep runs on open and not on save

A sweep collects nodes nothing binds. On save that is wrong: a chip cut to the clipboard is unbound for as long as it sits there, so saving mid-cut destroys the payload the user is about to paste.

On open, the only unbound nodes are ones a control genuinely lost — deleted here, or deleted in Word, which is the case nothing else can collect. Deletion inside the editor removes the node directly in the same transaction, so the sweep is a backstop rather than the mechanism.

## Why `preserveOnExport` is three values

`true` and `false` are obvious. `'text'` exists because the interesting case is neither: a citation whose text is the point, carried by markup that means nothing outside the system that wrote it. Unwrapping keeps the sentence and drops the identity. Modelling that as a second boolean would make `false` mean two different things depending on the other flag.

## What this does not make anonymous

`preserveOnExport` removes this library's markup and nothing else. A `.docx` carries origin in `docProps/app.xml`, `docProps/core.xml`, comment and revision authors, rsids and custom document properties. Describing this as "no traces" would be false, and the distinction belongs in the docs as much as in the code.

## Why the export is its own call rather than a `save()` flag

`preserveOnExport` is applied by `exportCustomNodes(bytes, definitions)`, not by `Editor.save()`.
The proposal already implies it — "the save that applies it picks the pipeline" — and the shape
follows from what the option is FOR: the document at rest has to keep its tags, bindings and
payloads, or reopening it here gives back a page of plain text instead of chips. A flag on `save()`
would make a host choose one behaviour for both, and either choice is wrong for the other case.

A separate call also works where the editor is not: a server that assembled a document with
`customNodeXml` can strip it the same way, with the same definitions, and never mount anything.
