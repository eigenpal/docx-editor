# Historical Yjs schema decision record

> **HISTORICAL, NON-NORMATIVE**
>
> This file records decisions reached during the superseded engine
> falsification work. It is not a current implementation design, acceptance
> checklist, prerequisite, or source of POC scope.

## Current authority

Current POC scope and acceptance live in:

- [`proposal.md`](./proposal.md)
- [`design.md`](./design.md)
- [`tasks.md`](./tasks.md)
- [`../../../docs/superpowers/specs/2026-07-22-engine-poc-design.md`](../../../docs/superpowers/specs/2026-07-22-engine-poc-design.md)

The POC is a disposable, non-shipping browser proof. Production authority
remains the `document-engine` change.

## Decisions retained from the earlier work

### V1 nested shape was rejected

The v1 model-shaped schema used nested per-paragraph `Y.Map`/`Y.Text` structures
and destructive normalization. Experiments showed that undoing locally created
nested types could delete later remote child edits, and that overlapping marks
did not preserve the intended actor-local behavior. That shape remains rejected
historical evidence.

### One long-lived body sequence was selected

The replacement direction used one long-lived `Y.Text` for the body story.
Paragraphs were represented by immutable plain-JSON opening-boundary embeds:

```text
[openingBoundary₀, text₀, openingBoundary₁, text₁, …]
```

The sequence starts with an opening boundary. Each boundary starts one paragraph;
the last paragraph ends at sequence end, with no terminal sentinel. This grammar
is retained for the POC's single paragraph.

### Candidate B formatting was selected

The reviewed KISS experiment compared two formatting representations across six
direct scenarios. Candidate B, immutable creation-only
`mark-contributions`, was selected. The abandoned large formatting-oracle corpus
was never executed and remains non-authoritative.

### Synchronous transaction executor was retained

The completed synchronous executor established one transaction/origin path that
rejects async, nested, reentrant, mixed-origin, and failed-preflight work
atomically. The POC may reuse that foundation.

## Deferred breadth

The following former design breadth is deferred and does not participate in POC
acceptance:

- the former named v2 scenario catalog and exhaustive re-proof;
- durable history reconstruction, compaction, and redo matrices beyond the
  focused actor-local undo behavior;
- deterministic repair evidence and collision machinery;
- annotation and relative-position envelope matrices;
- local-backend parity and PM-free server parity;
- audit/replay, awareness, synthetic layout, and broad resource-limit suites.

Those topics may be revisited only as later production design work or when a
failing POC product behavior directly requires a narrower fix.

## Lean JSON contracts

The historical lean JSON contracts may be consulted as implementation notes:

- `oracles/yjs-schema.v2.json`
- `oracles/binding-oracle.v2.json`
- `oracles/history-oracle.v2.json`
- `oracles/comparator-contracts.v2.json`

Their compatibility filenames, descriptors, and integrity hashes do not define
POC acceptance, do not require oracle re-freezing, and cannot expand the five
pending product milestones or the single Playwright finish line.
