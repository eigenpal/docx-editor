import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { ROOT, PACKAGES, json, read, sha, run, writeJSON, registry } from './common.mjs';

import { pendingVersions, stageTarball } from './staging.mjs';

export const CACHE = resolve(ROOT, '.cache/collaboration');
export function assertIsolated(directory) {
  const lock = JSON.parse(readFileSync(join(directory, 'package-lock.json'), 'utf8'));
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path) continue;
    if (entry.link) throw new Error(`Workspace link in isolated install: ${path}`);
    const full = join(directory, path);
    if (existsSync(full) && !realpathSync(full).startsWith(realpathSync(directory) + sep)) {
      throw new Error(`Dependency escapes isolated install: ${path}`);
    }
  }
  // There must be one core and one Yjs runtime within each peer process.
  for (const name of ['@docx-editor.dev/core', 'yjs']) {
    const matches = Object.keys(lock.packages).filter(
      (path) => path.endsWith('/node_modules/' + name) || path === 'node_modules/' + name
    );
    if (matches.length !== 1) throw new Error(`Expected one ${name}, found ${matches.length}`);
  }
}
export function install(directory) {
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], directory);
  assertIsolated(directory);
  cpSync(resolve(ROOT, 'scripts/collaboration/worker.mjs'), join(directory, 'worker.mjs'));
}
export function releaseInstallation(entry) {
  const dir = mkdtempSync(join(tmpdir(), 'docx-collaboration-release-'));
  try {
    for (const file of ['package.json', 'package-lock.json']) {
      const source = read(`${entry.directory}/${file}`);
      if (sha(source) !== entry.hashes[file])
        throw new Error(`Changed release fixture: ${entry.version}/${file}`);
      writeFileSync(join(dir, file), source);
    }
    const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
    for (const [name, artifact] of Object.entries(entry.packages)) {
      const dependency = lock.packages['node_modules/' + name];
      if (
        dependency?.version !== entry.version ||
        dependency.integrity !== artifact.integrity ||
        dependency.resolved !== artifact.tarball
      ) {
        throw new Error(`Release lock differs from registry artifact: ${name}@${entry.version}`);
      }
    }
    install(dir);
    return dir;
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}
export async function packCandidate(destination = resolve(CACHE, 'candidate')) {
  mkdirSync(destination, { recursive: true });
  const directory = mkdtempSync(join(destination, 'pack-'));
  const packages = {};
  const plannedVersions = await pendingVersions();
  const preview = Object.keys(plannedVersions).length > 0;
  // Pack every public package so the publication check covers the whole release.
  const group = json('.changeset/config.json').fixed.flat();
  for (const name of group) {
    const short = name.split('/')[1];
    const manifest = json(`packages/${short}/package.json`);
    if (manifest.private) continue;
    const [result] = JSON.parse(
      run(
        'npm',
        ['pack', '--json', '--ignore-scripts', '--pack-destination', directory],
        resolve(ROOT, 'packages', short)
      )
    );
    const packed = preview
      ? stageTarball(join(directory, result.filename), directory, plannedVersions)
      : result;
    if (packed.filename !== result.filename) rmSync(join(directory, result.filename));
    packages[name] = {
      filename: packed.filename,
      version: packed.version,
      integrity: packed.integrity,
      sourceIntegrity: result.integrity,
      hash: sha(readFileSync(join(directory, packed.filename))),
    };
  }
  const dependencies = Object.fromEntries(
    PACKAGES.map((name) => {
      const full = '@docx-editor.dev/' + name;
      return [full, 'file:./' + packages[full].filename];
    })
  );
  for (const name of ['yjs', 'y-protocols', 'fflate']) {
    const match = read('bun.lock').match(new RegExp(`"${name}": \\["${name}@([^"\\s]+)"`));
    if (!match) throw new Error(`Missing pinned ${name} dependency`);
    dependencies[name] = match[1];
  }
  writeJSON(join(directory, 'package.json'), { private: true, type: 'module', dependencies });
  run(
    'npm',
    ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
    directory
  );
  const manifest = {
    preview,
    packages,
    lockHash: sha(readFileSync(join(directory, 'package-lock.json'))),
  };
  writeJSON(join(directory, 'candidate.json'), manifest);
  install(directory);
  return directory;
}
export function verifyCandidate(directory, { publication = false } = {}) {
  const manifest = json(join(directory, 'candidate.json'));
  if (publication && manifest.preview)
    throw new Error(
      'This is a PR preview. Publish through the release workflow after Changesets applies versions.'
    );
  if (sha(readFileSync(join(directory, 'package-lock.json'))) !== manifest.lockHash)
    throw new Error('Candidate lock changed');
  for (const [name, expected] of Object.entries(manifest.packages)) {
    if (sha(readFileSync(join(directory, expected.filename))) !== expected.hash)
      throw new Error(`Candidate tarball changed: ${name}`);
    // npm pack is deterministic for identical publication payloads. Never rebuild here.
    const temporary = mkdtempSync(join(tmpdir(), 'docx-collaboration-pack-'));
    try {
      const [packed] = JSON.parse(
        run(
          'npm',
          ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary],
          resolve(ROOT, 'packages', name.split('/')[1])
        )
      );
      if (packed.integrity !== (expected.sourceIntegrity ?? expected.integrity))
        throw new Error(`Publication payload differs from tested candidate: ${name}`);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
}

export { verifyPublishedCandidate } from './publication.mjs';
