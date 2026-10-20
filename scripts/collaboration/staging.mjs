import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, run, writeJSON } from './common.mjs';

// Read the full pending plan, including notes already merged on main. Unlike the
// status CLI, this API does not require a local base branch in detached CI checkouts.
export async function pendingVersions() {
  const pending = readdirSync(join(ROOT, '.changeset')).some(
    (file) => file.endsWith('.md') && file !== 'README.md'
  );
  if (!pending) return {};
  // Compatibility shards consume a packed candidate without root dev dependencies.
  const { getReleasePlan } = await import('@changesets/get-release-plan');
  const plan = await getReleasePlan(ROOT);
  return Object.fromEntries(plan.releases.map((entry) => [entry.name, entry.newVersion]));
}
export function stageManifest(manifest, versions) {
  const next = { ...manifest, version: versions[manifest.name] ?? manifest.version };
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    if (!manifest[field]) continue;
    next[field] = Object.fromEntries(
      Object.entries(manifest[field]).map(([name, range]) => [
        name,
        versions[name] ? `~${versions[name]}` : range,
      ])
    );
  }
  return next;
}
export function stageTarball(source, destination, versions) {
  const temporary = mkdtempSync(join(tmpdir(), 'collaboration-staged-package-'));
  try {
    run('tar', ['-xzf', source, '-C', temporary]);
    const directory = join(temporary, 'package');
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    writeJSON(join(directory, 'package.json'), stageManifest(manifest, versions));
    return JSON.parse(
      run(
        'npm',
        ['pack', '--json', '--ignore-scripts', '--pack-destination', destination],
        directory
      )
    )[0];
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
