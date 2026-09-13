# DocxEditor / Word JavaScript API compatibility

## Informational document editing report

From the repository root, run:

```bash
bun run --filter '@docx-editor.dev/editor-api' compat:report
```

The report checks only document editing methods and property writes selected in
`editing-scope.json`. It covers content insertion/deletion, formatting, tables,
images, lists, comments, revisions, and document metadata. Read-only APIs,
navigation, selection changes, host setup, lifecycle methods, enums, and option
objects do not enter the denominator. Text replacement through the selection is
an edit; moving the selection is not.

The explicit upstream UID list defines scope independently from our implemented
subset. Unsupported editing calls stay in the denominator. Review this list when
adopting a new upstream pin or changing the intended editing scope. A missing UID
is an error; it never silently reduces the denominator. The full pinned inventory
remains reference input so scope changes do not require a network fetch.

The checker reads actual `src/index.ts` exports, following re-exports and
inheritance. Methods compare all overloads, parameters, and return signatures.
Property writes compare setter types only. For example, a nullable `font.bold`
getter does not reduce write compatibility if the setter accepts `boolean`.
Read differences can still appear in runtime notes.

Read `packages/editor-api/compat/reports/report.md` for editing endpoints and
runtime notes. `report.json` includes the comparison shapes under `expected` and
`actual`, along with upstream metadata. `summary.md` contains the overall editing
percentage and separate method/property-write percentages shown in CI.
Use `--output <directory>` with the package command to change the output directory.

Signature statuses are `match`, `different`, and `missing`. Each editing member
counts once. An exact method match requires all overloads to match. Namespace,
whitespace, quote, and union-order normalization preserve enum alternatives and
inline object types. Named references remain named; this is not recursive
structural assignability. Equivalent overload spellings or differently named
aliases can appear as `different`. No percentage proves runtime equivalence.

Add per-endpoint observations to `runtime-notes.json`:

```json
{
  "Word.Range#insertComment": {
    "status": "partial",
    "notes": "Writes require an explicit author."
  }
}
```

Runtime statuses are `equivalent`, `partial`, `different`, `unsupported`, and
`unverified`. Missing notes default to `unverified`. Use `equivalent` only after
reviewing runtime behavior and tests. Notes never change signature scores. Notes
outside the editing scope remain stored but do not appear in the editing report.

CI runs the report as an independent, non-blocking job. It writes a step summary
and uploads an `office-js-compatibility` artifact. Signature differences do not
fail the command. Tooling errors exit nonzero and show an unavailable report.
Existing subset conformance checks remain unchanged.

To refresh the full reference after reviewing the pin in `provenance.json`, run:

```bash
bun run --filter '@docx-editor.dev/editor-api' compat:fetch-inventory
```

This maintenance command downloads the pinned npm tarball and verifies its
integrity. It records normalized facts and source provenance, not upstream
declaration files. Commit the generated inventory with the change. Reports and
tests use committed reference data without network access.

## Selected subset conformance

This directory freezes a checked-in, versioned subset of the _shape_ of the
stable Microsoft Word JavaScript API (`Word.*`), so that
`compat/docxeditor/declarations.ts` — DocxEditor's own, independently
authored public interfaces, exported as the `DocxEditor` namespace — can be
measured against it for source/structural compatibility.

**DocxEditor owns every type declared here.** Nothing in this directory
vendors, copies, or is generated from `@types/office-js`. Microsoft's
declarations and docs are reference-only conformance _input_: read once by a
network-capable script into a repository-owned, minimal normalized fixture
(names, shapes, requirement sets, provenance — never declaration source),
and never depended on by the published package.

## Layout

