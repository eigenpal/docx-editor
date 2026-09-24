// The workspace entries in bun.lock mirror each package's own package.json: its version
// and the ranges it declares. `changeset version` rewrites those package.json files, and
// `bun install --frozen-lockfile` still passes when the lockfile lags behind them, because
// workspace packages resolve locally. So the lockfile drifted silently through two
// releases. `version-packages` now refreshes it, and this check keeps it honest.
// Bun 1.4.2's `--lockfile-only` records the new workspace versions but can keep the old
// ranges between workspaces, even on a second pass (the 2.22.1 release PR). So
// `version-packages` runs this with `--fix` after Bun: it rewrites a workspace entry's
// version and the ranges of the dependencies it already lists to match package.json. Those
// entries only mirror package.json, and workspace packages resolve locally, so this changes
// no resolution. A dependency that is missing or extra is left for Bun and still fails.
//
//   node scripts/check-lockfile-workspaces.mjs [--lockfile PATH] [--fix]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = args.indexOf('--lockfile');
const lockfilePath = flag === -1 ? 'bun.lock' : args[flag + 1];
const fix = args.includes('--fix');
const root = process.cwd();

// bun.lock is JSON with trailing commas.
let text = readFileSync(path.resolve(root, lockfilePath), 'utf8');
const lockfile = JSON.parse(text.replace(/,(\s*[}\]])/g, '$1'));
const quote = (value) => JSON.stringify(value);
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replace one `"key": "old"` line inside the workspace block for `dir`, and inside `field`
 * when given. Returns false when the line is not where the lockfile's layout puts it.
 */
function rewrite(dir, field, key, from, to) {
  const block = new RegExp(`\\n    ${escape(quote(dir))}: \\{\\n[\\s\\S]*?\\n    \\},?\\n`).exec(
    text
  );
  if (!block) return false;
  let scope = block[0];
  let offset = block.index;
  if (field) {
    const inner = new RegExp(
      `\\n      ${escape(quote(field))}: \\{\\n[\\s\\S]*?\\n      \\},?\\n`
    ).exec(scope);
    if (!inner) return false;
    offset += inner.index;
    scope = inner[0];
  }
  const indent = field ? '        ' : '      ';
  const line = new RegExp(`\\n${indent}${escape(quote(key))}: ${escape(quote(from))},?\\n`).exec(
    scope
  );
  if (!line) return false;
  const start = offset + line.index;
  const replaced = line[0].replace(`: ${quote(from)}`, `: ${quote(to)}`);
  text = text.slice(0, start) + replaced + text.slice(start + line[0].length);
  return true;
}
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
  if (
    dir !== '' &&
    (manifest.version ?? null) !== (entry.version ?? null) &&
    !(
      fix &&
      entry.version &&
      manifest.version &&
      rewrite(dir, null, 'version', entry.version, manifest.version)
    )
  )
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
      if (have[name] === range) continue;
      if (fix && name in have && rewrite(dir, field, name, have[name], range)) continue;
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
if (fix) writeFileSync(path.resolve(root, lockfilePath), text);
if (problems.length > 0) {
  console.error(
    `bun.lock is behind the workspace package.json files:\n  - ${problems.join('\n  - ')}\n\nFix: bun install --lockfile-only`
  );
  process.exit(1);
}
console.log(
  `✓ bun.lock workspace entries match ${Object.keys(workspaces).length} package.json files`
);
