## Context

The collaboration shared state is a flat Yjs map of node records (`docx-package-nodes-v1`). Each record holds a kind, a qualified name, attributes, namespace bindings, and either a child-ID array or a `Y.Text`. The registry keeps derived indexes (parents, listings, adoption), and the materializer rebuilds changed subtrees into the canonical OOXML tree. Local edits reach shared state as canonical primitive journals, projected from the editor's visible tree onto shared positions.

Runs are records. A format split or an Enter inside a run replaces the run with new runs, and the new runs alias slices of the original text (`splitTextSource`) so that concurrent typing in the original survives. Concurrent splits of one run are deduplicated by split lineage. A join tombstones a paragraph and its survivor adopts the children it still lists.

The representation spike for `full-document-yjs-collaboration` rejected nested Yjs XML because a move loses concurrent edits inside the moved element. This design keeps the registry for every block and changes only what is inside a paragraph.

## Goals / Non-Goals

**Goals:**

- Concurrent typing inside text that a peer deletes survives, character by character.
- Concurrent formatting merges property by property for each character.
- No shared state can show one character twice.
- Saved documents are unchanged: the canonical fingerprint and the save/reopen semantic digest of every corpus document equal the earlier format's.
- Keystroke and remote-apply budgets of `collaboration-budgets.json` still pass.

**Non-Goals:**

- Changing the canonical tree, layout, or the editor's operations.
- Shared text for blocks: tables, rows, cells, sections, and parts stay registry records.
- Character-level merge inside an embedded object, such as a drawing's properties. An embedded object's own subtree keeps the registry rules.

## Decisions

### Invariants

Every rule below serves these guarantees, in this order of precedence. The fuzzer in `benchmarks/collaboration-server` checks each of them on every run.

1. Every replica that holds the same updates shows the same document, and so does a replica that joins later or a server export.
2. Text a participant typed shows exactly once, unless a participant deleted it, or the paragraph that holds it was deleted.
3. Text a participant deleted stays deleted. Only that participant's undo brings it back.
4. A participant's caret and their typing stay where they were, as far as the other edits allow.

When concurrent edits leave no place that satisfies all of these, the lower guarantee gives way. Typed text can then stand a few words from where it was typed: that is a conflict, every replica shows the same result, and the participant can move the text. Text never shows twice and is never lost to make placement exact.

### One shared text per paragraph

A paragraph record keeps a child array for its paragraph properties only, and gains a `Y.Text` that holds everything inline, in document order:

- Each character of a `w:t`, `w:delText`, `w:instrText`, or `w:delInstrText` element is a character of the shared text.
- Every other inline element is one embed: `{ node: <logical id> }`. The node and its subtree stay registry records, so a drawing, a field character, a note reference, a bookmark marker, or an unknown element keeps its exact XML and its registry rules, including moves. A run that holds no content is one embed of an empty anchor node.

Alternative: one `Y.Text` per run. Rejected: a run boundary is then still a node boundary, and deleting a run still deletes its concurrent text.

### Attributes carry run identity and properties

Each character and embed carries attributes:

| Attribute | Value | Purpose |
| --- | --- | --- |
| `run` | Logical ID of the run record | Run boundaries and run element attributes |
| `text` | Logical ID of the text element record | `w:t` boundaries and `xml:space` |
| `rpr:<namespace>:<local name>` | Exact XML of one `w:rPr` child | Per-property formatting |
| `wrap` | Wrapper IDs, outer to inner | Hyperlinks, revisions, inline content controls, simple fields |

The run record keeps its own attributes and the original order of its `w:rPr` children. A property that a peer adds goes to its schema position among the recorded order. Two peers setting the same property on one character is the only formatting conflict. Yjs keeps one value for every replica.

Attributes live in Yjs formatting markers, and no replica removes a marker. Yjs deletes the markers that look redundant on one replica, after every remote update and around every deletion, and a peer's concurrent insert behind such a marker then lost its run and text element on every replica. Each replica therefore turns that cleanup off for its document, and writers delete only characters and embeds. Redundant markers stay, and the text reads the same attributes.

