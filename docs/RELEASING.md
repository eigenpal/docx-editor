# Releasing

Use Changesets to prepare package releases for the DOCX editor.

The [Release workflow](../.github/workflows/release.yml) uses Changesets:

1. For each pull request that changes package code, add a `.changeset/*.md` file that describes the change.
2. Pushes to `main` open or update a `chore: release` PR aggregating those entries.
3. Merging that PR starts prepublish checks. After they pass, the workflow publishes to npm and creates a GitHub Release.

## Packages

| Package                             | Path                        | Published |
| ----------------------------------- | --------------------------- | --------- |
| `@docx-editor.dev/core`             | `packages/core`             | Yes       |
| `@docx-editor.dev/react`            | `packages/react`            | Yes       |
| `@docx-editor.dev/editor-api`       | `packages/editor-api`       | Yes       |
| `@docx-editor.dev/vue`              | `packages/vue`              | Yes       |
| `@docx-editor.dev/nuxt`             | `packages/nuxt`             | No        |
| `@docx-editor.dev/i18n`             | `packages/i18n`             | Yes       |
| `@docx-editor.dev/pro`              | `packages/pro`              | Yes       |
| `@docx-editor.dev/fonts`            | `packages/fonts`            | Yes       |
| `@docx-editor.dev/docx-to-markdown` | `packages/docx-to-markdown` | Yes       |

`@docx-editor.dev/editor-api` and `@docx-editor.dev/pro` use the EigenPal Pro License. See the [editor-api terms](../packages/editor-api/LICENSE.md) and [Pro terms](../packages/pro/LICENSE.md). Their manifests use `LicenseRef-EigenPal-Pro-Evaluation-1.0`.

Core, React, Vue, Nuxt, i18n, and DOCX to Markdown use Apache 2.0. The fonts package uses `Apache-2.0 AND OFL-1.1 AND LicenseRef-GUST-Font-License`.

The eight published packages are in a fixed group in `.changeset/config.json`. Changesets assigns them the same release version.

Example applications and the Nuxt package are private workspaces (`"private": true`). They are not published to npm. Private workspace versioning and tagging are disabled in Changesets, so these workspaces do not receive release version bumps or appear in the release PR's release notes. Keep example applications private when adding them to the workspace.

A changeset can declare one package bump. The other packages in the fixed group follow that bump. `@docx-editor.dev/i18n` changes use an i18n changeset.

## Python (PyPI) releases

The `docx-to-markdown` Python distribution uses the same Changesets version and changelog as `@docx-editor.dev/docx-to-markdown`. No separate Python version bump is needed:

1. Run `bun changeset` and select `@docx-editor.dev/docx-to-markdown` for Python package changes, including Python-only fixes. Describe the Python behavior in the summary.
2. Changesets updates `packages/docx-to-markdown/package.json` and its `CHANGELOG.md` in the release PR. The Python package's `pyproject.toml` reads that version directly when building a wheel.
3. After npm publication and version tagging, `release.yml` dispatches `python-wheels.yml` at the `vX.Y.Z` tag with `publish=true`.
4. The Python workflow builds and tests platform wheels, then uploads them through PyPI Trusted Publishing using the `pypi` GitHub environment.

The private `python/docx-to-markdown/package.json` is a build workspace; its `0.0.0` version is not the PyPI version. Keep it private so Changesets does not publish it to npm. The Python README links to the converter's generated changelog, which includes release notes for both the shared engine and Python wrapper.

Configure a PyPI Trusted Publisher for `docx-to-markdown` with repository `eigenpal/docx-editor`, workflow `python-wheels.yml`, and environment `pypi`. The workflow can also be dispatched manually at the release tag with `publish=true` to retry a failed upload or add missing platform wheels; existing wheels are skipped. Successful platform builds can publish even if another platform fails. Check the Python wheels run separately from the npm release to confirm platform coverage.

## Add a changeset

Run Changesets from the repository root, then stage the generated release note:

```bash
bun changeset
git add .changeset/*.md
```

Skip a changeset for test-only, documentation-only, and CI-only pull requests.

### Version increments

- `patch`: Bug fix or internal change without a public API change. Use this by default.
- `minor`: Additive public API change.
- `major`: Breaking public API change.

`changeset version` uses the highest increment across pending changesets for the fixed group. A pending `minor` change therefore increments every published package to the next minor version.

Write one or two sentences that describe the behavior consumers receive. Changesets copies this summary into `CHANGELOG.md`. Use active voice and omit implementation details, marketing language, and emojis. If the change resolves an issue, put `Fixes #N` at the end.

Changes to collaboration formats also require a compatibility decision. Format changes require at least a minor release and migration instructions. See [Collaboration compatibility](architecture/collaboration-compatibility.md).

## Publish a release

