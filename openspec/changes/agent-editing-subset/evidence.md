# Implementation evidence

The 81 editing members are implemented within the documented runtime domains.
`compat:report` compares the actual public exports against the pinned
`@types/office-js@1.0.605` inventory: 81 members present and 81 exact signatures.
This is not a claim of 100% Word runtime equivalence. The same command reports
the much larger exhaustive editing denominator separately.

## Member and workflow coverage

| Checklist area                | Runtime evidence                                                                                                                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text and links (2.1–2.7)      | Existing model reads/writes and host gating tests; contract consumer duplicate targeting, paragraph insertion/deletion, hyperlinks, sentinels and bookmarks.                                                                        |
| Formatting (2.8–2.25)         | `model-font-editing.test.ts`, paragraph formatting tests, enum consumer, and report consumer headings, emphasis, spacing and alignment. Canonical field-boundary regression covers formatting after field insertion.                |
| Review (2.26–2.35)            | Runtime change-tracking/proposal tests; contract consumer comments, replies, resolution/deletion and all four revision decisions; public browser tracking tests with the review module.                                             |
| Lists (2.36–2.43)             | `model-list-authoring.test.ts`, canonical list history and actor tests, browser authoring parity, report consumer nesting/restart/detach.                                                                                           |
| Tables (2.44–2.56)            | `model-tables.test.ts`, `model-table-parity.test.ts`, `model-table-cleanup.test.ts`, canonical table authoring tests, report consumer. See `table-evidence.md`.                                                                     |
| Page layout (2.57–2.64)       | `model-page-breaks.test.ts`, section/page-setup tests, public enum consumer, report page geometry and browser parity.                                                                                                               |
| Template controls (2.65–2.71) | `model-control-creation.test.ts`, existing content-control tests, contract consumer lock/unlock/fill/refusal/delete on both hosts with save/reopen.                                                                                 |
| Pictures (2.72–2.77)          | `model-pictures.test.ts`, `model-picture-field-parity.test.ts`, canonical drawing tests, report PNG/JPEG insertion, dimensions, aspect lock, alt text and deletion.                                                                 |
| Fields (2.78–2.81)            | `model-fields.test.ts`, `model-field-pagination.test.ts`, `model-picture-field-parity.test.ts`: real measured pagination, long paragraph positions, section Roman numbering, footer creation, code/update/delete and saved results. |

Test paths above are under `packages/editor-api/src/` or `packages/core/src/`.
Source tests cover refusal and preservation alongside positive edits. Consumer
apps use public imports, author input fixtures, and never patch output XML to
work around the API.

## Independent consumer applications

- `examples/editor-api-consumers/contract-agent.ts`: executes a contract/template
  action plan; server and browser workflows, tracked review, comments, controls,
  lock recovery, save/reopen and preservation. See `contract-feedback.md` beside it.
- `examples/editor-api-consumers/report-agent.ts`, `report-plan.ts`, and
  `report-browser-run.ts`: one report action plan exercised through both hosts;
  lists, table authoring, pictures, headers/footers, font-backed page fields,
  save/reopen, loaded collection navigation and preservation. See `report-feedback.md`.

The contract browser app uses Happy DOM and the real editor host. The report
browser app runs in headless Chromium and captures the painted result. These prove
host transactions and model/layout behavior; native Word inspection is separate
and recorded in `review.md`.
Artifacts are written under `/tmp/editor-api-consumers/` and are reproducible from
the checked-in app commands.

## Runtime boundaries tested

Read-derived proxy dependencies may resolve within one `context.sync()` through
revision-pinned read-only preflights followed by one atomic write. Proxies created
by writes still require a sync before configuration. Failed preflights and callbacks
discard coalesced property bags. Multiple structural writes, different list-level
formatting writes, cross-story edits and unsupported alias conflicts remain explicit
refusals, with no partial command commit.

Headless field updates require a supplied measurer; absent pagination refuses.
The browser uses its measured editor layout. Fields update in batches without other
edits. Repeating footer/header fields store the first occurrence as their cache;
renderers project page-specific values. This does not execute arbitrary field code.

See `consumer-review.md` for the feedback/fix loop and `independent-review.md`
for the final independent code review. Final repository gate outcomes are recorded
separately when their runs complete.

## Final local gates (2026-09-12)

- `bun run test --jobs 4`: **12,959 passed**, zero failed/skipped/todo,
  1,038 isolated test files. This is the supported sharded runner.
- `bun run build:packages`: passed for all published packages. Core and editor-api
  were rebuilt after final source fixes.
- `bun run api:extract` and `bun run api:check`: passed. Public snapshots include
  editing objects, enums, pagination inputs and canonical operation additions.
- `bun run typecheck` and consumer workspace `typecheck`: passed. Consumer types
  resolve the built public declarations.
- `bun run lint`: zero errors; 97 existing warnings. `bun run format:check` passed.
- `bun run check:parity`, `check:license-headers`, `check:lane-boundaries`,
  `check:docs-mdx`, and `check:public-docs-surface`: passed.
- `bun install --frozen-lockfile`: passed, no lockfile changes.
- `openspec validate agent-editing-subset --strict`: passed.
- Final consumer commands from `examples/editor-api-consumers/README.md`: contract
  passes both hosts; report passes all seven actions on both hosts; browser output
  passes the full server preservation assertions and reports no console errors.
- `compat:report`: fixed profile **81/81 present, 81/81 exact signatures (100%)**;
  broad editing inventory **88/969 exact signatures (9.08%)**. Both are informational
  signature metrics, with per-member runtime notes; neither is Word behavior parity.

The original full-suite attempt identified seven outdated tests/fixtures; their
behavior expectations, canonical-op coverage and frozen operation manifest were
corrected before the final clean run. The independent review has no unresolved
required finding. Native Word evidence is recorded in `review.md`.