A wrapper record keeps the wrapper's fixed children, such as `w:sdtPr`. When the next ID in a chain is one of those children, such as `w:sdtContent`, the content goes inside it. Otherwise the content follows the fixed children.

### Local edits become text operations by diff

A journal that touches a paragraph's inline subtree is translated into operations on that paragraph's text. The registry linearizes the paragraph before the edit from shared state, and the session linearizes the editor's paragraph after the edit. The diff of the two linear forms gives insertions, deletions, and attribute changes. A journal with one `spliceText` on a text element takes a fast path: one insert or delete at the element's offset in the paragraph.

Alternative: a translation rule for each primitive effect. Rejected: run splits, wrapper edits, and moves combine primitives in too many ways. The diff handles each combination the same way.

Shared text counts UTF-16 code units, and Yjs replaces a half of a surrogate pair that an edit cuts off with U+FFFD on the replica that receives it. The diff therefore compares code points: it keeps, deletes, or inserts both halves of a pair together, and never places an edit between them.

### Materialization groups the delta

The materializer reads a paragraph's delta and groups consecutive items by wrapper chain, then by run, then by text element. It builds wrappers from their records, runs from their records plus the run's formatting attributes, and text elements from their records. An embed materializes its node's subtree in place. Only paragraphs whose text or embedded nodes changed are rebuilt.

### Moved text keeps an identity

Splitting or joining paragraphs deletes characters from one shared text and inserts them into another. Each character has an identity: its own Yjs item ID, or for a moved copy the identity of the character it copies. A mark on the copy's insert names the identity of its first character, so each copied character's identity follows from its clock. Identities read only item IDs, item order, and marks, which every replica holds alike; how a replica stores deleted items is its own, because garbage collection merges them.

Marks live in one document map, `docx-text-marks-v1`, keyed by the insert they describe: a copy, characters an undo put back, or typed text and the character it follows. Each key belongs to one insert, so two peers never write one key, and Yjs keeps every entry. Formatting markers in the text did neither: a format key holds one value at a place, so two peers' marks at one place overrode each other, and Yjs removes a marker that another marker of the same key follows at once.

A mark names the item it copies, and that item can have a mark of its own: a copy of a copy, or a copy of characters an undo put back. An undo writes its marks after the undo, so a peer can copy the put-back characters before their marks arrive. An identity therefore resolves through the chain of marks on every read, up to a fixed depth, and a mark that arrives late repairs every copy made before it. When a mark changes without its text, every paragraph whose identities read through it reads again: the one that holds the marked insert, and those that hold copies whose marks lead to it.

With identities, every replica decides alike which copy shows:

- A moved copy shows in the last paragraph in document order that holds a copy of its character, and once there. Two peers that split one text at once each make a copy; the later paragraph holds the text after both splits, so the text keeps its order. A join that races a split of the joined paragraph leaves the split's tail where it was.
- An undo or redo puts a deleted character back as a new item. The replica that undid marks it with the identity of the item it replaces, and a moved copy outranks it, so a peer's concurrent move keeps the text where that peer moved it.
- A character in its first place hides behind any copy of it.
- Text a peer typed while another peer moved the text around it away follows the move: it shows after the copy of the character it was typed after. A deleted paragraph, or one no parent lists any more after an undo, shows nothing else. In a live paragraph, the text that follows hides where it was typed.
- In a deleted paragraph, moved text that shows nowhere else follows the character it went in after. Two peers that join one paragraph at once, one into the paragraph before it and one taking in the paragraph after it, leave the second join's copies in a paragraph the first deleted. Text the paragraph held from the start never follows this way, so a paragraph deleted on purpose does not come back. A copy whose original another paragraph still holds does not follow either: the original shows, or, typed into another gone paragraph, follows by its own anchors.
- A paragraph shows each character once. Following text drops the characters the paragraph already shows, and of two pieces that carry one character, the first in their one order keeps it. In a gone paragraph, an original whose copy the paragraph also holds does not follow; the copy does.
- Text never follows a character whose copy shows in its own paragraph. A split and a join back write moved copies into the paragraph that holds the originals, and text a peer typed among the originals then stands in front of the copies: a placement conflict. Following there was tried and reordered a single participant's own typing, because a formatting change and an undo also leave copies in the same paragraph.
- Two peers who each write a paragraph's following text into it leave two copies of it, and the later copy hides. What only the hidden copy holds, as one peer's typing in it, stands right after a hidden character; it moves to stand after the copy of that character that shows.
- Embeds, as line breaks and pictures, follow as characters do. An embed names one record, so the writer moves it rather than copying it.