| Path                                  | What it is                                                                                                                                                                                                               | Who writes it                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `manifest.json`                       | The allowlisted subset: which `Word.*`/`OfficeExtension.*` symbols and members are selected, plus every deliberate omission and its reason.                                                                              | Hand-edited.                                                 |
| `reference/word.reference.json`       | Normalized facts extracted from the manifest-selected subset of a specific `@types/office-js` release.                                                                                                                   | Generated by `scripts/fetch-office-reference.mjs` (network). |
| `provenance.json`                     | Exactly which upstream package/version/integrity hash/license produced the reference fixture, and when.                                                                                                                  | Generated by `scripts/fetch-office-reference.mjs` (network). |
| `definitely-typed-commits.json`       | The reviewed DefinitelyTyped source commit for each adopted `@types/office-js` version. A version with no entry cannot be written into `provenance.json`.                                                                | Hand-edited, or by `compat:adopt` (network).                 |
| `docxeditor/declarations.ts`          | DocxEditor's own public interfaces. Names and call shapes mirror the selected reference; everything else (implementation types, docs, organization) is repository-owned. No runtime behavior — this is declaration-only. | **Hand-authored.** Never generated.                          |
| `docxeditor/type-assert.ts`           | `IsExact`/`Expect` — the bidirectional type-equality primitives the generated compile assertions use.                                                                                                                    | Hand-authored.                                               |
| `generated/docxeditor.shape.json`     | The same normalized shape data as `reference/word.reference.json`, extracted from `declarations.ts` instead — for human/diff review.                                                                                     | Generated by `scripts/generate-conformance.mjs` (offline).   |
| `generated/conformance.assertions.ts` | Strict, per-overload TypeScript compile assertions comparing the reference fixture against `declarations.ts`.                                                                                                            | Generated by `scripts/generate-conformance.mjs` (offline).   |
| `fixtures/source-compat/*.ts`         | Representative Office.js sample code, rewritten `Word` -> `DocxEditor`, that must type-check against `declarations.ts`.                                                                                                  | Hand-authored.                                               |
| `tsconfig.json`                       | Compiles `docxeditor/`, `generated/`, and `fixtures/` together so the compile assertions are checked by the real TypeScript compiler, not just by text/AST comparison.                                                   | Hand-authored.                                               |

## The offline-CI guarantee

`bun test`, `bun run typecheck`, `bun run build`, and `bun install` never
touch the network. Explicit reference maintenance uses
`scripts/fetch-signature-inventory.mjs` or `scripts/fetch-office-reference.mjs`.
The latter is invoked by the scheduled
`.github/workflows/office-compat-drift.yml` workflow, or manually by a
maintainer, never by any of the checks above. Everything `bun test` gates on
(reference-fixture validity, manifest/reference consistency, the generated
shape/assertions being up to date, the real compiler seeing zero
diagnostics) reads only files already checked into the repository.

## Regenerating

```bash
# Network: refresh reference/word.reference.json + provenance.json from the
# current @types/office-js release (or --version <semver> to pin one).
bun run compat:fetch-reference

# Offline: after editing manifest.json or docxeditor/declarations.ts,
# regenerate generated/docxeditor.shape.json + generated/conformance.assertions.ts.
bun run compat:generate

# Network: check whether the upstream release has drifted from the checked-in
# reference fixture, without overwriting anything (exit code 1 on drift).
bun run compat:check-drift

# Network: adopt an upstream release whose reference differs in nothing but the
# version string. Rewrites reference/word.reference.json (its generatedFrom
# carries the release), provenance.json, and definitely-typed-commits.json.
# Refuses (exit code 1) as soon as anything else differs.
bun run compat:adopt
```

**De-selecting a member offline.** `reference/word.reference.json` is the
manifest-selected _projection_ of upstream, so a member removed from
`manifest.json` also has to leave the fixture — otherwise `compat:generate`
keeps comparing a member the authored declarations no longer declare. Deleting
that member's entry is exactly what the next `compat:fetch-reference` produces
from the same upstream release, and it is the only edit to this file a
maintainer may make by hand: a **removal**, never an addition or a change to
what upstream says a member's shape is.

`compat:check-drift` always fetches, extracts, and diffs whatever
`@types/office-js` version is currently published — including one with no
reviewed entry in `definitely-typed-commits.json` yet, since a version bump is
exactly how real drift arrives. In that case its output is prefixed
`REVIEW REQUIRED:`: the symbol/member delta is still complete, but
`compat:fetch-reference` (the write path) keeps refusing to run until that
version's exact DefinitelyTyped source commit is recorded — unreviewed
upstream data is never written to
`compat/provenance.json`/`compat/reference/word.reference.json`.

## Which drift a machine may adopt

Most upstream releases move nothing this directory measures: Microsoft
republishes, the version string changes, and the manifest-selected reference is
identical. That delta says nothing about the Word API, so
`.github/workflows/office-compat-drift.yml` adopts it itself with
`compat:adopt` and opens an ordinary PR. When anything else moves, the same
workflow opens a tracking issue instead and changes nothing.

`compat:adopt` is the only path that may record a source-commit pin without a
maintainer, and it earns that two ways:

- **It refuses every change but the version string.** The gate compares the two
  fixtures whole, in a key-sorted canonical form, with only
  `generatedFrom.version` excluded — deliberately _not_ by asking
  `reference-diff.mjs`. That diff exists to explain a change to a person, so it
  compares the fields worth naming in a report; anything it does not compare
  (overload order, a parameter name, a uid) would read as "no differences" and
  adopt a Word API change unattended. Comparing the whole fixture makes the
  gate total by construction: a field added to `reference-normalize.mjs` is
  covered the day it is added, with no second place to remember.
- **It proves the commit rather than trusting it.** npm publishes no `gitHead`
  for `@types/*`, so `scripts/lib/definitely-typed-commit.mjs` walks the
  commits touching `types/office-js` and accepts one only when git's blob hash
  of its `index.d.ts` equals the blob hash of the `index.d.ts` inside the
  integrity-verified tarball. A wrong, renamed, or force-pushed-away commit
  cannot pass that comparison, and an unexplained release aborts the adopt.
  What this establishes is that the declarations at that commit are the
  published ones — not that the whole tree there was what got published, which
  a blob comparison cannot show.

What lands is still a PR: full CI, human approval.

## Why two layers of comparison

`scripts/lib/shape-compare.mjs` does a strict, textual/AST-level per-overload
comparison (`compareFixtures`) — deliberately not TypeScript's structural
`extends`, which would treat a narrowed or widened overload as "compatible"
in one direction. `generated/conformance.assertions.ts` is a _second_,
independent check: it re-expresses the same comparison as real TypeScript
type aliases, checked by `tsc` itself (`typecheck-compat.test.ts`). The
compiler catches things the textual comparison cannot — e.g. a typo'd or
unexported authored type name resolves to "Cannot find name", not a silent
textual mismatch.

## Deliberate simplifications

- **Enum-vs-literal collapsing.** Office.js frequently offers the same value
  two ways — a `Word.SomeEnum` member or the equivalent string literal. When
  a literal alternative exists in the same union, the enum-qualified
  alternative collapses into it in the reference fixture; the _runtime_ enum
  objects Office.js ships are proxy-runtime plumbing, out of scope for this
  task. (Two positions — `Word.Range#select`'s `SelectionMode` and
  `Word.Section#getHeader`/`getFooter`'s `HeaderFooterType` — declare these
  as two _separate_ overloads rather than one unioned parameter, so a
  same-named, zero-runtime-footprint type alias exists in
  `docxeditor/declarations.ts` purely so the enum-typed overload has
  something to type-check against.)
- **Inline object-literal alternatives are dropped** in favor of the named
  class alternative already covered by its own selected symbol (e.g.
  `search(text, options)`'s "or a plain options object" overload) — deep
  structural comparison of anonymous object types is out of scope.
- **`OfficeExtension.ClientRequestContext#sync` is not selected for exact
  conformance** (see `manifest.json`'s `omissions`) — upstream's real
  batching/flush behavior and its generic pass-through signature
  (`sync<T>(passThroughValue?: T): Promise<T>`) are the proxy runtime's job
  (Task 3), not this contract-freeze task's. `docxeditor/declarations.ts`
  still independently authors a deliberately simplified, declaration-only
  `sync(): Promise<void>` on `ClientRequestContext` purely so representative
  source-compat fixtures can end a batch with `await context.sync()`, same
  as real Office.js samples do — this has no runtime behavior and is not
  compared against the reference.
- **The older declaration-only fixture is a selected contract** — it does not
  enumerate all runtime capabilities. Tables, pictures, fields, and the other
  members of the 81-member editing profile are checked directly against actual
  public exports by `compat:report`, using the pinned full inventory.

### Effective document-editing profile

The same `compat:report` command reports the fixed 81-member scope in
`agent-editing-scope.json`. CI includes both the broad editing inventory and this
ordinary-document profile in its informational job summary. Download the artifact
for `agent-editing-report.json` and `agent-editing-report.md`, including expected
and actual signatures and endpoint runtime notes.

Member presence, exact signatures, and tested behavior are separate evidence.
An exact signature does not imply every enum value, advanced structure, batching
pattern, or Word behavior is supported. The Office guide explains the runtime
contracts; `openspec/changes/agent-editing-subset/` records workflow and consumer
verification. Both scopes share one normalized upstream inventory.
