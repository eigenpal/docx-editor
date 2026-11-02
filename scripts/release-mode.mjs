// Decides which path the Release workflow takes for a push to main:
//   pending — changesets wait in .changeset/, so the run only updates the release PR;
//   publish — some public package version is not on npm, so the run builds and publishes;
//   idle    — every public package version is already on npm, so there is nothing to do.
// A canary run (schedule, or a manual run with channel=canary) takes its own decision:
//   canary  — changesets that release a package are pending, the newest main commit that
//             passed CI is not yet on the `canary` dist-tag of every public package, and
//             no stable release is active;
//   idle    — any other answer, including every failed lookup. A skipped night costs
//             nothing; the next scheduled run retries.
// The idle path skips the prepublish jobs that `changeset publish` would discard anyway.
// Any registry answer other than the exact version present counts as unpublished, so a
// registry failure falls back to the full publish path, never to a skipped release.
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registry } from './collaboration/registry.mjs';

// Bounds every lookup, so a slow registry reaches the publish fallback well within the
// mode job's timeout. The lookups run in parallel.
const LOOKUP_DEADLINE_MS = 60_000;

const json = (path) => JSON.parse(readFileSync(path, 'utf8'));

export function pendingChangesets(root) {
  const directory = join(root, '.changeset');
  return readdirSync(directory).filter((name) => name.endsWith('.md') && name !== 'README.md');
}

// The fixed group is the published package set; scripts/release-plan.test.ts proves it
// equals every public workspace. Manifests resolve by package name, not directory name.
export function publicPackages(root) {
  const manifests = new Map(
    readdirSync(join(root, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, 'packages', entry.name, 'package.json'))
      .filter((path) => existsSync(path))
      .map((path) => json(path))
      .map((manifest) => [manifest.name, manifest])
  );
  return json(join(root, '.changeset/config.json'))
    .fixed.flat()
    .map((name) => {
      const manifest = manifests.get(name);
      if (!manifest) throw new Error(`No packages/*/package.json is named ${name}`);
      return manifest;
    })
    .filter((manifest) => !manifest.private)
    .map(({ name, version }) => ({ name, version }));
}

export async function releaseMode(root, lookup = registry, now = Date.now) {
  if (pendingChangesets(root).length > 0) return { mode: 'pending', unpublished: [] };
  const packages = publicPackages(root);
  if (packages.length === 0) throw new Error('The changesets fixed group lists no packages');
  const deadline = now() + LOOKUP_DEADLINE_MS;
  const published = await Promise.all(
    packages.map(({ name, version }) =>
      lookup(name, version, { deadline }).then(
        (metadata) => metadata?.version === version,
        (error) => {
          console.log(`Registry check failed for ${name}@${version}: ${error.message}`);
          return false;
        }
      )
    )
  );
  const unpublished = packages
    .filter((_, index) => !published[index])
    .map(({ name, version }) => `${name}@${version}`);
  return { mode: unpublished.length > 0 ? 'publish' : 'idle', unpublished };
}

export const CANARY_TAG = 'canary';
// The suffix that `.changeset/config.json` snapshot.prereleaseTemplate puts at the end of
// every canary version. A short hash can be all digits with a leading zero, which is not a
// valid semver identifier, so the template prefixes it.
export const canarySuffix = (commit) => `.sha-${commit.slice(0, 7)}`;

