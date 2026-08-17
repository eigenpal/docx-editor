// Advisory gate for the dependency closure we actually ship.
//
// `bun audit` reads the whole workspace lock: ~2485 packages, most of them build
// tooling and demo apps. When this landed it reported 96 advisories, and every
// one traced to a devDependency or to examples/. Gating on that number fails the
// build on day one for CVEs no consumer can reach. A gate that is red on day one
// gets ignored, and then deleted.
//
// A consumer installs a published package and gets its `dependencies`,
// transitively. That closure is what this script resolves and checks, at the
// versions pinned in bun.lock.
//
// Deliberately out of scope:
//   - devDependencies. They never leave CI.
//   - examples/*. Demos, never published.
//   - private packages (vue, nuxt today). Not published, so not shipped.
//   - peerDependencies (react, react-dom, vue, pdf-lib, yjs). The consumer
//     installs and upgrades those; we only declare a range. Listed, never gated.
//
// GitHub's own Dependabot alerts do NOT cover this closure. GitHub cannot parse
// bun.lock, so the dependency graph sees direct manifest entries only (185 of
// 2485). Transitive CVEs raise no alert. That gap is why this script exists.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IGNORE_FILE = join(ROOT, 'scripts', 'shipped-advisories-ignore.json');
const BULK_ENDPOINT = 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk';

/** Lowest severity that fails the run. Everything found is printed regardless. */
const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'critical'];
const DEFAULT_AUDIT_LEVEL = 'moderate';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const levelArg = args.find((a) => a.startsWith('--audit-level='))?.split('=')[1];
const auditLevel = levelArg ?? DEFAULT_AUDIT_LEVEL;
if (!SEVERITY_ORDER.includes(auditLevel)) {
  console.error(`Unknown --audit-level=${auditLevel}. Use one of: ${SEVERITY_ORDER.join(', ')}`);
  process.exit(2);
}

/**
 * bun.lock is JSONC: it carries trailing commas. It has no comments, and every
 * string value is a package name, a version, or a base64 hash, so no string can
 * contain the `,}` / `,]` pair this strips.
 */
function parseBunLock(text) {
  return JSON.parse(text.replace(/,(\s*[}\]])/g, '$1'));
}

/** Split a lock key into node_modules segments, keeping `@scope/name` whole. */
function splitKey(key) {
  const parts = key.split('/');
  const segments = [];
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i].startsWith('@') && i + 1 < parts.length) {
      segments.push(`${parts[i]}/${parts[i + 1]}`);
      i += 1;
    } else {
      segments.push(parts[i]);
    }
  }
  return segments;
}

/**
 * Node resolution over the hoisted lock: try the nested copy first, then walk up
 * one directory at a time, then the hoisted root.
 */
function resolveDependency(packages, fromKey, name) {
  const segments = fromKey ? splitKey(fromKey) : [];
  for (let depth = segments.length; depth >= 0; depth -= 1) {
    const candidate = [...segments.slice(0, depth), name].join('/');
    if (packages[candidate]) return candidate;
  }
  return null;
}