Which character text was typed after is read from Yjs origins: the clock before, or the item's origin for its first clock. That reads alike on every replica, because garbage collection merges an item only with the item typed right after it. Two cases need more:

- An undo of a move deletes the copy, and with it the identity that text typed next to the copy was typed after. Text typed right after a copy, or at the start of a paragraph before one, carries a follow mark that names the copy's identity.
- Yjs places text typed after a deletion behind the deleted characters, where text typed before a peer's move of them would also be. When any character the text was typed after, live or deleted, has a shown copy, in its own paragraph or another, the typed text carries a follow mark that names the character the typist saw to its left, so it stays. A live neighbor counts too: deleting it later exposes the moved characters behind it. A copy in the same paragraph counts as well: a join copies a split's tail back behind its deleted originals, and a later split moves the copies on.

Moves are found by matching inserted text against text the same edit deleted from another paragraph. A run inserted whole as another paragraph deleted it is that run moved, whatever text elements the split gives its letters. Then stretches equal in character and text element match, and last, by value, whole stretches the earlier passes left, because a split gives its tail a new run. A short piece of the same letters elsewhere never matches.

A peer's text can embed a record whose update has not arrived yet. While Yjs holds back an update, an embed without a record shows nothing and is not reported as lost; the record's arrival reads the paragraphs that hold it again.

A walk along origins stops after a fixed number of clocks, never after a number of characters: a replica that still holds a deleted format marker skips it, and one that collected it counts it, so a character limit would cut replicas' walks at different places.

The view and the writer show an embed only when its record exists and is live, as the materializer does. A write diffs the paragraph's shared text against the editor's tree. It tries both tie-breaks of the alignment and keeps the one that keeps more characters. In a gap whose letters are equal, only the embeds change, as when a comment's range markers go in. Text a write deletes and inserts again in one paragraph keeps its identities. A write that would give a paragraph a text while a held-back update still sets one is refused and taken back in the same tick.

Text typed into a paragraph that shows no character names none in its follow attribute (`-`), so it stays where it was typed. A paragraph record without shared text yet is still a paragraph: an edit of its inline content creates its text and never writes run records.

Text typed before a copy, at the start of a paragraph, follows that copy only out of a paragraph that is gone. A split moves a suffix, so text after a character it moves always moves with it, but text before that character stays where its author saw it. Text typed at the start of a paragraph without a follow mark can follow what it was typed in front of, by its Yjs right origin, and also only out of a paragraph that is gone: a peer's join into the paragraph before it deletes it. Only that one character counts. Following text never anchors on other following text, so walking on through deleted characters reached text that shows elsewhere only through a chain, and replicas that relocated in another order placed it differently.

A write first makes the following text of its paragraphs their own, then writes them. A piece whose anchor shows only inside other following text of the same paragraph goes in after that text's new copy of the anchor, once that text is written. Written after the hidden anchor, it hid again in the same write, which then wrote it a second time as new typing. Earlier steps of the same transaction can change a source paragraph, as a join first deletes what a removed paragraph's copies hid, so following and outgoing text keep the identities of their characters with their positions and are found by identity when the positions moved. The index is not read again inside the transaction: the view the editor showed decides what the write keeps. Pieces of following text at one character keep the order they show in.

Moves are matched only between paragraphs of one story, and never against text its own paragraph writes again in the same edit: a run split by new markup is rewritten, and the same letters written into a comment are new text.

The identity index counts runs: a paragraph can hold one run twice, two copies of one text, and losing one copy removes one entry.

### Incomplete shared state

Yjs applies an update's deletions at once and holds back its insertions until what they depend on arrives. A replica can then lack a record a text embeds, or an attribute a peer replaced. The editor still follows that state, so local edits address what shared state holds. A view the incompleteness breaks is skipped instead of reported as an error, local edits are refused until the next view installs, and the update that completes the state publishes again.

