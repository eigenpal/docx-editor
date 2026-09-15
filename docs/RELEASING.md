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

`@docx-editor.dev/editor-api` and `@docx-editor.dev/pro` use the EigenPal Pro
License. See the [editor-api terms](../packages/editor-api/LICENSE.md) and
[Pro terms](../packages/pro/LICENSE.md). Their manifests use
`LicenseRef-EigenPal-Pro-Evaluation-1.0`.

Core, React, Vue, Nuxt, i18n, and DOCX to Markdown use Apache 2.0. The fonts package uses
`Apache-2.0 AND OFL-1.1 AND LicenseRef-GUST-Font-License`.

All nine packages are in a fixed group in `.changeset/config.json`. Changesets assigns them the same release version, including the private Nuxt package.

A changeset can declare one package bump. The other packages in the fixed group follow that
bump. `@docx-editor.dev/i18n` changes use an i18n changeset.

## Add a changeset

```bash
bun changeset       # interactive — pick bump + write a one-line summary
git add .changeset/*.md
# ... commit with the rest of your PR
```

Skip a changeset for test-only, documentation-only, and CI-only pull requests.

### Bump levels (semver)

- **patch**: Bug fix or internal change without a public API change. Use this by default.
- **minor**: Additive public API change.
- **major**: Breaking public API change.

`changeset version` resolves to the **highest bump** across all pending changesets, so a single `minor` from another PR will correctly bump everything. You don't need to coordinate bumps with other authors.

The summary you write (`Add foo prop to DocxEditor`) goes verbatim into `CHANGELOG.md`, so write it for the **consumer** of the package — not for the team. Avoid PR/issue numbers in the body; the changelog tooling backlinks them automatically when needed.

## Publish a release

1. **Look for an open PR titled `chore: release`** on `main`. The bot opens it automatically the first time a changeset lands; subsequent changeset-bearing PRs update the same PR with the latest bumps and CHANGELOG entries.
2. **Review the PR.** It shows: version bumps in `package.json`s, new CHANGELOG sections, and the `.md` files being drained from `.changeset/`. Treat it like any other PR — CI runs on it.
3. **Before a package's first release, configure its npm Trusted Publisher.** This includes `@docx-editor.dev/docx-to-markdown`. It must authorize repo `eigenpal/docx-editor` and workflow `release.yml`; the release workflow has no `NPM_TOKEN` fallback.
4. **Merge it.** Standard merge. No bypass, no manual workflow trigger needed.
5. **Wait for the Release workflow.** With an empty changeset queue, it runs independent checks and builds in parallel. After all jobs pass, it publishes the validated artifacts through npm Trusted Publishing, creates package tags, and creates a GitHub Release with the changelog entries. Check the workflow result before announcing the release.
6. **After the renamed package is available, deprecate `@docx-editor.dev/agents` on npm.** Point consumers to `@docx-editor.dev/editor-api`; this is a one-time maintainer action outside the release workflow.

While changesets are pending, the workflow updates the release PR without
running prepublish checks or builds. Contributor PRs run their own CI checks.

The publish path runs lint, formatting, type checks, tests, parity, license,
and translation checks. A separate job builds packages and demos, validates a
consumer install, and generates third-party notices. Publishing uses those
artifacts only after every required job succeeds.

### Common situations

| Situation                                | What to do                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Hotfix, ship now                         | Land the fix PR with a `patch` changeset → release PR auto-updates → merge it.                          |
| Several PRs, ship together               | All landed PRs aggregated into one release PR. Merge once, one coordinated release.                     |
| Forgot a changeset on a merged PR        | Open a tiny follow-up PR with just `.changeset/foo.md`, _or_ edit the release PR's frontmatter inline.  |
| Not ready to release yet                 | Don't merge the release PR. It keeps updating as new PRs land.                                          |
| Publish step crashed after PR merged     | Re-run the workflow manually (`workflow_dispatch` is kept for this). `changeset publish` is idempotent. |
| Need to force a major bump for marketing | Edit a pending changeset's frontmatter from `minor` → `major` before merging.                           |
| No pending changesets                    | No release PR opens. Nothing to ship.                                                                   |

## Configure release automation

| Where                    | What                                                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npmjs.com                | Trusted Publisher configured for each published `@docx-editor.dev/*` package, including `editor-api` and `docx-to-markdown`, → repo `eigenpal/docx-editor`, workflow `release.yml` |
| `package.json`           | `"publishConfig": { "access": "public" }` on each published package                                                                                                                |
| `.changeset/config.json` | `"access": "public"`; fixed release group for all nine packages listed above                                                                                                       |
| GitHub perms             | Settings → Actions → General → Workflow permissions = **Read and write**, **Allow GitHub Actions to create and approve pull requests** = on                                        |
| GitHub secrets           | `SLACK_WEBHOOK_URL` (optional — release notifications)                                                                                                                             |

## Run a local release

```bash
bun run version-packages   # consume .changeset/*.md → bump versions + write CHANGELOGs
bun run release            # build + changeset publish (needs NPM_TOKEN locally)
```

The CI flow is preferred because it uses OIDC (no long-lived npm token needed) and produces npm provenance.

## Anti-patterns to avoid

- **Don't push directly to `main` with a `chore: release` commit by hand.** That bypasses the release PR, skips CI, and confuses the changesets/action state machine on the next push.
- **Don't manually delete `.changeset/*.md` files** outside of `changeset version`. They're the single source of truth for what's pending.
- **Don't edit `CHANGELOG.md` by hand.** It's auto-generated from changesets; manual edits get clobbered on the next release.
- **Don't edit the `version` field in `package.json` by hand.** `changeset version` owns it.
- **Don't hand-write package names in changeset frontmatter.** Run `bun changeset` so the names come from the workspace — a typo crashes the post-merge Release workflow and blocks all releases.