// Changesets that bump at least one package. An empty changeset releases nothing, so
// `changeset version --snapshot` would leave every version unchanged.
export function pendingReleases(root) {
  return pendingChangesets(root).filter((name) => {
    const text = readFileSync(join(root, '.changeset', name), 'utf8');
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
    return /^\s*['"]?[^'"\n:]+['"]?\s*:\s*['"]?(?:patch|minor|major)['"]?\s*$/m.test(frontmatter);
  });
}

// Dist-tags of one package: {} when npm has no such package, null when the lookup failed.
export async function distTags(name, { fetch: request = globalThis.fetch } = {}) {
  try {
    const response = await request(
      `https://registry.npmjs.org/-/package/${encodeURIComponent(name)}/dist-tags`,
      { signal: AbortSignal.timeout(30_000), headers: { accept: 'application/json' } }
    );
    if (response.status === 404) return {};
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.log(`Dist-tag lookup failed for ${name}: ${error.message}`);
    return null;
  }
}

// Every refusal answers idle: a skipped night costs nothing, and the next run retries.
export async function canaryMode(root, commit, tags = distTags) {
  if (!/^[0-9a-f]{40}$/.test(commit ?? '')) throw new Error('The canary needs a full commit hash');
  if (pendingReleases(root).length === 0)
    return { mode: 'idle', reason: 'no pending changesets release a package' };
  const packages = publicPackages(root);
  if (packages.length === 0) throw new Error('The changesets fixed group lists no packages');
  const current = await Promise.all(packages.map(({ name }) => tags(name)));
  const failed = packages.filter((_, index) => current[index] === null);
  if (failed.length > 0)
    return { mode: 'idle', reason: `dist-tag lookup failed for ${failed[0].name}` };
  // npm points `latest` at the first version of a new package, even one published with
  // --tag canary. A new package must reach `latest` through a stable release first.
  const unreleased = packages.filter((_, index) => !current[index].latest);
  if (unreleased.length > 0)
    return { mode: 'idle', reason: `${unreleased[0].name} has no stable release yet` };
  // Every package, not one: a publish that stopped partway leaves some tags behind, and the
  // next run must publish the whole set again.
  const done = current.every((value) => value[CANARY_TAG]?.endsWith(canarySuffix(commit)));
  return done
    ? { mode: 'idle', reason: `canary already holds ${commit.slice(0, 7)}` }
    : { mode: 'canary', reason: `publish a canary of ${commit.slice(0, 7)}` };
}

// A canary must never publish while a stable release can publish the same packages: two
// writes to one npm package at once can fail one of them. Main without pending changesets
// means the release PR was merged, so a stable publish is due or done. Any other active
// Release run that is not scheduled might be that publish. Errors answer "not clear".
export async function stableReleaseClear({
  repository,
  runId,
  token,
  fetch: request = globalThis.fetch,
}) {
  const api = async (path) => {
    const response = await request(`https://api.github.com/repos/${repository}/${path}`, {
      signal: AbortSignal.timeout(30_000),
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
    });
    if (!response.ok) throw new Error(`GitHub API ${path}: HTTP ${response.status}`);
    return response.json();
  };
  try {
    const files = await api('contents/.changeset?ref=main');
    if (!files.some(({ name }) => name.endsWith('.md') && name !== 'README.md'))
      return { clear: false, reason: 'main has no pending changesets; a stable release is due' };
    const { workflow_runs: runs } = await api('actions/workflows/release.yml/runs?per_page=50');
    const active = runs.filter(
      (run) =>
        String(run.id) !== String(runId) && run.event !== 'schedule' && run.status !== 'completed'
    );
    if (active.length > 0) return { clear: false, reason: `Release run ${active[0].id} is active` };
    return { clear: true, reason: 'no stable release is active' };
  } catch (error) {
    return {
      clear: false,
      reason: `cannot confirm that no stable release is active: ${error.message}`,
    };
  }
}

const gate = () =>
  stableReleaseClear({
    repository: process.env.GITHUB_REPOSITORY,
    runId: process.env.GITHUB_RUN_ID,
    token: process.env.GH_TOKEN,
  });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const output = (line) => {
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
    };
    if (process.env.RELEASE_CHANNEL === 'canary-gate') {
      // The canary job's last check, right before it publishes.
      const { clear, reason } = await gate();
      console.log(`Stable release clear: ${clear} (${reason})`);
      output(`clear=${clear}`);
    } else if (process.env.RELEASE_CHANNEL === CANARY_TAG) {
      let { mode, reason } = await canaryMode(process.cwd(), process.env.CANARY_COMMIT);
      if (mode === CANARY_TAG) {
        const result = await gate();
        if (!result.clear) ({ mode, reason } = { mode: 'idle', reason: result.reason });
      }
      console.log(`Release mode: ${mode} (${reason})`);
      output(`mode=${mode}`);
    } else {
      const { mode, unpublished } = await releaseMode(process.cwd());
      console.log(`Release mode: ${mode}`);
      for (const label of unpublished) console.log(`Not on npm: ${label}`);
      output(`mode=${mode}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
