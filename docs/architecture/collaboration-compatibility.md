# Collaboration compatibility policy

This process starts with the published 2.18.0 release. It covers full-document
collaboration, including clients, servers, export workers, and background agents.
Experimental text collaboration has a separate contract.

## Decide whether a change is compatible

A format identifies shared behavior as well as stored fields. A bug fix can change
how clients interpret identities, text offsets, conflicts, or repair rules. That
change can require a migration without adding or removing a stored field.

| Decision             | Requirement                                                                           |
| -------------------- | ------------------------------------------------------------------------------------- |
| `no-impact`          | Explain why the change cannot affect shared state or synchronization.                 |
| `compatible`         | Explain why released clients retain the same shared meaning. Add regression evidence. |
| `migration-required` | Identify affected format fields. Add migration instructions and regression evidence.  |

An existing bug in an old release does not itself make a fix incompatible. A fix
that preserves shared meaning can keep the format. Test its corrected writes against
released readers. Keep ordinary editing tests in both writer directions. Do not
require old code to implement the new fix.

Passing tests supports the decision. It does not replace a review of shared behavior.
Do not change a format merely to avoid an unexplained test failure.

Keep the existing `DOCUMENT_COLLABORATION_VERSIONS` fields:

| Field                   | Bump when incompatible changes affect                         |
| ----------------------- | ------------------------------------------------------------- |
| `protocolVersion`       | Transport message interpretation or synchronization protocol. |
| `sharedSchemaVersion`   | Shared node, character, identity, or storage representation.  |
| `repairVersion`         | Deterministic structural repair behavior.                     |
| `canonicalModelVersion` | The document model that each replica interprets.              |

Increment each affected field. Never decrease a field or reuse a published format.
Several changes in one unreleased format can share the same increment. Explain each
change in its own decision record. Check the combined release before publication.

Package versions and collaboration formats are separate. A format change requires
at least a minor package release. It must include a **Breaking collaboration upgrade**
notice. Public document APIs retain their separate version policy and Office.js
compatibility requirements. Format changes do not permit document API changes.

## Contributor workflow

1. Add regression coverage for the behavior you change.
2. Run `bun run collaboration:change`.
3. Review the generated decision and Changeset.
4. Run `bun run collaboration:check --base origin/main`.
5. Build packages and generate notices.
6. Run `bun run collaboration:test --release 2.18.0` during development.
7. Run `bun run collaboration:test --all` before requesting review.
8. Review your final diff. Fix findings and rerun the affected checks.

The full commands for steps 5–7 are:

```sh
bun run build:packages
bun run notices:generate
bun run collaboration:test --all
```

The helper supports noninteractive flags. For example:

```sh
bun run collaboration:change \
  --id preserve-shared-offsets \
  --impact compatible \
  --before 'Concurrent formatting can lose shared text.' \
  --after 'Concurrent formatting preserves the same shared text.' \
  --reason 'The fix preserves the released offset and identity interpretation.' \
  --tests packages/pro/src/collaboration/__tests__/document-repeated-run-format.test.ts \
  --summary 'Preserve shared text during concurrent formatting.'
```

This example shows the record structure. Review the compatibility claim for the
actual fix. Do not copy its decision without checking the behavior.

For a migration, add a release-specific heading in the public upgrade guide first.
Use `--impact migration-required`, `--fields sharedSchemaVersion`, and
`--migration <heading-anchor>`. The helper creates a minor Changeset with the warning
and guide link. It does not modify runtime version constants for you.

The checked-in record includes the decision, before/after behavior, reasoning, test
paths, Changeset identifier, and migration heading. Keep records after Changesets
consumes their release notes. Do not modify a decision already merged into the base
branch. Add a new decision for a later correction.

### Which PRs need a decision?

The policy checks document-model, editing, collaboration, review, persistence,
provider integration, package configuration, and compatibility-tooling changes.
Its path rules live in `scripts/collaboration/policy.mjs`.