### Comments and notes

Two peers that add the first comment at once each create `comments.xml`. One directory entry wins; the other peer's root keeps its comment, and the loose-member repair shows that comment in the winning part. When the winner undoes its comment, its entry goes, and the view shows the part from the remaining root: one with its namespace bindings, then one that holds content, then the smallest ID. The same holds for the other parts made on first use: the comment companions, the notes parts, and numbering. Every write is bound to its author, so ids that two peers mint at once, such as the relationship to a new notes part, differ, and an undo of one never removes the other's. A reused part also drops a member that an earlier view adopted and that has since been deleted.

An undo of a comment or note leaves its record and removes its listing, which looks like a concurrent loss to the repair. The replica that undid marks those records, keeps their IDs on the history step, and the redo of that step clears the marks. The repair skips marked records. Numbering definitions are loose by design, so they are never marked.

### Elements a part holds once

Concurrent writes can leave two copies of an element its schema allows once. Besides paragraph and run properties, this covers a drawing's children: `wp:extent`, the position elements and the other children of `wp:anchor` and `wp:inline`, the wrap choice, the choice of `wp:anchor` or `wp:inline`, and the single value of a position. The first copy in child order shows; for a position, the first that still holds a value. An insert into a part whose members show sorted, such as notes, may stand past the listed children, because the view also shows members no parent lists; it is appended.

Formatting that a peer applies while another peer moves the same text keeps only the formatting of the copy. The concurrent format applies to the original characters, which the move deleted, and the copy carries the formatting its mover saw.

The placement element of a drawing is one record whose kind is `wp:inline` or `wp:anchor`. A peer that makes it inline while another gives the anchor a new wrap leaves an inline element with a wrap child. Children that the element's current kind never holds, the wrap choice, the position elements, `wp:simplePos` and the relative sizes under `wp:inline`, do not show.

When a paragraph that shows a character deletes it or is deleted, its hidden copies are deleted too, so they do not show in its place. That includes hidden copies in the same paragraph, as two concurrent joins of the same paragraphs leave. The write takes them by Yjs item ID before it changes the text, because its own inserts and deletions shift every position. A character in its first place stays when the same edit copies it again, as a join copies a removed paragraph's text back: it hides behind that copy wherever the copy is. Deleting it anyway left nothing on a replica that receives the edit before an update the copy depends on, because Yjs applies the deletion at once and holds the copy back.

### The editor's tree follows the shared view

A local edit installs the tree the editor computed, not the one shared state shows. Inline IDs that two paragraphs share are tagged in all but one, and repeats within a paragraph get a counter, so the shared view can name a node differently after an edit. When an edit leaves a view that renames, hides, adds, or repairs something, or changes another paragraph's view, the session installs the shared view. A package with equal content but other IDs installs too, for the paragraphs whose IDs changed.

A local edit names nodes by the IDs the editor has. After every edit other than typing, the session compares the IDs of each edited main-story paragraph's shared view with the edit's own tree and installs the shared view when they differ: a format change names property elements by rule, and a join or split can tag a shell. Typing only splices text and is not checked, which keeps the keystroke cost. When a journal still names an inline node that no paragraph it touches shows, the router finds the paragraph that shows it and routes there.

A member part, such as notes or comments, can show members no parent lists. The journal projection counts the children the view shows, and before a journal addresses that root it lists them in the order shown. Notes show sorted by id, the order in which a reader resolves them. Comments keep their listed order and show adopted ones after it, so a pass that adopts nothing agrees with a full pass. A package that differs only in IDs installs whatever parts it touches.

### A received edit rebuilds only what changed

A received keystroke dirties its paragraph and each ancestor up to the part root. An ancestor whose own record did not change keeps its last child list and rebuilds only its dirty children. It does so only when its last build showed every child it lists and reported no issue. A child that was pending and arrives later dirties only itself, so a list that skipped it cannot be reused. Any other ancestor rebuilds its whole child list. On a 3,200-paragraph document, this takes a received keystroke from 6.2 to 2.7 milliseconds. Capture of a local edit also skips the children an edit keeps unchanged, which takes a local Enter from 26 to 10 milliseconds there. `benchmarks/collaboration-server/edit-latency.ts` measures both.

