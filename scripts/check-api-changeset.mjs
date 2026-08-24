#!/usr/bin/env node
/**
 * A PR that changes the public API surface must carry a changeset.
 *
 * `docs/api/*.api.md` are the API Extractor snapshots: a diff there means a `@public`
 * symbol moved. The snapshots themselves gate nothing about VERSIONING — regenerating and
 * committing them is green — so without this check a PR can delete a public export and
 * ship it as an unversioned change. CLAUDE.md's rule is "every code PR gets a changeset";
 * an API-surface change is never a test/docs/CI-only PR, so here the rule is enforceable.
 *
 * Usage: node scripts/check-api-changeset.mjs --base origin/main
 * Runs on pull_request only (the workflow guards merge commits and the
 * changeset-release/* branches, where consumed changesets legitimately disappear).
 */
import { execFileSync } from 'node:child_process';

const baseIndex = process.argv.indexOf('--base');
const base = baseIndex > -1 ? process.argv[baseIndex + 1] : null;
if (!base) {
  console.error('usage: check-api-changeset.mjs --base <ref>');
  process.exit(2);
}

const diff = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);

const apiChanges = diff.filter((path) => path.startsWith('docs/api/'));
if (apiChanges.length === 0) {
  console.log('api-changeset: no docs/api change in this PR — nothing to require.');
  process.exit(0);
}

const changesets = diff.filter(
  (path) => /^\.changeset\/[^/]+\.md$/.test(path) && path !== '.changeset/README.md'
);
if (changesets.length > 0) {
  console.log(
    `api-changeset: ${apiChanges.length} docs/api change(s) covered by ${changesets.length} changeset(s).`
  );
  process.exit(0);
}

console.error('This PR changes the public API surface without a changeset:');
for (const path of apiChanges.slice(0, 20)) console.error(`  - ${path}`);
if (apiChanges.length > 20) console.error(`  … and ${apiChanges.length - 20} more`);
console.error('');
console.error(
  'Run `bun changeset` (or hand-write .changeset/<name>.md) so the release pipeline versions this change.'
);
process.exit(1);
