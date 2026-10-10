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
  // Require impact decisions for implementation changes, not release metadata,
  // dependencies, documentation, tests, or build configuration.
  if (
    !/\.(?:[cm]?[jt]sx?|vue)$/.test(path) ||
    /(?:^|\/)(?:__tests__|tests?|__fixtures__|fixtures)\//.test(path) ||
    /\.(?:test|spec|config)\.[cm]?[jt]sx?$/.test(path) ||
    /\.d\.[cm]?ts$/.test(path)
  )
    return false;
  return (
    /^packages\/(core\/src\/(store|collaboration|binding|automation|editor)|pro\/src\/(collaboration|review|custom-nodes)|editor-api\/src)\//.test(
      path
    ) ||
    /^packages\/(react|vue|pro)\/src\/.*collaboration/.test(path) ||
    /^examples\/collaboration[^/]*\//.test(path)
  );
}
export function changedPaths(base) {
  // Disable rename detection so both the removed path and new path are checked.
  const changes = git('diff', '--name-only', '--no-renames', `${base}...HEAD`).split('\n');
  const working = git('diff', '--name-only', '--no-renames', 'HEAD').split('\n');
  const untracked = git('ls-files', '--others', '--exclude-standard').split('\n');
  return [...new Set([...changes, ...working, ...untracked])].filter(Boolean);
}
/** A repository test path a record may name: under scripts/, packages/, or e2e/. */
function testPath(path) {
  return typeof path === 'string' && /^(scripts|packages|e2e)\//.test(path) && !path.includes('..');
}

/** Why a test can go without a replacement, when `by` is absent. */
export const SUPERSEDE_CATEGORIES = ['duplicate', 'feature-removed', 'moved-to-unit'];

/**
 * Check the tests a record retires. Decision records are immutable once merged, so a test an
 * earlier record lists cannot be edited out of it. A new record declares the removal or the
 * rename instead: `supersedesTests: [{ path, by?, reasonCategory?, reason }]`. `path` is the
 * retired test, which must be gone. `by` is the test that replaces it, which must exist; without
 * one, `reasonCategory` says why no replacement is needed.
 */
export function validateSupersedes(record, file) {
  if (record.supersedesTests === undefined) return;
  assert.ok(
    Array.isArray(record.supersedesTests) && record.supersedesTests.length,
    `${file}: supersedesTests must be a non-empty array`
  );
  const seen = new Set();
  for (const entry of record.supersedesTests) {
    assert.ok(
      entry !== null && typeof entry === 'object' && !Array.isArray(entry),
      `${file}: each supersedesTests entry is an object`
    );
    const extra = Object.keys(entry).filter(
      (key) => !['path', 'by', 'reasonCategory', 'reason'].includes(key)
    );
    assert.equal(extra.length, 0, `${file}: unknown supersedesTests keys: ${extra.join(', ')}`);
    assert.ok(testPath(entry.path), `${file}: invalid superseded test path ${entry.path}`);
    assert.ok(!seen.has(entry.path), `${file}: ${entry.path} is superseded twice`);
    seen.add(entry.path);
    assert.ok(
      !existsSync(resolve(ROOT, entry.path)),
      `${file}: superseded test still exists: ${entry.path}`
    );
    assert.ok(
      !record.tests.includes(entry.path),
      `${file}: a record cannot list and supersede ${entry.path}`
    );
    if (entry.by !== undefined)
      assert.ok(
        testPath(entry.by) && existsSync(resolve(ROOT, entry.by)),
        `${file}: missing replacement test ${entry.by}`
      );
    if (entry.reasonCategory !== undefined)
      assert.ok(
        SUPERSEDE_CATEGORIES.includes(entry.reasonCategory),
        `${file}: reasonCategory must be one of ${SUPERSEDE_CATEGORIES.join(', ')}`
      );
    assert.ok(
      entry.by !== undefined || entry.reasonCategory !== undefined,
      `${file}: ${entry.path} needs a replacement test (by) or a reasonCategory ` +
        `(${SUPERSEDE_CATEGORIES.join(', ')})`
    );
    assert.ok(
      typeof entry.reason === 'string' && entry.reason.trim().length >= 12,
      `${file}: explain why ${entry.path} is superseded`
    );
  }
}

