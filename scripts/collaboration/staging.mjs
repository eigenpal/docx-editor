import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, writeJSON } from './common.mjs';

// Use Changesets' own release plan. Do not independently calculate fixed-group versions.
export function pendingVersions() {
  const temporary = mkdtempSync(join(tmpdir(), 'collaboration-release-plan-'));
  try {
    const output = join(temporary, 'plan.json');
    run('bun', ['x', '--no-install', 'changeset', 'status', '--output', output]);
    const plan = JSON.parse(readFileSync(output, 'utf8'));
    return Object.fromEntries(plan.releases.map((entry) => [entry.name, entry.newVersion]));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
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
