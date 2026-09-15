import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import {
  CATALOG,
  ROOT,
  PACKAGES,
  compareVersions,
  git,
  json,
  read,
  registry,
  run,
  sha,
  writeJSON,
  GUIDE,
  FIELDS,
  formatOf,
} from './common.mjs';
import { install } from './installation.mjs';
import { Peer } from './peer.mjs';

export function catalog() {
  return json(CATALOG);
}
export function verifyReleaseFiles(entry) {
  assert.equal(
    entry.directory,
    `.collaboration/releases/${entry.version}`,
    'Unexpected release artifact path'
  );
  assert.deepEqual(
    Object.keys(entry.hashes).sort(),
    ['fixture.json', 'package-lock.json', 'package.json'],
    'Missing fixture hashes'
  );
  for (const [file, hash] of Object.entries(entry.hashes))
    assert.equal(
      sha(read(`${entry.directory}/${file}`)),
      hash,
      `Changed historical file: ${entry.version}/${file}`
    );
}
export async function verifyCatalog({ allowCurrent = false } = {}) {
  const value = catalog();
  assert.equal(value.baseline, '2.18.0');
  assert.ok(value.releases.length, 'Capture published 2.18.0 before enabling this process');
  assert.equal(value.releases[0].version, '2.18.0');
  const published = await registry('@docx-editor.dev/pro');
  const current = json('packages/pro/package.json').version;
  const recorded = new Set(value.releases.map((entry) => entry.version));
  assert.equal(recorded.size, value.releases.length, 'Duplicate release catalog entry');
  const missing = Object.keys(published.versions).filter(
    (version) =>
      /^\d+\.\d+\.\d+$/.test(version) &&
      compareVersions(version, value.baseline) >= 0 &&
      !recorded.has(version) &&
      !(allowCurrent && version === current)
  );
  assert.deepEqual(
    missing,
    [],
    'Published releases missing from catalog. Run collaboration:catalog --capture <version>'
  );
  let previousVersion;
  for (const entry of value.releases) {
    if (previousVersion)
      assert.ok(compareVersions(entry.version, previousVersion) > 0, 'Catalog must be ordered');
    previousVersion = entry.version;
    verifyReleaseFiles(entry);
    assert.deepEqual(
      Object.keys(entry.versions).sort(),
      [...FIELDS].sort(),
      'Missing version fields'
    );
    assert.ok(
      FIELDS.every(
        (field) => Number.isSafeInteger(entry.versions[field]) && entry.versions[field] >= 0
      ),
      'Invalid format fields'
    );
    assert.deepEqual(
      Object.keys(entry.packages).sort(),
      PACKAGES.map((name) => '@docx-editor.dev/' + name).sort(),
      'Missing release packages'
    );
    assert.equal(
      entry.format,
      formatOf(entry.versions),
      'Catalog format differs from version fields'
    );
    assert.equal(
      published.versions[entry.version]?.gitHead,
      entry.commit,
      'Release source commit differs from npm provenance'
    );
    assert.ok(published.versions[entry.version], `Release is not published: ${entry.version}`);
    assert.equal(
      published.versions[entry.version].dist.integrity,
      entry.packages['@docx-editor.dev/pro'].integrity
    );
  }
  return value;
}
export function table(value = catalog()) {
  const rows = [
    ['Release', 'Collaboration format', 'Saved-room upgrade'],
    ...value.releases.map((entry, i) => [
      entry.version,
      `\`${entry.format}\``,
      i === 0 || entry.format !== value.releases[i - 1].format
        ? '[Export and reseed](#upgrade-saved-rooms)'
        : 'Same format; no room migration',
    ]),
  ];
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  const line = (row) => `| ${row.map((cell, i) => cell.padEnd(widths[i])).join(' | ')} |`;
  return [
    '<!-- collaboration-releases:start -->',
    '',
    line(rows[0]),
    line(widths.map((width) => '-'.repeat(width))),
    ...rows.slice(1).map(line),
    '',
    '<!-- collaboration-releases:end -->',
  ].join('\n');
}
export function updateTable() {
  const source = read(GUIDE);
  const pattern =
    /<!-- collaboration-releases:start -->[\s\S]*?<!-- collaboration-releases:end -->/;
  if (!pattern.test(source)) throw new Error('Missing release table markers');
  writeFileSync(resolve(ROOT, GUIDE), source.replace(pattern, table()));
}
export async function capture(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || compareVersions(version, '2.18.0') < 0)
    throw new Error('Capture a stable release from 2.18.0 onward');
  const value = existsSync(resolve(ROOT, CATALOG))
    ? catalog()
    : { baseline: '2.18.0', releases: [] };
  if (value.releases.some((entry) => entry.version === version))
    throw new Error(`Baseline ${version} already exists; never overwrite historical fixtures`);
  if (value.releases.length && compareVersions(version, value.releases.at(-1).version) <= 0)
    throw new Error('Capture releases in order');
  const directory = `.collaboration/releases/${version}`;
  if (existsSync(resolve(ROOT, directory))) throw new Error(`Refusing to overwrite ${directory}`);
  // Verify the source provenance against an actual release tag, not the current checkout.
  const commit = git('rev-parse', `v${version}^{commit}`);
  const temporary = mkdtempSync(join(tmpdir(), 'docx-collaboration-capture-'));
  let peer;
  try {
    const packages = {},
      dependencies = {};
    for (const short of PACKAGES) {
      const name = '@docx-editor.dev/' + short;
      const metadata = await registry(name, version, { waitForPublication: true });
      assert.equal(metadata.version, version);
      assert.equal(metadata.gitHead, commit, `npm source commit differs from v${version}`);
      packages[name] = { tarball: metadata.dist.tarball, integrity: metadata.dist.integrity };
      dependencies[name] = version;
    }
    const releaseLock = run('git', ['show', `v${version}:bun.lock`]);
    for (const name of ['yjs', 'y-protocols', 'fflate']) {
      const match = releaseLock.match(new RegExp(`"${name}": \\["${name}@([^"\\s]+)"`));
      if (!match) throw new Error(`Missing ${name} in release lock`);
      dependencies[name] = match[1];
    }
    writeJSON(join(temporary, 'package.json'), { private: true, type: 'module', dependencies });
    run(
      'npm',
      ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
      temporary
    );
    install(temporary);
    const lock = JSON.parse(readFileSync(join(temporary, 'package-lock.json'), 'utf8'));
    for (const [name, artifact] of Object.entries(packages))
      assert.equal(lock.packages['node_modules/' + name].integrity, artifact.integrity);
    peer = new Peer(temporary, `capture-${version}`);
    const info = await peer.request('info');
    const document = readFileSync(resolve(ROOT, '.collaboration/fixtures/content.docx')).toString(
      'base64'
    );
    const expected = await peer.request('open', {
      roomId: 'old-room',
      actor: 'fixture-author',
      document,
    });
    // A real old undo item makes the export/reseed reset check meaningful.
    await peer.request('edit', {
      operation: { op: 'insertText', offset: 0, text: 'fixture-history' },
    });
    await peer.request('edit', { operation: { op: 'deleteText', start: 0, end: 15 } });
    assert.deepEqual(await peer.request('snapshot'), expected);
    const fixture = { document, state: await peer.request('state'), expected };
    mkdirSync(resolve(ROOT, directory), { recursive: true });
    for (const file of ['package.json', 'package-lock.json'])
      cpSync(join(temporary, file), resolve(ROOT, directory, file));
    writeJSON(`${directory}/fixture.json`, fixture);
    const hashes = Object.fromEntries(
      ['package.json', 'package-lock.json', 'fixture.json'].map((file) => [
        file,
        sha(read(`${directory}/${file}`)),
      ])
    );
    value.releases.push({
      version,
      commit,
      sourceLockHash: sha(releaseLock),
      ...info,
      directory,
      packages,
      hashes,
    });
    writeJSON(CATALOG, value);
    updateTable();
    console.log(
      `Captured ${version}: ${info.format}. Review and commit the catalog, lock, fixture, and release table.`
    );
  } finally {
    await peer?.close();
    rmSync(temporary, { recursive: true, force: true });
  }
}
