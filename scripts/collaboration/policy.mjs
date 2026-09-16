import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ROOT,
  FIELDS,
  CATALOG,
  GUIDE,
  VERSION_SOURCE,
  compareVersions,
  formatOf,
  git,
  json,
  read,
  versions,
} from './common.mjs';
import { catalog, table } from './catalog.mjs';

export function relevant(path) {
  return (
    /^packages\/(core\/src\/(store|collaboration|binding|automation|editor)|pro\/src\/(collaboration|review|custom-nodes)|editor-api\/src)\//.test(
      path
    ) ||
    /^packages\/(react|vue|pro)\/src\/.*collaboration/.test(path) ||
    /^examples\/collaboration[^/]*\//.test(path) ||
    /^packages\/(core|pro|editor-api|react|vue|i18n)\/(package\.json|tsup\.config\.[cm]?ts)$/.test(
      path
    ) ||
    ['bun.lock', 'package.json', '.changeset/config.json'].includes(path) ||
    /^(scripts\/collaboration\/|\.collaboration\/)/.test(path) ||
    /^\.github\/workflows\/(ci|release|recover-release|post-release|dependabot-lockfile|collaboration-catalog)\.yml$/.test(
      path
    )
  );
}
export function changedPaths(base) {
  // Disable rename detection so both the removed path and new path are checked.
  const changes = git('diff', '--name-only', '--no-renames', `${base}...HEAD`).split('\n');
  const working = git('diff', '--name-only', '--no-renames', 'HEAD').split('\n');
  const untracked = git('ls-files', '--others', '--exclude-standard').split('\n');
  return [...new Set([...changes, ...working, ...untracked])].filter(Boolean);
}
export function validateRecord(record, file) {
  assert.ok(
    ['no-impact', 'compatible', 'migration-required'].includes(record.impact),
    `${file}: invalid impact`
  );
  for (const field of ['before', 'after', 'reason'])
    assert.ok(
      typeof record[field] === 'string' && record[field].trim().length >= 12,
      `${file}: explain ${field}`
    );
  assert.ok(
    Array.isArray(record.fields) && record.fields.every((field) => FIELDS.includes(field)),
    `${file}: invalid version fields`
  );
  assert.equal(
    new Set(record.fields).size,
    record.fields.length,
    `${file}: duplicate version fields`
  );
  assert.ok(Array.isArray(record.tests), `${file}: tests must be an array`);
  if (record.impact !== 'no-impact')
    assert.ok(record.tests.length, `${file}: regression test evidence required`);
  for (const test of record.tests)
    assert.ok(
      typeof test === 'string' &&
        /^(scripts|packages|e2e)\//.test(test) &&
        !test.includes('..') &&
        existsSync(resolve(ROOT, test)),
      `${file}: missing test ${test}`
    );
  if (record.impact === 'migration-required') {
    assert.ok(record.fields.length, `${file}: identify affected version fields`);
    assert.ok(
      typeof record.migration === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.migration),
      `${file}: migration guide anchor required`
    );
    const headings = [...read(GUIDE).matchAll(/^#{2,6} (.+)$/gm)].map((match) =>
      match[1]
        .toLowerCase()
        .replace(/[^a-z0-9 -]/g, '')
        .replace(/ +/g, '-')
    );
    assert.ok(headings.includes(record.migration), `${file}: missing migration heading`);
    assert.ok(record.changeset, `${file}: migration Changeset required`);
  } else
    assert.equal(record.fields.length, 0, `${file}: compatible changes do not bump format fields`);
  if (record.changeset !== null)
    assert.ok(
      typeof record.changeset === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.changeset),
      `${file}: invalid Changeset identifier`
    );
}
export function validateVersionChange(previous, current, records, released = []) {
  const changed = FIELDS.filter((field) => current[field] !== previous[field]);
  for (const field of FIELDS)
    assert.ok(
      Number.isSafeInteger(current[field]) && current[field] >= previous[field],
      `${field} must not decrease`
    );
  const migrations = records.filter((record) => record.impact === 'migration-required');
  for (const field of changed)
    assert.ok(
      migrations.some((record) => record.fields.includes(field)),
      `${field} changed without a migration decision`
    );
  for (const record of migrations)
    for (const field of record.fields)
      assert.ok(changed.includes(field), `Migration decision requires a bump to ${field}`);
  if (changed.length)
    assert.ok(
      !released.some((entry) => entry.format === formatOf(current)),
      'A published format cannot be reused'
    );
  return changed;
}
export function check(base, release = false) {
  const value = catalog();
  assert.ok(value.releases.length, 'The published 2.18 baseline must be captured first');
  const latest = value.releases.at(-1);
  // A release run evaluates the complete candidate since the last published version.
  // When rerunning an already-published version, keep evaluating its original change range.
  const currentPackage = json('packages/pro/package.json').version;
  const comparison =
    release && latest.version === currentPackage ? (value.releases.at(-2) ?? latest) : latest;
  base = release ? comparison.commit : base;
  const paths = changedPaths(base);
  const oldFiles = new Set(
    git('ls-tree', '-r', '--name-only', base, '.collaboration/changes').split('\n').filter(Boolean)
  );
  for (const file of oldFiles) {
    assert.ok(existsSync(resolve(ROOT, file)), `Historical decision deleted: ${file}`);
    assert.equal(
      read(file).trim(),
      git('show', `${base}:${file}`),
      `Historical decision changed: ${file}`
    );
  }
  // Protect the catalog and fixture history against silent golden updates.
  const oldCatalogText = git('ls-tree', '--name-only', base, CATALOG);
  if (oldCatalogText) {
    const previous = JSON.parse(git('show', `${base}:${CATALOG}`));
    assert.deepEqual(
      value.releases.slice(0, previous.releases.length),
      previous.releases,
      'Historical catalog entries are immutable'
    );
    for (const entry of previous.releases)
      for (const file of Object.keys(entry.hashes))
        assert.equal(
          read(`${entry.directory}/${file}`).trim(),
          git('show', `${base}:${entry.directory}/${file}`),
          'Historical release artifacts are immutable'
        );
  }
  const recordFiles = readdirSync(resolve(ROOT, '.collaboration/changes'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => `.collaboration/changes/${name}`);
  const records = recordFiles
    .filter((file) => !oldFiles.has(file))
    .map((file) => {
      const record = json(file);
      validateRecord(record, file);
      return record;
    });
  const affected = paths
    .filter(relevant)
    .filter(
      (path) =>
        !path.startsWith('.collaboration/releases') && !path.startsWith('.collaboration/fixtures/')
    );
  // Catalog-only maintenance has no product behavior to classify.
  if (affected.length)
    assert.ok(
      records.length,
      `Compatibility decision missing for:\n${affected.join('\n')}\nRun bun run collaboration:change`
    );
  const publishedBase = release ? comparison : latest;
  const releasedFiles = new Set(
    git('ls-tree', '-r', '--name-only', publishedBase.commit, '.collaboration/changes').split('\n')
  );
  const releaseRecords = recordFiles
    .filter((file) => !releasedFiles.has(file))
    .map((file) => {
      const record = json(file);
      validateRecord(record, file);
      return record;
    });
  const baseVersions = versions(git('show', `${base}:${VERSION_SOURCE}`));
  for (const field of FIELDS)
    assert.ok(
      versions()[field] >= baseVersions[field],
      `${field} decreased relative to the PR base`
    );
  const changed = validateVersionChange(
    publishedBase.versions,
    versions(),
    releaseRecords,
    value.releases.filter((entry) => entry.version !== currentPackage)
  );
  const productionChanged = affected.some(
    (path) =>
      /^packages\/.*\/src\//.test(path) &&
      !path.includes('/__tests__/') &&
      !/\.(test|spec)\./.test(path)
  );
  if (productionChanged)
    assert.ok(
      records.some((record) => record.changeset),
      'Production changes need a Changeset'
    );
  for (const record of records) {
    if (!record.changeset) continue;
    const path = `.changeset/${record.changeset}.md`;
    if (existsSync(resolve(ROOT, path))) {
      const contents = read(path);
      const group = json('.changeset/config.json').fixed.find((names) =>
        names.includes('@docx-editor.dev/pro')
      ) ?? ['@docx-editor.dev/pro'];
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(contents)?.[1] ?? '';
      const bumps = [
        ...frontmatter.matchAll(/^['"]?(@docx-editor\.dev\/[^'":]+)['"]?: (patch|minor|major)$/gm),
      ]
        .filter((match) => group.includes(match[1]))
        .map((match) => match[2]);
      assert.ok(bumps.length, `${path}: require a Changeset for Pro or its fixed release group`);
      if (record.impact === 'migration-required') {
        assert.ok(
          bumps.some((bump) => bump === 'minor' || bump === 'major'),
          'Format changes require at least a minor release'
        );
        assert.ok(
          contents.includes('Breaking collaboration upgrade') &&
            contents.includes('#' + record.migration),
          'Changeset needs the migration warning and guide link'
        );
      }
    } else {
      assert.ok(release, `Missing Changeset ${path}`);
      if (record.impact === 'migration-required') {
        const section =
          read('packages/pro/CHANGELOG.md')
            .split(/^## /m)
            .find((part) => part.startsWith(currentPackage + '\n')) ?? '';
        assert.ok(
          section.includes('Breaking collaboration upgrade') &&
            section.includes('#' + record.migration),
          'Release changelog lost migration instructions'
        );
      }
    }
  }
  if (changed.length && release) {
    assert.ok(
      compareVersions(currentPackage, comparison.version) > 0,
      'Format changed without a new package release'
    );
    assert.notEqual(
      currentPackage.split('.').slice(0, 2).join('.'),
      comparison.version.split('.').slice(0, 2).join('.'),
      'Format changes cannot ship in a patch'
    );
  }
  const generated = read(GUIDE).match(
    /\{\/\* collaboration-releases:start \*\/\}[\s\S]*?\{\/\* collaboration-releases:end \*\/\}/
  )?.[0];
  assert.equal(generated, table(), 'Release table is stale: run collaboration:catalog --table');
  console.log(
    `Compatibility policy passed: ${records.length} decisions, ${changed.length} format fields changed.`
  );
}