### Deleted text stays deleted

A move deletes characters and writes copies of them; a deletion only deletes. Yjs does not record who deleted an item, so a peer's concurrent move of deleted text left a copy that showed it again, and so did a peer's undo that put a deleted paragraph back. Each edit therefore records the identities it deletes and does not copy, in the document map `docx-text-deletions-v1`: the characters its writes delete, and everything a paragraph it removes showed, following text included. Every replica hides every copy of a recorded identity, which also leaves the identity index. A record is keyed by the client that wrote it, and counts only from that client. The undo manager tracks the map, so the undo of the deleting step withdraws its record, and only that undo does.

A paragraph removed whole also takes the records it embedded, such as a drawing with a text box, unless the edit embedded them again elsewhere, as a join does. A peer's concurrent Enter that moved the drawing then shows nothing of it.

Text that would show nowhere, a moved copy in a paragraph that is gone whose neighbors are all deleted or undone, goes back to the paragraph that held its original, when that paragraph is live, and shows at its end. A paragraph's own text, and text a participant deleted, never come back this way.

Text typed in front of a copy, when that copy then hides as a duplicate of another participant's copy, stands in front of the copy that shows. Only an item the writer anchored before that character moves.

One rule, `placeFollowingText`, places following text for the view and for the write that makes it a paragraph's own text. A piece shows at the first shown character with its anchor. Without one, it shows at the first character of another piece with its anchor, so text typed inside moved text stays inside it. Within that piece, it shows after the characters inserted after its anchor later, as Yjs orders a later insert after one character before the text that followed it. Otherwise, or in a cycle, or below eight levels of nesting, it shows at the end. A write that placed a piece elsewhere than the view read the paragraph reordered, typed the piece again without its identity, and recorded the original as deleted.

Placed text, following text and the text a source passes on, names its characters by their Yjs item IDs. Positions move when a write in the same transaction changes the text, and a copy that write makes carries the same identity as the character it copies. Only the item ID finds the character itself.

A write reads only cached identities that describe the text as it is. A write that changes another paragraph's text, as moving an embed out of it does, drops that paragraph's cached identities in the same step.

### Cost over a long session

Text typed after deleted text can follow a move, so every paragraph that holds such text is a source the replica tracks. Over a long session most edited paragraphs become sources. Where a source's following text shows depends only on where some characters show: its own, the characters it was typed after, and those its copies went in after. The index keeps these per source. A change places again only the sources that read a character whose holders changed, and a change of document order only those that read a character two paragraphs hold. Placing waits for the next read, so one transaction places each source once, and a cold build places every source once, at the end.

Finding moved text compares inserted runs with deleted runs. One edit may spend a fixed number of comparisons on it, across all its paragraphs. An edit that rewrites a large document stops matching there, and its remaining text counts as new text. That is correct, but text a peer typed in it meanwhile no longer follows it.

Formatting markers are never removed in place. Removing one is safe only after every replica has seen the change around it, and a room with offline peers cannot know that. A server compacts the room instead: when it loads a room that has grown past twice the size it recorded at its seed (`freshBytes`), it seeds a new generation from the room's current content, with a new `roomGeneration`, before any participant syncs. Each client names the generation it holds in a stateless message before its first sync message, and the server refuses another generation with `room-generation-changed`, so no state of an earlier generation merges into the new one. A replica refused so keeps its document and rejoins. A server that holds a room's document prepares it with `prepareCollaborationServerDocument`, or Yjs removes markers there and sends the removal to every participant.

### Typed boundaries

Untrusted or untyped values enter the model at named boundaries only:

- `LogicalId` is a branded string. A canonical node ID, a key of the shared nodes map, or an ID read from shared text becomes one through `asLogicalId` or `idOf`. A core journal becomes `SharedEffect` values once, where routing and projection start.
- `yjs-items.ts` holds every read of Yjs structure that the public Yjs API does not offer: item neighbors, origins, the item that holds a type, and pending updates.
- `node-shapes.ts` is the one place where fields decoded from shared state or built by a view become typed core nodes. Core validation checks each kind's rules before any tree is published.
- Lookup tables keyed by a peer-written string are `Map` or `Set` values, so a key such as `constructor` names nothing.

