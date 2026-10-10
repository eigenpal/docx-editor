## Why

Collaboration stores every run as its own shared node. Text that a formatting split or an Enter moves into a new run is shared through split-text aliases: slices of the original run's text, kept alive so that a peer's concurrent typing in that run survives. This design converges on the fuzzer matrix, but three behaviors stay below what an editor that stores each paragraph as one shared text gives its users:

- A peer that deletes a selection covering a whole run removes the run node. Characters another peer types inside that run at the same time are lost for everyone.
- Two peers formatting the same text at once each split the run their own way. Split deduplication keeps one author's split, so bold from one peer and italic from the other is not bold italic. One author's formatting is lost.
- Two split histories of one source can claim the same characters after an undo, so those characters show twice and a later edit in them is refused (`everything`, peer delivery, seed 71).

Each of these comes from runs being nodes. Patching them one at a time adds more alias, adoption, and deduplication rules to a design that already has many. One shared text per paragraph removes the cause. This change also bumps the collaboration format, which the conflict-merge work in `concurrent-collaboration-conflicts` already requires, so rooms migrate once.

## What Changes

- Store the inline content of each paragraph as one shared text. Characters are text. Every inline element that is not plain text (tabs, breaks, fields, drawings, note references, bookmarks, comment range markers, and unknown inline content) is one embedded reference to a node in the existing node registry.
- Store run properties as formatting attributes on characters: one attribute for each child element of `w:rPr`, whose value is that element's exact XML. Concurrent formatting then merges property by property for each character.
- Store run identity as a character attribute, so a document's run boundaries, including boundaries between runs with equal formatting, survive editing and save. Run element attributes, such as revision save IDs, travel with that identity.
- Store inline wrappers (hyperlinks, tracked insertions and deletions, inline content controls, simple fields, smart tags) as a character attribute that lists the wrapper chain from outer to inner, with each wrapper's exact element in the node registry.
- Keep the node registry for paragraphs, tables, sections, parts, and every block-level structure, including moves, joins, adoption, and paragraph properties.
- Translate local canonical journals for paragraph children into text operations, and materialize paragraphs from text deltas into the canonical tree.
- Bump `sharedSchemaVersion` and `repairVersion`, and migrate saved rooms by reading the old room's document and seeding a new room generation from it.
- Remove split-text aliases, split deduplication, and run-level adoption from the paragraph path once the new representation passes every gate.

## Capabilities

### New Capabilities

- `paragraph-text-collaboration`: One shared text per paragraph with embedded inline nodes and per-character run, formatting, and wrapper attributes, gated by the existing fidelity oracles.

### Modified Capabilities

- `full-document-yjs-replication`: Paragraph inline content uses the shared paragraph text instead of run nodes. Block structure keeps the node registry.
- `durable-collaboration-rooms`: A room of the earlier format migrates to a new room generation of this format.

## Impact

- `packages/pro/src/collaboration/document/`: new paragraph-text schema, journal translation, and materialization. The split-text, split deduplication, and run adoption modules retire from the paragraph path.
- `packages/core`: no change to the canonical tree, layout, or editor. The primitive journal stays the replication boundary.
- Collaboration format: `sharedSchemaVersion` and `repairVersion` increase. Rooms of the earlier format refuse synchronization with this release and migrate through a new room generation. Releases carry a `Breaking collaboration upgrade` notice.
- Fidelity: canonical fingerprints and save/reopen semantic digests of the seed corpus must equal the earlier format's, byte for byte on non-XML parts.
