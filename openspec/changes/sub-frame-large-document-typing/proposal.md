## Why

Typing in the 521-page profiling document presents after 97.6 ms at the median, although only four pages are materialized and incremental layout places 11 of 6,540 blocks. The remaining work scales with the document revision, so ordinary typing cannot stay within one 16.7 ms frame as documents grow.

## What Changes

- Add a bounded-cost canonical mutation path for text-local edits. It preserves canonical-tree authority, atomic history, fail-closed validation, unknown OOXML fidelity, and immutable revision snapshots.
- Remove body-width work from ordinary text insertion. Wide child-sequence updates, delta validation, and edit indexes touch only the edited path and bounded metadata.
- Inventory every typing-path aggregate before selecting storage. Patch only indexes and page structures whose measured cost scales with document size.
- Keep complete `SemanticLayout` publication atomic while adding a private staged display for proven-safe text-local typing. The canonical tree commits first, the visible caret region presents provisionally, and the complete layout replaces it atomically.
- Restrict provisional display to a narrow safety envelope. Composition, complex shaping, structural edits, uncertain wrapping, notes, fields, drawings, tables, content controls, review markup, and stale geometry use the authoritative settle path.
- Reconcile only changed materialized pages after layout settles. Reused page shells, DOM, drawing resources, review geometry, and layout-derived indexes remain stable when their inputs remain stable.
- Add deterministic work counters, differential oracles, browser burst checks, and a reference performance budget for large-document typing.
- Preserve the public editor, adapter, save, print, automation, and package APIs. This change introduces no intentional breaking API change.

## Capabilities

### New Capabilities

- `staged-typing-presentation`: Canonical-first typing, a proven-safe provisional display, atomic authoritative layout publication, geometry-read barriers, and page-local settled paint.
- `large-document-typing-acceptance`: Deterministic work gates, differential conformance, sustained and burst input correctness, memory bounds, and reference interaction budgets.

### Modified Capabilities

- `typed-ooxml-canonical-tree`: Atomic mutation and derived indexes gain bounded-touch sequences, checked mutation proof, scoped validation, incremental index sidecars, complete rebuild oracles, and fail-closed fallback.
- `semantic-paragraph-layout`: Complete `SemanticLayout` publication remains atomic, but the output contract now distinguishes private committed provisional presentation from published layout and adds cooperative settle plus page-local reconciliation.
- `paragraph-editor-binding`: Transaction mapping, canonical history, and projection exclusion now define how staged presentation follows committed input without becoming save, layout, or history authority.

## Impact

- Primary code areas: `packages/core/src/store`, `packages/core/src/binding`, `packages/core/src/layout`, `packages/core/src/output`, and `packages/core/src/editor`.
- The canonical node child-sequence implementation and internal index ownership can change. Public `OoxmlNode` behavior and ordered traversal remain compatible.
- The editor gains private model-revision and display-revision state. Hosts continue to observe committed canonical state and complete published layout state.
- React, Vue, Pro review, and editor API packages consume the same engine behavior without adapter-owned fast paths.
- Save drains its captured input sequence and serializes canonical state without layout. Active composition rejects save; geometry-dependent operations cross the settle barrier.
- Security checks remain mandatory for changed input. Untouched validated subtrees can reuse prior proof, but malformed edited content never publishes.
- Benchmark tooling gains structural counters for touched child slots, validation visits, index patches, page reconciliation, provisional eligibility, settle latency, and stale work.
