// The workspace entries in bun.lock mirror each package's own package.json: its version
// and the ranges it declares. `changeset version` rewrites those package.json files, and
// `bun install --frozen-lockfile` still passes when the lockfile lags behind them, because
// workspace packages resolve locally. So the lockfile drifted silently through two
// releases. `version-packages` now refreshes it, and this check keeps it honest.
// It refreshes twice: Bun 1.4.2's first `--lockfile-only` pass after a version bump
// records the new workspace versions but keeps the old ranges between workspaces.
//
//   node scripts/check-lockfile-workspaces.mjs [--lockfile PATH]
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = args.indexOf('--lockfile');
const lockfilePath = flag === -1 ? 'bun.lock' : args[flag + 1];
const root = process.cwd();

// bun.lock is JSON with trailing commas.
const lockfile = JSON.parse(
  readFileSync(path.resolve(root, lockfilePath), 'utf8').replace(/,(\s*[}\]])/g, '$1')
);
const workspaces = lockfile.workspaces ?? {};
const problems = [];
for (const [dir, entry] of Object.entries(workspaces)) {
  const manifestPath = path.join(root, dir, 'package.json');
  if (!existsSync(manifestPath)) {
    problems.push(`${dir}: listed in the lockfile but has no package.json`);
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.name !== entry.name)
    problems.push(`${dir}: lockfile names ${entry.name}, package.json names ${manifest.name}`);
  // Bun records no version for the root workspace.
  if (dir !== '' && (manifest.version ?? null) !== (entry.version ?? null))
    problems.push(
      `${dir}: lockfile records version ${entry.version ?? '(none)'}, package.json says ${manifest.version ?? '(none)'}`
    );
  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    const want = manifest[field] ?? {};
    const have = entry[field] ?? {};
    for (const [name, range] of Object.entries(want)) {
      if (have[name] !== range)
        problems.push(
          `${dir}: ${field}.${name} is ${have[name] ?? '(missing)'} in the lockfile, ${range} in package.json`
        );
    }
    for (const name of Object.keys(have)) {
      if (!(name in want))
        problems.push(`${dir}: ${field}.${name} is in the lockfile but not in package.json`);
    }
  }
}
if (problems.length > 0) {
  console.error(
    `bun.lock is behind the workspace package.json files:\n  - ${problems.join('\n  - ')}\n\nFix: bun install --lockfile-only`
  );
  process.exit(1);
}
console.log(
  `✓ bun.lock workspace entries match ${Object.keys(workspaces).length} package.json files`
);