/** `@scope/name@1.2.3` -> `1.2.3`; workspace entries have no resolvable version. */
function versionOf(descriptor) {
  const at = descriptor.lastIndexOf('@');
  if (at <= 0) return null;
  const version = descriptor.slice(at + 1);
  return version.startsWith('workspace:') ? null : version;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// --- The published surface -------------------------------------------------

const packagesDir = join(ROOT, 'packages');
const manifests = readdirSync(packagesDir)
  .map((dir) => join(packagesDir, dir, 'package.json'))
  .filter((path) => existsSync(path))
  .map((path) => readJson(path));

const published = manifests.filter((m) => m.private !== true);
const publishedNames = new Set(published.map((m) => m.name));
const byName = new Map(manifests.map((m) => [m.name, m]));

const lock = parseBunLock(readFileSync(join(ROOT, 'bun.lock'), 'utf8'));
const packages = lock.packages ?? {};

// --- Resolve the shipped closure -------------------------------------------

/** name@version -> Set of human-readable paths that reach it. */
const shipped = new Map();
const declaredPeers = new Map();
const unresolved = [];

/** Walk `dependencies` only. Peers are the consumer's; dev never ships. */
function walk(lockKey, trail) {
  const entry = packages[lockKey];
  if (!entry) return;
  const descriptor = entry[0];
  const version = versionOf(descriptor);
  if (!version) return;
  const meta = entry[2] ?? {};
  // The descriptor is the authority on the name; the lock key is a hoist path.
  const marker = `${descriptor.slice(0, descriptor.lastIndexOf('@'))}@${version}`;
  const seen = shipped.get(marker);
  if (seen) {
    seen.add(trail);
    return;
  }
  shipped.set(marker, new Set([trail]));
  for (const dep of Object.keys({ ...meta.dependencies, ...meta.optionalDependencies })) {
    const next = resolveDependency(packages, lockKey, dep);
    if (!next) {
      unresolved.push(`${trail} > ${dep}`);
      continue;
    }
    walk(next, `${trail} > ${dep}`);
  }
}

for (const manifest of published) {
  for (const [dep] of Object.entries(manifest.peerDependencies ?? {})) {
    if (publishedNames.has(dep)) continue;
    if (!declaredPeers.has(dep)) declaredPeers.set(dep, new Set());
    declaredPeers.get(dep).add(manifest.name);
  }
}

/** Internal packages are seeded from their own manifest, never from the lock. */
const seededWorkspaces = new Set();
function seedWorkspace(manifest, trail) {
  if (seededWorkspaces.has(manifest.name)) return;
  seededWorkspaces.add(manifest.name);
  for (const dep of Object.keys(manifest.dependencies ?? {})) {
    const internal = byName.get(dep);
    if (internal) {
      seedWorkspace(internal, `${trail} > ${dep}`);
      continue;
    }
    const key = resolveDependency(packages, manifest.name, dep);
    if (!key) {
      unresolved.push(`${trail} > ${dep}`);
      continue;
    }
    walk(key, `${trail} > ${dep}`);
  }
}

for (const manifest of published) seedWorkspace(manifest, manifest.name);

if (unresolved.length > 0) {
  console.error('Could not resolve these shipped dependencies against bun.lock:');
  for (const path of unresolved) console.error(`  ${path}`);
  console.error('\nRun `bun install` to refresh the lockfile, then retry.');
  process.exit(2);
}

// --- Query the advisory database -------------------------------------------

const query = {};
for (const marker of shipped.keys()) {
  const at = marker.lastIndexOf('@');
  const name = marker.slice(0, at);
  (query[name] ??= []).push(marker.slice(at + 1));
}

let advisories;
try {
  const response = await fetch(BULK_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(query),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  advisories = await response.json();
} catch (error) {
  // A security gate that passes when it cannot reach the database is worthless.
  console.error(`Could not reach the npm advisory database: ${error.message}`);
  process.exit(2);
}

// --- Apply the ignore list --------------------------------------------------

const ignoreFile = existsSync(IGNORE_FILE) ? readJson(IGNORE_FILE) : { ignore: [] };
const today = new Date().toISOString().slice(0, 10);
const ignoreById = new Map();
const expired = [];
for (const rule of ignoreFile.ignore ?? []) {
  if (rule.expires && rule.expires < today) {
    expired.push(rule);
    continue;
  }
  ignoreById.set(rule.id, rule);
}

/** All trails that reach any version of a package, for the "via" lines. */
const trailsByName = new Map();
for (const [marker, trails] of shipped) {
  const name = marker.slice(0, marker.lastIndexOf('@'));
  const merged = trailsByName.get(name) ?? new Set();
  for (const trail of trails) merged.add(trail);
  trailsByName.set(name, merged);
}

const findings = [];
for (const [name, list] of Object.entries(advisories)) {
  for (const advisory of list) {
    const id = advisory.github_advisory_id ?? advisory.url?.split('/').pop() ?? String(advisory.id);
    findings.push({
      name,
      id,
      severity: advisory.severity ?? 'info',
      title: advisory.title,
      url: advisory.url,
      vulnerableVersions: advisory.vulnerable_versions,
      ignored: ignoreById.has(id),
      paths: [...(trailsByName.get(name) ?? [])].slice(0, 3),
    });
  }
}
findings.sort((a, b) => SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity));

const threshold = SEVERITY_ORDER.indexOf(auditLevel);
const blocking = findings.filter(
  (f) => !f.ignored && SEVERITY_ORDER.indexOf(f.severity) >= threshold,
);

if (asJson) {
  console.log(JSON.stringify({ auditLevel, packages: shipped.size, findings, expired }, null, 2));
} else {
  console.log(`Shipped closure: ${shipped.size} packages from ${published.length} published packages.`);
  console.log(`Peers left to the consumer: ${[...declaredPeers.keys()].join(', ') || 'none'}`);
  console.log(`Audit level: ${auditLevel} and above fails.\n`);

  for (const finding of findings) {
    const tag = finding.ignored ? 'IGNORED' : SEVERITY_ORDER.indexOf(finding.severity) >= threshold ? 'FAIL' : 'below';
    console.log(`${tag.padEnd(8)} ${finding.severity.padEnd(9)} ${finding.name}  ${finding.id}`);
    console.log(`         ${finding.title}`);
    console.log(`         affects ${finding.vulnerableVersions} — ${finding.url}`);
    for (const path of finding.paths) console.log(`         via ${path}`);
  }

  if (findings.length === 0) console.log('No advisories against any shipped dependency.');

  for (const rule of expired) {
    console.error(`\nExpired ignore for ${rule.id} (expired ${rule.expires}). Re-review it or extend the date.`);
  }
}

if (expired.length > 0) process.exit(1);
if (blocking.length > 0) {
  console.error(`\n${blocking.length} advisory/advisories at or above ${auditLevel} in shipped dependencies.`);
  process.exit(1);
}