/** The fix for a missing test, for the error that reports it. */
export function missingTestMessage(file, test, merged) {
  if (!merged)
    return (
      `${file}: missing test ${test}. A record in this change must list tests that exist. ` +
      'Correct the path or remove it from the record.'
    );
  return (
    `${file}: missing test ${test}. This merged record cannot change. If you removed or ` +
    'renamed the test, supersede it from a new record:\n' +
    `  bun run collaboration:change --id <new-id> --impact no-impact --before "..." ` +
    `--after "..." --reason "..." --supersedes "${test}=><replacement test>" ` +
    '--supersedes-reason "..."\n' +
    `For a test with no replacement, use --supersedes "${test}" with --supersedes-category ` +
    `${SUPERSEDE_CATEGORIES.join('|')}.`
  );
}

/**
 * Validate a set of decision records, as `[{ file, record }]`.
 *
 * `merged` names the records that were already merged where this check starts: the PR base,
 * or the checked-out history in a release check. A missing test is accepted only when a merged
 * record lists it and a different record supersedes it, and a record supersedes only tests
 * that merged records list. A PR therefore cannot list a missing test and supersede it in the
 * same change. `checked` selects the records to validate; the rest only inform supersession.
 */
export function validateRecordSet(entries, merged, checked = entries.map((entry) => entry.file)) {
  const supersededBy = new Map();
  const mergedListers = new Map();
  for (const { file, record } of entries) {
    for (const entry of Array.isArray(record.supersedesTests) ? record.supersedesTests : [])
      supersededBy.set(entry?.path, [...(supersededBy.get(entry?.path) ?? []), file]);
    if (merged.has(file) && Array.isArray(record.tests))
      for (const test of record.tests)
        mergedListers.set(test, [...(mergedListers.get(test) ?? []), file]);
  }
  const wanted = new Set(checked);
  for (const { file, record } of entries) {
    if (!wanted.has(file)) continue;
    const isMerged = merged.has(file);
    validateRecord(record, file, {
      merged: isMerged,
      superseded: (test) =>
        isMerged && (supersededBy.get(test) ?? []).some((other) => other !== file),
    });
    for (const entry of record.supersedesTests ?? [])
      assert.ok(
        (mergedListers.get(entry.path) ?? []).some((other) => other !== file),
        `${file}: supersedesTests names ${entry.path}, which no merged record lists. ` +
          'Supersede only tests that merged records list.'
      );
  }
}

export function validateRecord(record, file, { superseded = () => false, merged = true } = {}) {
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
      testPath(test) && (existsSync(resolve(ROOT, test)) || superseded(test)),
      testPath(test) ? missingTestMessage(file, test, merged) : `${file}: invalid test path ${test}`
    );
  validateSupersedes(record, file);
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
  // Records already merged where this check starts. A PR check uses its base; a release check
  // runs on merged history, where every committed record has passed its own PR check.
  const merged = release
    ? new Set(
        git('ls-tree', '-r', '--name-only', 'HEAD', '.collaboration/changes')
          .split('\n')
          .filter(Boolean)
      )
    : oldFiles;
  const entries = recordFiles.map((file) => ({ file, record: json(file) }));
  const validate = (files) => {
    validateRecordSet(entries, merged, files);
    return files.map((file) => json(file));
  };
  const records = validate(recordFiles.filter((file) => !oldFiles.has(file)));
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
  // Released records are not checked again: their tests may since have been superseded.
  const releaseRecords = validate(recordFiles.filter((file) => !releasedFiles.has(file)));
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
