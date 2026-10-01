// Decides which path the Release workflow takes for a push to main:
//   pending — changesets wait in .changeset/, so the run only updates the release PR;
//   publish — some public package version is not on npm, so the run builds and publishes;
//   idle    — every public package version is already on npm, so there is nothing to do.
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
// equals every public workspace. A member without a manifest has no version on npm.
export function publicPackages(root) {
  return json(join(root, '.changeset/config.json'))
    .fixed.flat()
    .map((name) => {
      const path = join(root, 'packages', name.split('/')[1], 'package.json');
      const manifest = existsSync(path) ? json(path) : { version: 'missing' };
      return { name, version: manifest.version, private: manifest.private === true };
    })
    .filter((entry) => !entry.private)
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
        () => false
      )
    )
  );
  const unpublished = packages
    .filter((_, index) => !published[index])
    .map(({ name, version }) => `${name}@${version}`);
  return { mode: unpublished.length > 0 ? 'publish' : 'idle', unpublished };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { mode, unpublished } = await releaseMode(process.cwd());
    console.log(`Release mode: ${mode}`);
    for (const label of unpublished) console.log(`Not on npm: ${label}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `mode=${mode}\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
