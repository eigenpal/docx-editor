# Concurrent run splits

Issue #592 concerns repeated formatting of the same run by different peers.
Canonical formatting replaces runs with partitioned text copies. The previous shared
representation also treated those copies as independent character sequences.
It hid losing run sets after the first race, but later journals addressed visible
child indices against arrays that still contained hidden runs.

The shared schema now separates run structure from character ownership:

- Each split generation records its immediate origin and immutable ancestry.
  The earliest replica identifier wins each generation. Losing descendants stay
  hidden after further splits. An undone split loses its candidacy, even when
  another author owns descendants. Restoring the original run hides all products.
- Text products reference ranges of the original `Y.Text` through relative
  character positions. Nested splits flatten those references. Formatting does
  not create a second editable character sequence.
- Journal projection translates visible child indices and text ranges before
  shared writes. It validates every effect before mutation. Hidden child entries
  remain available for undo. Compound edits replay ambiguous deleted anchors in
  a disposable Yjs document when numeric coordinates cannot preserve ownership.
- Plain insertion and deletion retain canonical text-leaf identities. Full
  deletion clears shared characters before removing the empty container.
- Boundary insertions retain the selected run's formatting. Undo publishes
  restored character anchors because Yjs's local `redone` links do not replicate.
- Retained node containers keep an immutable initial descriptor. Mutable
  descriptors still undo normally, including renames back to their initial name.

The canonical tree remains the document source of truth. These aliases and
ancestry fields exist only in collaboration state; DOCX exports contain ordinary
WordprocessingML. The materializer projects shared character ranges into that tree.

Single text edits do not traverse historical split branches. Structural and
provenance changes invalidate the split visibility cache. Boundary edits avoid
rewriting unchanged anchors, including source start and end sentinels.

Shared schema version 3 requires a coordinated participant upgrade. New clients
reject incompatible persisted rooms. Export older rooms with their existing
release, then seed new rooms from DOCX after upgrading. This starts new shared
undo history.

Regression coverage includes multiple formatting rounds, concurrent typing and
deletion, both replica winner orders, undo/redo, cold joins, saved package
convergence, headers, tables, wrappers, fields, tabs, and multiple text leaves.
Independent review also checks malformed journal refusal and typing costs.

Existing structural concurrency limits remain separate from these text ranges.
Concurrent whole-run formatting can create duplicate `w:rPr` containers when none
existed. Concurrent tab or break insertion can lose the inserted atom. A tracked
insertion racing with formatting after an earlier split can appear at the wrong
position. Each history also fails on the baseline revision `10a3d415e`.
These cases need shared placement rules for property containers and revision or
atomic content, beyond plain character ownership.

For the property-container case, seed one run containing `ABCDEFGHIJKLMNOPQRSTUVWXYZ`
without `w:rPr`. Pause synchronization. Apply bold to `[0,26)` on one peer and
italic to `[0,26)` on the other. Resume synchronization. Both property containers
survive, which violates the run invariant.

For structural insertion, seed one colored run containing
`ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`. Race bold ranges `[0,5)` and `[3,9)`, then
synchronize. In the next paused round, insert a tab, hard break, or tracked `!` at
position 15 on one peer. Apply bold to `[10,23)` on the other, then synchronize.
The inserted atom disappears, or the tracked text shifts toward the earlier split
boundary. The baseline also fails these histories, sometimes with duplicated text.
