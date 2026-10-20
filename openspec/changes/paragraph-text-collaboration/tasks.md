## 1. Prove the round trip without Yjs

- [x] 1.1 Define the linear form: characters, embeds, and the `run`, `text`, `rpr:*`, and `wrap` attributes.
- [x] 1.2 Linearize a canonical paragraph into the linear form and materialize it back.
- [x] 1.3 Pass the canonical fingerprint and save/reopen digest on every corpus document, or stop for review.

## 2. Shared paragraph text

- [x] 2.1 Add the paragraph text field to the schema; runs, text elements, run properties and wrappers are character attributes, and other inline elements are embedded records.
- [x] 2.2 Seed rooms in the new representation and materialize paragraphs from text deltas.
- [x] 2.3 Rebuild only paragraphs whose text or embedded nodes changed, and paragraphs whose shown IDs or moved text another paragraph's change affects.

## 3. Local edits

- [x] 3.1 Translate a journal that touches a paragraph's inline subtree by diffing the paragraph's linear form before and after.
- [x] 3.2 Write only the difference: inserted and deleted characters and changed attributes.
- [x] 3.3 Keep the projection of visible positions for block-level children unchanged.

## 4. Behavior

- [x] 4.1 Turn on the whole-run deletion and per-character formatting tests that are marked `todo`.
- [x] 4.2 Show text two peers move at once only once, and let text typed into a paragraph a peer joins away follow the move.
- [ ] 4.3 Pass every existing collaboration test, the fuzzer matrix, and new seeds for split, format, and undo interleavings.
- [x] 4.4 Pass the keystroke and remote-apply budgets on the 200-page fixture.
- [ ] 4.5 Move remote presence and undo selections to relative positions in paragraph text.

## 5. Format and migration

- [x] 5.1 Increase `sharedSchemaVersion` and `repairVersion`, and record a `migration-required` decision with migration instructions.
- [x] 5.2 Keep reading rooms of the earlier format through the record path, which materializes run records as before.
- [x] 5.3 Document the migration in the collaboration guide and add a `Breaking collaboration upgrade` notice.

## 6. Retire run-node machinery

- [ ] 6.1 Remove split-text aliases, split deduplication, and run adoption from the paragraph path.
- [ ] 6.2 Remove the presence text digest once relative positions replace it.
