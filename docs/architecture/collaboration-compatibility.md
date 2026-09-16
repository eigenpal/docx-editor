# Collaboration compatibility policy

Use this process when you change how full-document collaboration stores, edits,
or synchronizes a document. It starts with the published 2.18.0 release. It covers
clients, servers, export workers, and background agents.

If you operate an application, see
[Collaboration versions and upgrades](../site/content/pro/collaboration-versions.mdx).
Experimental text collaboration has a separate contract.

## Choose your task

| If you need to…                           | Go to…                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| Understand what makes a change breaking   | [Understand compatibility](#understand-compatibility)                           |
| Submit a fix or feature                   | [Contributor workflow](#contributor-workflow)                                   |
| Change the collaboration format           | [Document a migration](#document-a-migration)                                   |
| Diagnose a failed check                   | [Troubleshoot a compatibility check](#troubleshoot-a-compatibility-check)       |
| Prepare a release or capture its baseline | [Release gate and baseline maintenance](#release-gate-and-baseline-maintenance) |
| Upgrade stored collaboration data         | [Operator migration checklist](#operator-migration-checklist)                   |

## Understand compatibility

A collaboration room contains shared editing state. Each participant holds a copy,
called a _replica_. Participants exchange updates to keep their replicas in sync.
Yjs is the library that manages those shared updates.

A saved room includes collaboration identities and history. A DOCX export contains
the document content, but does not carry that room's synchronization or undo history.
Changing a package version does not convert the saved room.

### Package version and collaboration format

A _package version_, such as `2.18.0`, identifies an npm release. A _collaboration
format_ identifies the rules that participants use to interpret shared data.

Two package releases can share a format. They can use compatible rooms even when
one release contains bug fixes that the other lacks. Different formats must refuse
synchronization before shared updates enter a room.

The published 2.18.0 format is `docx-collaboration:1.3.1.1`. Its four numbers come
from `DOCUMENT_COLLABORATION_VERSIONS`, in this order:

| Field                   | What it describes                                                      | Example of an incompatible change                                    |
| ----------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `protocolVersion`       | How participants exchange and interpret synchronization messages.      | A message field has a different meaning.                             |
| `sharedSchemaVersion`   | How shared nodes, characters, and identities are stored.               | An existing stored identity uses a different representation.         |
| `repairVersion`         | How participants resolve invalid or conflicting structures.            | Two versions choose different surviving nodes for the same conflict. |
| `canonicalModelVersion` | How the editor represents document content in its authoritative model. | The same shared content maps to different document structures.       |

These examples explain when to review a field. They do not require a bump for
every change in the named area.

In application connection checks, compare the complete exported format value.
Do not parse the numbers or override the installed package's value.

### Why a bug fix can require a migration

Compatibility includes behavior, not only the names of stored fields. For example,
a fix can change how participants interpret text offsets or choose a conflict winner.
If old and replacement code assign different meanings to the same state, the fix
requires a format change and a saved-room migration.

A fix can also preserve the format. For example, a split operation can stop writing
incorrect replacement identities for text that it moves to another paragraph.
Released readers already understand the corrected writes. The old writer still has
its original bug, but that does not make the corrected representation incompatible.

Test the fixed writer against released readers. Also test ordinary editing with both
versions as writers. Do not require released code to contain a later fix.

## Decide whether a change is compatible

Choose a decision based on shared behavior:

| Decision             | Use it when…                                                               | Evidence to provide                                                            |
| -------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `no-impact`          | The implementation change cannot affect shared state or synchronization.   | Explain why shared behavior stays unchanged.                                   |
| `compatible`         | Released participants retain the same meaning for shared data and updates. | Explain why and identify regression tests.                                     |
| `migration-required` | Participants would interpret shared data or updates differently.           | Identify affected format fields, regression tests, and migration instructions. |

Passing tests supports your decision. It does not replace a review of shared
behavior. If a test fails, investigate it before deciding to change the format.

For incompatible changes, increment each affected field. Never decrease a field or
reuse a previously published format after changing away from it. Several changes
can share one increment before that format is published. Record each change
separately and check the complete release before publication.

A format change requires at least a minor package release and a
`Breaking collaboration upgrade` notice. This project tracks room compatibility
separately from package versions. A minor release can therefore require room migration.
Public document APIs retain their separate version policy and Office.js compatibility
requirements.

## Contributor workflow

### Before you begin

Run commands from the repository root. Install the repository's Bun dependencies
with `bun install --frozen-lockfile`. Use Node.js 24 and npm for the isolated
published-package checks. You also need Git history and access to the npm registry.

Fetch the base branch and release tags:

```sh
git fetch origin main --tags
```

A _decision record_ explains the compatibility impact of your change. A _Changeset_
is a release-note file that selects a package version bump. They have different
lifetimes: decision records remain after Changesets generates the changelog.

To inspect commands without building packages or accessing the registry, run:

```sh
bun run collaboration:change --help
bun run collaboration:test --help
```

Unknown flags, duplicate options, and invalid seeds or shard numbers fail before
package preparation. An argument error leaves your previous failure report intact.

### Which PRs need a decision?

A pull request (PR) needs a decision if it changes implementation files covered by
[the compatibility policy](../../scripts/collaboration/policy.mjs). Covered code
includes document editing, collaboration, review, and provider integration.
Renames check both the removed and added paths.

Changes to `package.json`, `bun.lock`, release or build configuration, documentation,
tests, fixtures, and compatibility tools do not require a decision. A PR that also
changes covered implementation code still needs a decision for that code change.
Production-code changes still need the repository's normal Changeset.

Format-version checks and the checks that preserve published compatibility records,
catalog entries, and release artifacts apply independently of the decision requirement.

### Record and test your change

1. Add regression coverage for the behavior you change.
2. Create a decision with the interactive helper:

   ```sh
   bun run collaboration:change
   ```

   Enter a unique identifier, impact, before/after behavior, reason, and test paths.
   If your change affects production code, provide a consumer release summary.

   The helper writes `.collaboration/changes/IDENTIFIER.json`. When you provide a
   summary, it also writes `.changeset/IDENTIFIER.md`. Review both files.

3. Check your decision against the PR base:

   ```sh
   bun run collaboration:check --base origin/main
   ```

   Success prints `Compatibility policy passed`, followed by decision and changed-field
   counts. A failure identifies the requirement you need to resolve.

4. Build the packages and generate their third-party license notices:

   ```sh
   bun run build:packages
   bun run notices:generate
   ```

   The tests use packed packages. Rebuild after changing package source.

5. Test against one published release while developing:

   ```sh
   bun run collaboration:test --release 2.18.0
   ```

   Use a cataloged version relevant to your change. A single-release run does not
   replace the complete check. Targeted runs still validate historical fixture hashes.

6. Before requesting review, run the full catalog:

   ```sh
   bun run collaboration:test --all
   ```

   Success prints `Compatibility passed` with the number of releases checked.
   Reports are written under `.cache/collaboration/`.

7. Review your final diff. Resolve findings and rerun the affected checks.

A maintainer reviews the decision and its evidence before merging. Passing continuous
integration (CI) checks alone is not release approval.

### Read a decision record

The following example describes the compatible split fix. Use evidence for your own
change rather than copying its compatibility claim:

```json
{
  "impact": "compatible",
  "fields": [],
  "before": "Splitting formatted text can hide text moved to another paragraph.",
  "after": "The split preserves the moved text.",
  "reason": "Released readers already understand the corrected identities.",
  "tests": ["packages/pro/src/collaboration/__tests__/document-split-relocated-format.test.ts"],
  "changeset": "quiet-runs-travel",
  "migration": null
}
```

| Field             | What you provide                                                          |
| ----------------- | ------------------------------------------------------------------------- |
| `impact`          | One of the three compatibility decisions.                                 |
| `fields`          | Format fields that require an increment. Leave empty for other decisions. |
| `before`, `after` | Observable behavior before and after your change.                         |
| `reason`          | Why released code can share the state, or why migration is necessary.     |
| `tests`           | Paths to regression tests that support the decision.                      |
| `changeset`       | The release-note identifier without `.md`, or `null` when allowed.        |
| `migration`       | A release-specific upgrade-guide heading anchor, or `null`.               |

Keep records after Changesets consumes their release notes. If a decision has
already merged, add another record for a later correction. Do not rewrite history.

### Document a migration

1. Add a release-specific heading to
   [Collaboration versions and upgrades](../site/content/pro/collaboration-versions.mdx).
   Name the affected formats, required content checks, and recovery steps.
2. Increment the affected constants in
   [the compatibility version source](../../packages/pro/src/collaboration/document-compatibility.ts).
3. Run `bun run collaboration:change`. Select `migration-required`, name the affected
   fields, and provide the heading anchor and a consumer summary.

   For noninteractive use, the corresponding flags are `--impact`, `--fields`,
   `--migration`, and `--summary`. The helper still requires the other record fields.

   The helper creates a minor Changeset with the warning and guide link. It does not
   change runtime constants for you.

4. Complete the policy and package checks in [Contributor workflow](#contributor-workflow).

When Changesets generates the release changelog, retain the migration warning and
link. The release gate checks them after the individual Changeset file is consumed.

## Published-package test contract

A _candidate_ is the package build you want to release. A _baseline_ is a captured
published release used as a reference. The _release catalog_ lists every stable Pro
release from 2.18.0 onward.

A _fixture_ is saved test data. Each baseline includes a real saved room created by
that published code, using a synthetic document. It also includes an installation
lock and package provenance: the source commit, source lock hash, and npm integrity.
An _integrity value_ is a content hash used to detect different package bytes.

Historical fixtures are immutable. Do not recreate them with candidate code or edit
their format metadata. Doing so would stop the test from representing a saved room
created by a released application.

### What the matrix checks

The _compatibility matrix_ is the set of candidate-versus-release test combinations.
Each version runs in its own process, with one core runtime and one Yjs runtime.
Frozen npm locks select exact dependencies. Workspace imports cannot replace
published code in a released worker.

| Case                                           | Required checks                                                                                                                                                       |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidate with itself                          | Exercise editing regressions even when its format differs from all published formats.                                                                                 |
| Candidate with each release sharing its format | Create rooms in both directions. Use three participants to test concurrent edits, delayed, duplicate, and reordered updates, reconnects, undo/redo, and splits/joins. |
| Saved room from each cataloged release         | Inspect it without mutation. Export with compatible code, reseed a separate room, confirm empty undo history, and edit with two replacement clients.                  |
| Incompatible formats or room identities        | Refuse updates before they enter the destination room.                                                                                                                |

_Convergence_ means replicas reach the same document state after exchanging updates.
Convergence alone is insufficient: replicas could agree on a damaged document.
Tests also check expected text, export structure, comments, tracked changes, tables,
and binary assets.

CI divides the work into four _shards_, or parallel jobs. Together they cover the full
catalog. The aggregate `test` check requires every shard to pass. As the catalog
grows, keep every compatible stable release in the matrix rather than sampling it.

The migration rehearsal tests the reference admission boundary: the point where a
connection or update is accepted. Your application remains responsible for its
production provider, authorization, and storage configuration.

## Troubleshoot a compatibility check

A _seed_ is a number that selects a repeatable test sequence. On failure, the runner
saves the error and update trace in `.cache/collaboration/failure.json`. The report
includes the test phase, release, seed, shard, and a reproduction command. For a
mixed-version scenario, it also records which version created the room. A trace
contains the operations and update bytes for the failing scenario.

For a package setup or saved-room failure, the seed is `null` because that phase
does not use a random sequence. If you used `--candidate`, retain that directory
and add it to the reproduction command to reuse the same package build.

To reproduce a failure against 2.18.0 with seed 592, run:

```sh
bun run collaboration:test --release 2.18.0 --seed 592
```

Replace the version and seed with the values from your failure. For failures in the
candidate-only scenarios, run `bun run collaboration:test --all --seed 592` instead.

| Failure                                                              | What you do                                                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| A compatibility decision is missing                                  | Run `collaboration:change`, then explain the impact of this PR. An earlier PR's record does not cover your change.  |
| A migration heading or release warning is missing                    | Add the release-specific guide section and check the linked Changeset or generated changelog.                       |
| The release table is stale                                           | Run `bun run collaboration:catalog --table` and review the generated table.                                         |
| A published release is missing from the catalog                      | Capture its baseline and merge the catalog update before publishing another release.                                |
| A registry request or package install fails                          | Restore registry access and rerun. The gate does not treat unavailable evidence as a pass.                          |
| A package export is missing or the packed format differs from source | Rebuild packages, regenerate notices, and create another candidate.                                                 |
| The publication payload differs from the tested candidate            | Repeat candidate preparation and compatibility tests after the package change. Do not publish the untested payload. |
| A PR preview cannot pass the publication check                       | Use the release workflow after Changesets applies package versions.                                                 |
| Replicas disagree or document content changes unexpectedly           | Reproduce the seed, inspect the trace, and add a regression test before choosing a fix or migration.                |

Use synthetic documents in fixtures and traces. Do not commit customer documents
or diagnostic traces containing customer content.

## Release gate and baseline maintenance

### Verify the release candidate

A _release gate_ is a required check before publication. It reviews the combined
changes since the last published release, including records whose Changesets have
already become changelog entries.

A _fixed release group_ is a set of packages that Changesets versions together.
The preview uses that plan rather than calculating each package's version separately.
A _peer dependency_ tells the application which compatible shared runtime to supply.
Matching peer versions helps each test installation resolve one core runtime.

The pipeline prepares and verifies packages as follows:

1. For a contributor PR, Changesets calculates the full pending release plan,
   including notes already merged on main. The tool stages those versions in
   temporary package archives, called _tarballs_. Internal dependency and peer
   versions match that preview. Workspace manifests stay unchanged.
2. For a final release, Changesets has applied the versions. The pipeline builds,
   generates notices, packs the candidate, and runs the compatibility matrix.
3. Before publication, the gate compares the publication payload with the tested
   package hashes. After publication, it compares npm integrity values as well.

PR previews cannot pass the final publication check. Do not rebuild between testing
and publication. Missing catalog entries, unavailable packages, and failed evidence
or integrity checks block publication.

After publication, a separate Post-release updates workflow verifies registry
integrity. It retries transient failures for up to 10 minutes across all packages
and does not hold the Release workflow or its concurrency lock. A timeout or
integrity mismatch blocks downstream updates. To resume those updates using the original tested artifacts, follow
[Recover post-release updates without publishing](../RELEASING.md#recover-post-release-updates-without-publishing).

### Capture a published baseline

The catalog workflow prepares a baseline PR after publication. It waits for the
complete CI run, all four collaboration shards, and all registered PR checks
before merging the tested commit. Only the generated baseline files are eligible.
Failed checks or merge conflicts leave the PR open. Resolve those failures before
publishing another release.

The release App token allows CI to run on the generated PR. The workflow also
supports a manual retry. If the branch push succeeds but PR creation fails, retrying reuses and validates the captured baseline before creating
the PR. It does not recapture or force-push the release. If the PR was closed,
restore or reopen it before retrying.

For a manual capture:

1. Confirm that the release is published on npm and its `vX.Y.Z` tag exists.
2. Fetch release tags:

   ```sh
   git fetch origin --tags
   ```

3. Capture the release. The following command shows the initial baseline version:

   ```sh
   bun run collaboration:catalog --capture 2.18.0
   ```

   Replace `2.18.0` with the uncaptured published version. The initial baseline is
   already recorded; capturing it again fails by design. Capture releases in order.

4. Validate the catalog:

   ```sh
   bun run collaboration:catalog
   ```

5. Review the generated installation lock, fixture, metadata, and public release
   table together. Submit and merge the catalog PR after CI passes.

Capture installs the actual npm packages. It does not rebuild a source tag. The
source lock selects direct test runtimes; the installation lock freezes their
resolved dependency graph. Existing entries and fixtures cannot be overwritten.

## Operator migration checklist

_Export and reseed_ means exporting a DOCX with the compatible build, then using
that DOCX to initialize a separate room. The replacement room has fresh collaboration
identities and an empty undo history.

A _persistence key_ is the storage identifier for saved room state or queued updates.
Use fresh room and persistence keys so old updates cannot enter the replacement room.

For the complete procedure, see
[Upgrade saved rooms](../site/content/pro/collaboration-versions.mdx#upgrade-saved-rooms).
Before applying a migration in production, rehearse it on a backup:

1. Pause clients and background writers. Let accepted updates finish, and recover
   offline edits in the compatible deployment or as separate DOCX exports.
2. Back up room state, assets, and the application build that can read them.
3. Export with that build. Reopen the DOCX and verify the expected content.
4. Create fresh room and persistence keys. Initialize the replacement room from
   the verified DOCX.
5. Deploy matching clients, servers, export workers, and agents. Verify editing and
   export, then keep the original room read-only until you accept the migration.

Before replacement-room editing starts, rollback can route users to the original
room. After editing starts, preserve and reconcile those edits before rollback.
Never copy queued updates between the rooms.

This process provides policy, automated checks, and a migration rehearsal. Operators
perform production migration. It does not add a production migration command or
negotiate compatibility between different formats.
