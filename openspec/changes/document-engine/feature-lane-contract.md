# Feature-lane integration contract

**Status:** In progress — parse lane frozen via registry; remaining lanes enumerated
**Authority:** `document-engine/tasks.md` execution item "Freeze the feature-lane
integration contract"

## Goal

A new OOXML feature (especially a new top-level block kind) must be addable primarily
as a **focused module plus registration and conformance fixtures**, not by editing
central `switch`/`if` chains scattered across the parser, store, serializer, and layout.
When every lane below is registry-driven, independent feature lanes can be developed in
isolation (and in separate worktrees) without colliding on shared central files.

## The lanes a block-kind feature touches

For a new top-level block kind (element `w:foo` → `FooRecord` with `kind: 'foo'`), the
feature registers behavior in each of these lanes. Each row is a single extension point;
none should require editing an unrelated feature's code.

| Lane | Where it lives today | Registry-driven? |
| --- | --- | --- |
| **Parse** — element → `Block` | `wml-parse` `blockFromText` dispatch | ✅ `registerBlockElementParser(name, parse)` |
| **Scan** — is this element a top-level block span? | `wml-scan` `walkBlockSpans` (hardcodes w:p/w:tbl/w:sdt + w:customXml descent) | ⛔ pending |
| **Count** — cross-check block/tree counts | `wml-parse` `countTreeBlocks` / `countModelTables` | ⛔ pending |
| **Preservation trigger** — force the structural path | `docx/read` `wantsPreservation` | ⛔ pending |
| **Hash** — id-independent content hash | `wml-preserve` `contentForHash` | ⛔ pending |
| **Serialize** — `Block` → XML (from-scratch) | `wml-serialize` `blockXml` | ⛔ pending |
| **Normalize** — canonical form | `store/normalize` `normalizeBlock` | ⛔ pending |
| **Projection** — `Block` ↔ ProseMirror node | `engine-binding` `modelToDoc` / `mapDocToOps` | ⛔ pending (own package/lane) |
| **Layout** — `Block` → display items | `engine-layout` `layoutBlocks` | ⛔ pending (own package/lane) |
| **DocOps** — semantic mutation vocabulary | `store` DocOp union + appliers | ⛔ pending |
| **Fixtures** — conformance | `e2e/fixtures/*.docx` + per-lane tests | n/a (add fixtures) |

## Frozen so far: the parse lane

`registerBlockElementParser(elementName, (el, alloc) => Block)` (engine-core public API)
adds a block kind to the entry dispatch; `blockFromText` / `blockFromSpan` (and thus the
`docx/read` preservation path) recognize it with no central-switch edit. The built-in
`w:p` / `w:tbl` / `w:sdt` kinds register through the same call, so there is no privileged
path. Covered by `test/block-parse-registry.test.ts`.

## Design principles for the remaining lanes

- **One registration object per block kind.** The remaining lanes should collapse into a
  single `BlockCapability` registered once, whose fields the central dispatch points read
  (`scan`/`count`/`hash`/`serialize`/`normalize`), rather than N separate registries — but
  only where that does not force an import cycle. Where a lane legitimately belongs to a
  downstream package (projection in `engine-binding`, layout in `engine-layout`), that
  package keeps its own registry that a feature's adapter module registers into.
- **Fail closed on the unknown.** Every dispatch already returns `undefined` / throws /
  rejects for an unregistered kind (parse returns `undefined`; the count cross-check and
  preservation guards reject). A new lane must preserve that — an unregistered kind is
  read-only or rejected, never silently dropped.
- **Built-ins are just registrations.** Migrating a lane means moving its `if (kind ===
  …)` body into the built-in kind's registration, leaving the dispatch point a table
  lookup. Behavior-neutral per migration, verified by the existing suites.

## Exit criterion

Adding a block kind requires only: a `FooRecord` type + `kind` union member, a focused
`wml-foo` module, one registration per lane (ideally one `BlockCapability` object), and
conformance fixtures — with no edit to another feature's parser/store/serializer/layout
code.
