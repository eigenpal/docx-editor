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

Compatibility is the full tuple `(protocolVersion, sharedSchemaVersion,
repairVersion, canonicalModelVersion)`, currently `(1, 3, 1, 1)`. The public
`DOCUMENT_COLLABORATION_VERSIONS` descriptor exposes the installed package's
supported tuple. The legacy `SCHEMA_VERSION` and `PROTOCOL_VERSION` exports belong
to experimental text-only collaboration and must not be used for full-document
room admission. Compatibility does not require identical package release numbers
when the declared tuple matches.

Join, receive, and server-side export check the room's tuple before interpreting
its shared representation. In particular, a v3 exporter must refuse v2 state:
v2 concurrent text overlays are not v3 source ranges, and treating them as such
can omit characters. These checks are not transport admission control. The host
must reject incompatible participants before accepting their Yjs updates, and
must apply the same policy to export jobs and returning offline clients.

Upgrade persisted rooms through a verified DOCX rather than relabeling Yjs state:

1. Freeze old-room writes and drain accepted updates. Back up its authoritative
   persisted Yjs state, external blobs if applicable, and readable version tuple.
   Resolve outstanding offline work before selecting the migration snapshot.
2. Export with the runtime compatible with that snapshot. Reopen the DOCX and
   verify expected text and document structures before using it as a baseline.
3. Deploy compatible participants and workers, then seed an empty Yjs document
   under a new provider room/storage key. Route the application document to that
   room. Do not rewrite version fields or replay old updates into it.
4. Verify the new room and export, then admit writes. Retain the old room and
   backup read-only. Keep stale clients and queued offline updates out; local
   persistence keys must distinguish the old and new room generations.

This transfers document content and starts new shared undo history. Before new
edits, rollback restores the old runtime and old snapshot together. After new
edits, first freeze and export or reconcile that work; v3 updates cannot be
replayed into a v2 room. A schema-mismatch error needs a compatible runtime or
this migration, not a reconnect to the same incompatible persisted room.
The public collaboration guide contains the host-facing upgrade procedure.

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