1. Find the open `chore: release` PR on `main`. The bot opens it when a changeset lands. Later changesets update the same PR.
2. Review the versions, generated changelog entries, and consumed changeset files. Confirm that the PR includes the intended commits and that CI passes for those commits. Bot-created release updates might not start pull-request CI. Preview and CodeQL checks alone do not establish release readiness.
3. Before a package's first release, configure its npm Trusted Publisher. It must authorize repository `eigenpal/docx-editor` and workflow `release.yml`. The workflow has no `NPM_TOKEN` fallback.
4. Merge the PR through the normal review process. The merge starts the Release workflow.
5. Wait for all Release jobs to pass. With an empty changeset queue, the workflow checks, builds, and tests the release candidate. It then publishes the validated artifacts, creates tags, and creates GitHub Releases with the changelog entries.
6. Check the separate Post-release updates workflow for registry verification and downstream updates. Also check the Python wheels workflow for PyPI publication.

If the former `@docx-editor.dev/agents` package is not yet deprecated, deprecate it after `@docx-editor.dev/editor-api` is available. Direct consumers to the replacement package. This is a one-time maintainer action outside the release workflow.

While changesets are pending, the workflow updates the release PR without running prepublish checks or builds. Contributor PRs run their own CI checks.

The publish path runs lint, formatting, type checks, tests, parity, license, and translation checks. A separate job builds packages and demos, validates a consumer install, and generates third-party notices. Publishing uses those artifacts only after every required job succeeds.

### Check documentation before merging

Match the pending changesets against the user guides, package READMEs, API snapshots, and `docs/site/data/word-features.ts`. Include usage instructions, upgrade steps, and unsupported cases for new behavior. Add Python release notes through the converter changeset, including the first Python release.

Run the documentation checks from the repository root:

```bash
bun run check:docs-mdx
bun run check:docs-chrome-slots
bun run check:docs-vue-refs
bun run check:public-docs-surface
bun run check:example-readmes
bun run format:check
bun run build:packages
bun run api:check
bun run docs:json
```

Build fresh package declarations before generating JSON. The generator also rewrites API snapshots, so stale builds can replace current API documentation with old declarations.

Review the generated release plan with `bun changeset status`. Keep all eight published npm packages on the intended version. Do not add an unreleased version to the generated collaboration release table; the post-release catalog updates it after verification.

These checks cover documentation and public declarations. Before publication, also require the [Release workflow](../.github/workflows/release.yml) checks on the release commit. These include lint, type checks, unit tests, parity, licenses, translations, consumer installation, and collaboration candidate tests.

For Python changes, check all five platform jobs in **Python wheels**. A passing npm release does not establish Python wheel availability. After publication, check the separate Python publish job and the documentation deployment.

### Common situations