Lockfile and root package changes require a decision. This is conservative because
transitive runtime changes can affect compatibility. A tooling-only dependency
update can declare `no-impact`. Renames check both the removed and added paths.

Docs-only PRs and catalog-only updates need no decision. The existing Changeset
requirements still apply to production code. Test/docs/CI-only records can omit a
Changeset. Dependency-update PRs use the same policy after refreshing the lockfile.

A maintainer must review the decision and evidence before merging. The author must
resolve self-review findings first. A green test run alone is not release approval.

## Published-package test contract

The release catalog contains every stable Pro release from 2.18.0 onward. Each entry
records npm artifact integrity, source commit, source lock hash, format fields,
installation lock, and genuine saved-room fixtures.

Run released and candidate clients in separate processes. Each process has one core
runtime and one Yjs runtime. Install published releases from their frozen npm locks.
Do not import workspace source into released workers. Do not regenerate old fixtures
with current code or edit their format metadata.

For every release sharing the candidate format, test both room-creation directions.
Test three clients with concurrent edits, delayed and duplicate updates, reordered
delivery, undo/redo, splits/joins, and persistence reload. Check explicit text outcomes,
replica convergence, and export fidelity. Preserve comments, tracked changes, tables,
and embedded binary parts in the fixture.

Different formats must refuse synchronization before updates enter a room. For saved
rooms, inspect without mutation and rehearse export with the compatible old build.
Reseed a separate room, verify empty undo history, and check editing with two new clients.
The rehearsal tests the reference admission boundary. Production provider and storage
configuration remain the application's responsibility.

Each failure records its release, deterministic seed, error, and update trace under
`.cache/collaboration/`. Reproduce one case with:

```sh
bun run collaboration:test --release 2.18.0 --seed 592
```

CI runs four shards. Each shard selects its complete portion of the release catalog.
The aggregate check requires all shards. Do not replace old versions with samples as
the catalog grows. npm caches verified downloads; peer installations remain isolated.
Tests use synthetic documents. Never put customer documents in diagnostic fixtures.

## Release gate and baseline maintenance

The release gate checks all changes since the last published release. It verifies
records after Changesets consumes their files. A migration must retain its warning
and guide link in the generated release changelog.

For contributor PRs, stage package versions from the Changesets release plan in
temporary tarballs. Match internal peer versions within that isolated installation.
The workspace remains unchanged. These preview packages cannot pass the publication check.

For a final release, build once, generate notices, and pack the candidate. Run compatibility tests on those
packages. Before publishing, compare package integrity with the tested payload.
Do not rebuild between testing and publication. Missing catalog entries, unavailable
packages, failed comparisons, and missing evidence block publication.

Capture a new baseline only after npm publication and the umbrella tag exist:

```sh
git fetch origin --tags
bun run collaboration:catalog --capture 2.18.0
bun run collaboration:catalog
```

Replace the version for later releases. Capture releases in order. The capture command
refuses to overwrite existing entries. Review the generated lock, fixture, metadata,
and public release table together. Capture uses published packages, not a tag rebuild.
The source lock pins direct test runtimes; the committed installation lock pins the
resolved transitive dependency graph.

The catalog workflow prepares this update after publication. It also supports manual
retry. Merge the catalog PR before publishing another release. A missing update fails
closed. CI must run on the catalog PR; the release App token triggers that CI.

## Operator migration checklist

Follow the public [saved-room upgrade guide](https://docx-editor.dev/pro/collaboration-versions#upgrade-saved-rooms).
Each release-specific section must name the affected formats and content checks.

Pause editing and background writers. Drain accepted updates. Recover offline edits
before migration. Back up room state, assets, and the compatible application build.
Export with that build and verify the DOCX. Create fresh room and persistence keys.
Deploy matching clients, servers, export workers, and agents. Reconnect participants
and verify edits and export. Keep old rooms read-only until migration is accepted.

Before new edits, rollback can route to the old room. After new edits, preserve and
reconcile those edits before rollback. Do not copy old queued Yjs updates into the new
room. Collaboration undo history resets. This process does not automate production
storage migration or format negotiation.