### Carets follow their text

A caret is anchored on the shared character beside it: the character before it, or, at a paragraph start, the one after it. The anchor names the character's Yjs item (`client:clock`) and, for a copy, the identity of the character it copies. Offsets count the editor's model text, so a paragraph's characters are laid out by the same tree walk the editor uses (`segmentsOf`), and the layout is used only when its text equals the text the editor shows. Any other paragraph has no anchor.

The local caret is anchored when a remote transaction starts, from the view the editor shows. After the session publishes the change, each endpoint stands beside its character in the paragraph that shows it: its own paragraph, the copy that shows, or any paragraph that holds a copy. The session returns the move with the selection it carried (`remoteSelectionMove`), and the editor uses it only for that same selection. A caret with no anchor, or a character that shows nowhere, is carried by text alignment: an offset stays next to the same character when one commit changes text on both sides of it, and text a peer inserts exactly at the offset goes after it.

A participant publishes each caret endpoint as a stable paragraph ID (`w14:paraId`), an offset, a digest of the paragraph text the offset counts in, and its anchor. A peer that shows the anchored character places the endpoint beside it. Otherwise (an older peer, or a character that has not arrived) the peer takes the first local text that matches the digest as the baseline and carries the offset across each later change to that text. The anchor is validated as untrusted input; a malformed one is dropped and the offset stands. Each undo step keeps the published endpoints, anchors included, of the selection it was made from; undo and redo restore each endpoint beside its character, and carry an endpoint whose character no longer shows (an undo restores deleted text as new characters) across the text of its paragraph.

Undo removes the characters its step typed. A peer's split or join that moved those characters meanwhile deleted them and shows copies, so Yjs has nothing left to reverse for the step: it skipped the step and undid an older one. The undo therefore finds the copies of the characters its step typed and records those characters as deleted, so every replica hides the copies; a step with nothing else to reverse is popped by the session, not by Yjs. The redo step keeps the record keys and withdraws them, and the undo step a redo pushes keeps the characters, so undo and redo repeat. Paragraph IDs are minted per author, so two people who insert a table column at one place do not give two paragraphs one ID.

### Format version and migration

`sharedSchemaVersion` and `repairVersion` increase. A room of the earlier format refuses to synchronize with this release before any update enters it. Migration reads the old room's document with the earlier reader, which stays available for that purpose, and seeds a new room generation. The earlier reader is removed only after the supported migration window.

## Risks / Trade-offs

- [Fidelity of the round trip] → The spike phase requires linearize-then-materialize to reproduce the canonical fingerprint of every corpus document before any Yjs work.
- [Keystroke cost of the diff] → The single-splice fast path covers typing. The diff is linear in one paragraph, as the existing paragraph rebuild already is.
- [A peer that writes an inconsistent attribute set, such as a `run` ID with no record] → The materializer treats a missing record as an anonymous run with only the formatting attributes, and reports it, as it reports a missing child today.
- [Large paragraphs] → `maxTextLength` and embed counts stay bounded by the existing limits.
- [Two readers during migration] → The earlier reader is used only for migration and is removed after the window.

- [Typing after text a split moved and a join brought back] → A peer splits a paragraph and another joins it back while a third types after a character of the moved text, unaware of both. The text shows once, but stands where the deleted originals were, earlier in the paragraph than the copy of its character. Moving it after the copy in its own paragraph duplicated text in other cases, so it is not done. The case is kept in `replays/open/`.

## Migration Plan

1. Release the earlier format's reader as the migration path and the new format as the default for new rooms.
2. A host that opens a room of the earlier format gets `collaboration-format-mismatch`. It reads the document with `readCollaborationDocument` and seeds a new room generation.
3. Rollback: rooms created in the new format cannot be opened by the earlier release. Hosts keep the last exported document of each room.

## Open Questions

- Should comment range markers stay embeds, or become an attribute that covers the range? An embed keeps the earlier behavior; an attribute merges concurrent range edits better.