| Situation | What to do |
| --- | --- |
| Hotfix, ship now | Land the fix PR with a `patch` changeset → release PR auto-updates → merge it. |
| Several PRs, ship together | All landed PRs aggregated into one release PR. Merge once, one coordinated release. |
| Forgot a changeset on a merged PR | Open a follow-up PR against `main` with `.changeset/foo.md`; let the bot regenerate the release PR. |
| Not ready to release yet | Don't merge the release PR. It keeps updating as new PRs land. |
| Publish step crashed after PR merged | Re-run the workflow manually (`workflow_dispatch` is kept for this). Check npm for partial publication before retrying. For failures after successful publication, see [Recover post-release updates without publishing](#recover-post-release-updates-without-publishing). |
| Breaking public API change | Add a `major` changeset and document the migration before merging. |
| No pending changesets | The workflow takes the publish path. It publishes package versions that are not on npm yet. |

## Configure release automation

| Where | What |
| --- | --- |
| npmjs.com | Trusted Publisher configured for each published `@docx-editor.dev/*` package, including `editor-api` and `docx-to-markdown`, → repo `eigenpal/docx-editor`, workflow `release.yml` |
| `package.json` | `"publishConfig": { "access": "public" }` on each published package |
| `.changeset/config.json` | `"access": "public"`; fixed release group for the eight published packages; private workspace versioning and tagging disabled |
| GitHub perms | Settings → Actions → General → Workflow permissions = **Read and write**, **Allow GitHub Actions to create and approve pull requests** = on |
| GitHub secrets | `SLACK_WEBHOOK_URL` (optional — release notifications) |

### Configure Dependabot notifications

Set the repository secret `DOCX_EDITOR_SLACK_WEBHOOK_URL` to an incoming webhook for the channel that receives Dependabot notifications. Both alert summaries and reminder failure notices use this destination. Release notifications continue to use `SLACK_WEBHOOK_URL`.

Create the webhook for the intended channel in Slack, then save its URL in the repository's Actions secrets. Incoming webhooks have a fixed destination; a channel name or ID cannot override it. See [Sending messages using incoming webhooks](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/).

Configure the secret before enabling the reminder workflow. A weekly run posts a summary even when no alerts are open. Daily runs post only for high or critical alerts. If the secret is missing, a run that needs to post fails without sending to the release channel.

## Run a local release

Prefer the CI workflow. It uses OpenID Connect (OIDC) for npm Trusted Publishing and produces npm provenance.

For a local release, first complete the same validation as CI and configure npm authentication. Then run:

```bash
bun run version-packages
bun run release
```

`version-packages` updates versions, changelogs, the lockfile, and the generated Office.js compatibility fixture. `release` builds packages, generates notices, checks collaboration decisions, tests and verifies the packed candidate, and publishes to npm. It does not run every CI check or the post-release workflows.

## Anti-patterns to avoid

- **Don't push directly to `main` with a `chore: release` commit by hand.** That bypasses the release PR, skips CI, and confuses the changesets/action state machine on the next push.
- **Don't manually delete `.changeset/*.md` files** outside of `changeset version`. They're the single source of truth for what's pending.
- **Don't edit `CHANGELOG.md` by hand.** It's auto-generated from changesets; manual edits get clobbered on the next release.
- **Don't edit the `version` field in `package.json` by hand.** `changeset version` owns it.
- **Don't hand-write package names in changeset frontmatter.** Run `bun changeset` so the names come from the workspace — a typo crashes the post-merge Release workflow and blocks all releases.

## Post-release verification and updates

The [Post-release updates workflow](../.github/workflows/post-release.yml) starts when Release completes. It checks that the source run published packages and created the version tag. Release-PR updates and runs that published nothing skip these tasks.

Release finishes without waiting for npm metadata propagation. The downstream workflow verifies the original tested artifacts, requests documentation and converter-site updates, captures and merges the collaboration baseline after CI passes, and comments on the shipped PRs and issues. A downstream failure has its own workflow status and alert; it does not change the completed Release run. Retried comments are deduplicated.

The release-success Slack notification runs immediately after publication and tagging. Documentation notifications come from the website's own sync and deployment workflows. A release notification therefore confirms publication; check the downstream workflows to confirm that the documentation is ready.

Automatic and manual downstream updates share a concurrency group that is separate from Release. Registry retries do not hold the release lock or delay another publication.

## Recover post-release updates without publishing

Use the [Recover release workflow](../.github/workflows/recover-release.yml) if npm publication succeeded but registry verification or downstream updates failed. Rerunning Release can skip these updates because Changesets reports that the packages are already published.

1. Open the original Release run. Confirm that **Release PR or Publish** succeeded, and copy the run ID from its URL.
2. Run the recovery workflow from `main` with the published version and original run ID. For example, to recover 2.19.0:

   ```bash
   gh workflow run recover-release.yml --ref main \
     -f version=2.19.0 \
     -f source_run_id=35011912193
   ```

3. Check the recovery run. It validates the source run and version tag, downloads the original `collaboration-candidate` artifact, checks its local hashes, and compares every published package's integrity with the tested tarball.
4. Check the downstream workflows in `docx-editor.dev` and `docx-to-markdown.com`. A successful dispatch means the update was requested; each site has its own generation, validation, and deployment steps.
5. Check the collaboration baseline PR. The catalog workflow waits for the full CI run and all PR checks, then merges the tested commit. If checks fail, the PR stays open. Fix the failure and rerun the catalog workflow to resume an existing PR.

Recovery does not build or publish packages, create release tags, or replay release announcements. It only updates sites for the current npm `latest` version at verification time. Downstream updates are serialized separately from publication to keep their requests ordered. To capture a historical baseline, run `collaboration-catalog.yml` with its `version` input separately.

The candidate artifact is retained for 30 days on new Release runs. Earlier runs keep their original retention period. If the original artifact has expired, stop: a rebuilt tarball does not establish what the original release tested.

### Registry verification and retries

In the downstream workflow, artifact verification and the `latest` tag checks share one 10-minute deadline. This is a maximum: verification finishes as soon as all checks pass, with no fixed delay before the first request. Packages are checked concurrently. The verifier retries network errors, HTTP 404, 408, 429, and temporary server errors with increasing delays, respects `Retry-After`, and logs the package, last error, and remaining time.

If the version endpoint is unavailable, the verifier also checks the exact version in npm's package metadata. It never substitutes the `latest` version. Authentication errors and metadata or integrity mismatches fail immediately. A timeout keeps downstream updates blocked; use recovery after npm becomes available. An integrity mismatch requires investigation before any recovery.

The `latest` tags can update after the version metadata becomes available. After verifying the artifacts, recovery waits for the core and converter tags within the remaining deadline. A missing tag or an older stable version triggers a retry. A newer stable version stops recovery to prevent a site downgrade. Unexpected tag values also fail. Logs distinguish a stale tag from a superseded release.
