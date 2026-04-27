# Releasing

This document explains how releases work for the DOCX editor, what every contributor needs to do per PR, and what the maintainer does to ship.

Releases follow the canonical [`changesets/action@v1`](https://github.com/changesets/action) flow:

1. Every code-touching PR drops a `.changeset/*.md` describing its change.
2. Pushes to `main` open or update a `chore: release` PR aggregating those entries.
3. Merging that PR publishes to npm and creates a GitHub Release.

## Packages

| Package                        | Path                 | Published?             |
| ------------------------------ | -------------------- | ---------------------- |
| `@eigenpal/docx-js-editor`     | `packages/react`     | ✅                     |
| `@eigenpal/docx-editor-agents` | `packages/agent-use` | ✅                     |
| `@eigenpal/docx-core`          | `packages/core`      | ❌ private             |
| `@eigenpal/docx-editor-vue`    | `packages/vue`       | ❌ private / community |

The two published packages are in a **fixed group** in `.changeset/config.json` — they always ship the same version. A changeset only needs to declare the bump for one; the other follows automatically.

## Author flow (every contributor, every code PR)

```bash
bun changeset       # interactive — pick bump + write a one-line summary
git add .changeset/*.md
# ... commit with the rest of your PR
```

Skip only for **test-only / docs-only / CI-only** PRs (no published-package code changed). When in doubt, add one — an extra patch entry is harmless; a missing entry ships invisibly.

### Bump levels (semver)

- **patch** — bug fix, internal refactor, no public API change. **Default — use this unless you have a clear reason not to.**
- **minor** — new public API (additive, backward compatible).
- **major** — breaking change to existing public API.

`changeset version` resolves to the **highest bump** across all pending changesets, so a single `minor` from another PR will correctly bump everything. You don't need to coordinate bumps with other authors.

The summary you write (`Add foo prop to DocxEditor`) goes verbatim into `CHANGELOG.md`, so write it for the **consumer** of the package — not for the team. Avoid PR/issue numbers in the body; the changelog tooling backlinks them automatically when needed.

## Release flow (the maintainer, when ready to ship)

1. **Look for an open PR titled `chore: release`** on `main`. The bot opens it automatically the first time a changeset lands; subsequent changeset-bearing PRs update the same PR with the latest bumps and CHANGELOG entries.
2. **Review the PR.** It shows: version bumps in `package.json`s, new CHANGELOG sections, and the `.md` files being drained from `.changeset/`. Treat it like any other PR — CI runs on it.
3. **Merge it.** Standard merge. No bypass, no manual workflow trigger needed.
4. **Wait ~3 minutes.** The post-merge workflow run sees an empty changeset queue, runs `changeset publish` against npm via OIDC Trusted Publishing (no `NPM_TOKEN`), creates per-package git tags (`@eigenpal/docx-js-editor@X.Y.Z`), and creates a GitHub Release with the new CHANGELOG section.

That's the entire release. One PR merge.

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

## First-time setup (already configured, documented for future reference)

| Where                    | What                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| npmjs.com                | Trusted Publisher configured for both packages → repo `eigenpal/docx-editor`, workflow `release.yml`                                        |
| `package.json`           | `"publishConfig": { "access": "public" }` on each published package                                                                         |
| `.changeset/config.json` | `"access": "public"`; `fixed: [["@eigenpal/docx-js-editor", "@eigenpal/docx-editor-agents"]]`                                               |
| GitHub perms             | Settings → Actions → General → Workflow permissions = **Read and write**, **Allow GitHub Actions to create and approve pull requests** = on |
| GitHub secrets           | `SLACK_WEBHOOK_URL` (optional — release notifications)                                                                                      |

## Manual / local releases (don't, but if you must)

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
- **Don't open changesets for `@eigenpal/docx-core` or `@eigenpal/docx-editor-vue`** — they're listed in `.changeset/config.json` `ignore`.
