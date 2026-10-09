import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareVersions, formatOf, versions } from './common.mjs';
import {
  isSupersededTest,
  relevant,
  validateRecord,
  validateSupersedes,
  validateVersionChange,
} from './policy.mjs';
import { supersededEntries } from './change.mjs';
import { assertIsolated } from './installation.mjs';
import { shuffle } from './scenarios.mjs';

const base = {
  protocolVersion: 1,
  sharedSchemaVersion: 3,
  repairVersion: 1,
  canonicalModelVersion: 1,
};
const record = {
  impact: 'compatible',
  fields: [],
  before: 'Concurrent edits can lose shared text.',
  after: 'Concurrent edits retain all shared text.',
  reason: 'The shared interpretation stays consistent across clients.',
  tests: ['scripts/collaboration/policy.test.ts'],
  changeset: 'preserve-shared-text',
  migration: null,
};

describe('compatibility classification', () => {
  test.each([
    'packages/core/src/store/ops.ts',
    'packages/core/src/collaboration/replication.ts',
    'packages/core/src/binding/old-name.ts',
    'packages/core/src/automation/new-name.ts',
    'packages/core/src/editor/commands.ts',
    'packages/pro/src/review/model.ts',
    'packages/pro/src/collaboration/document/schema.ts',
    'packages/editor-api/src/range.ts',
    'packages/pro/src/react/use-document-collaboration.ts',
    'packages/vue/src/use-collaboration.ts',
    'examples/collaboration-hocuspocus/server.ts',
    'examples/collaboration/headless-agent.ts',
    'examples/collaboration-hocuspocus/shared/admission.ts',
  ])('protects %s', (path) => expect(relevant(path)).toBe(true));
  test.each([
    'docs/site/content/editor-api/guide.mdx',
    'README.md',
    'packages/react/src/toolbar.tsx',
    'packages/core/src/layout/paint.ts',
    'scripts/collaboration/policy.mjs',
    'scripts/collaboration/workflow.test.ts',
    '.changeset/config.json',
    'bun.lock',
    'package.json',
    'packages/core/package.json',
    'packages/pro/package.json',
    'packages/editor-api/package.json',
    'packages/core/tsup.config.ts',
    'examples/collaboration/package.json',
    'examples/collaboration/README.md',
    'examples/collaboration/tsconfig.json',
    'examples/collaboration-hocuspocus/vite.config.ts',
    'examples/collaboration-hocuspocus/server/stored-room.test.ts',
    'packages/core/src/store/__tests__/ops.test.ts',
    'packages/pro/src/collaboration/model.spec.ts',
    'packages/core/src/collaboration/tests/helpers.ts',
    'packages/pro/src/collaboration/__fixtures__/document.ts',
    'packages/core/src/collaboration/types.d.ts',
    '.collaboration/changes/example.json',
    '.collaboration/releases.json',
    '.github/workflows/release.yml',
    '.github/workflows/ci.yml',
    '.github/workflows/dependabot-lockfile.yml',
  ])('does not require unrelated %s', (path) => expect(relevant(path)).toBe(false));
  test('requires evidence for compatible changes', () => {
    expect(() => validateRecord(record, 'test')).not.toThrow();
    expect(() => validateRecord({ ...record, tests: [] }, 'test')).toThrow('evidence');
    expect(() => validateRecord({ ...record, tests: ['scripts/missing.test.ts'] }, 'test')).toThrow(
      'missing test'
    );
  });
  test('no-impact needs reasoning, but no regression test', () => {
    expect(() =>
      validateRecord({ ...record, impact: 'no-impact', tests: [], changeset: null }, 'test')
    ).not.toThrow();
    expect(() => validateRecord({ ...record, reason: '' }, 'test')).toThrow('reason');
  });
  test('migration needs valid fields, notes, and a Changeset', () => {
    const migration = {
      ...record,
      impact: 'migration-required',
      fields: ['sharedSchemaVersion'],
      migration: 'upgrade-saved-rooms',
    };
    expect(() => validateRecord(migration, 'test')).not.toThrow();
    expect(() => validateRecord({ ...migration, fields: ['unknown'] }, 'test')).toThrow(
      'invalid version fields'
    );
    expect(() => validateRecord({ ...migration, migration: 'missing-section' }, 'test')).toThrow(
      'missing migration heading'
    );
    expect(() => validateRecord({ ...migration, changeset: null }, 'test')).toThrow('Changeset');
  });
});

describe('superseded tests', () => {
  const retired = 'e2e/retired.smoke.spec.ts';
  const retirement = {
    ...record,
    supersedesTests: [
      {
        path: retired,
        by: 'scripts/collaboration/policy.test.ts',
        reason: 'The unit suite covers the same behavior.',
      },
    ],
  };

  test('a later record may retire a missing test that an earlier record lists', () => {
    const lister = { file: 'old.json', order: 1 };
    const supersessions = [{ path: retired, file: 'new.json', order: 2 }];
    expect(isSupersededTest(retired, lister, supersessions)).toBe(true);
    const listed = { ...record, tests: [...record.tests, retired] };
    expect(() =>
      validateRecord(listed, 'old.json', (test) => isSupersededTest(test, lister, supersessions))
    ).not.toThrow();
    // Without a supersession the missing test still fails the record.
    expect(() => validateRecord(listed, 'old.json')).toThrow('missing test');
  });

  test('an older record, or the listing record itself, cannot retire a test', () => {
    const lister = { file: 'new.json', order: 2 };
    expect(isSupersededTest(retired, lister, [{ path: retired, file: 'old.json', order: 1 }])).toBe(
      false
    );
    expect(isSupersededTest(retired, lister, [{ path: retired, file: 'new.json', order: 2 }])).toBe(
      false
    );
  });

  test('a retirement names a removed test, an existing replacement, and a reason', () => {
    expect(() => validateSupersedes(retirement, 'test')).not.toThrow();
    expect(() => validateRecord(retirement, 'test')).not.toThrow();
    const entry = retirement.supersedesTests[0]!;
    const withEntry = (change: Record<string, unknown>) => ({
      ...record,
      supersedesTests: [{ ...entry, ...change }],
    });
    expect(() =>
      validateSupersedes(withEntry({ path: 'scripts/collaboration/policy.test.ts' }), 'test')
    ).toThrow('still exists');
    expect(() => validateSupersedes(withEntry({ by: 'scripts/missing.test.ts' }), 'test')).toThrow(
      'missing replacement test'
    );
    expect(() => validateSupersedes(withEntry({ reason: 'gone' }), 'test')).toThrow('explain why');
    expect(() => validateSupersedes(withEntry({ path: '../outside.ts' }), 'test')).toThrow(
      'invalid superseded test path'
    );
    expect(() => validateSupersedes(withEntry({ note: 'extra' }), 'test')).toThrow('unknown');
    expect(() =>
      validateSupersedes({ ...record, supersedesTests: [entry, entry] }, 'test')
    ).toThrow('twice');
    expect(() => validateSupersedes({ ...record, supersedesTests: [] }, 'test')).toThrow(
      'non-empty'
    );
    expect(() =>
      validateSupersedes({ ...retirement, tests: [...record.tests, retired] }, 'test')
    ).toThrow('cannot list and supersede');
  });

  test('the change helper reads OLD[=>NEW] entries with one reason', () => {
    expect(
      supersededEntries('e2e/a.spec.ts, e2e/b.spec.ts=>packages/b.test.ts', 'Covered elsewhere.')
    ).toEqual([
      { path: 'e2e/a.spec.ts', reason: 'Covered elsewhere.' },
      { path: 'e2e/b.spec.ts', by: 'packages/b.test.ts', reason: 'Covered elsewhere.' },
    ]);
    expect(supersededEntries('', undefined)).toEqual([]);
    expect(() => supersededEntries('e2e/a.spec.ts', undefined)).toThrow('--supersedes-reason');
  });
});

describe('format version policy', () => {
  test('reads the existing version contract', () =>
    expect(formatOf(versions())).toMatch(/^docx-collaboration:\d+\.\d+\.\d+\.\d+$/));
  test('same format stays compatible', () =>
    expect(validateVersionChange(base, base, [record])).toEqual([]));
  test('a bump without migration evidence fails', () => {
    expect(() => validateVersionChange(base, { ...base, repairVersion: 2 }, [record])).toThrow(
      'without a migration'
    );
  });
  test('migration without a bump fails', () => {
    expect(() =>
      validateVersionChange(base, base, [
        { impact: 'migration-required', fields: ['sharedSchemaVersion'] },
      ])
    ).toThrow('requires a bump');
  });
  test('multiple changes can share one unreleased bump', () => {
    const changes = Array.from({ length: 2 }, () => ({
      impact: 'migration-required',
      fields: ['sharedSchemaVersion'],
    }));
    expect(validateVersionChange(base, { ...base, sharedSchemaVersion: 4 }, changes)).toEqual([
      'sharedSchemaVersion',
    ]);
  });
  test('published formats and decreased fields cannot be reused', () => {
    const changes = [{ impact: 'migration-required', fields: ['sharedSchemaVersion'] }];
    expect(() => validateVersionChange(base, { ...base, sharedSchemaVersion: 2 }, changes)).toThrow(
      'decrease'
    );
    expect(() =>
      validateVersionChange(base, { ...base, sharedSchemaVersion: 4 }, changes, [
        { format: 'docx-collaboration:1.4.1.1' },
      ])
    ).toThrow('reused');
  });
  test('stable version sorting is numeric', () => {
    expect(compareVersions('2.18.10', '2.18.9')).toBeGreaterThan(0);
    expect(compareVersions('2.19.0', '2.18.99')).toBeGreaterThan(0);
    expect(() => compareVersions('2.19.0-beta.1', '2.18.0')).toThrow('stable');
  });
});

describe('isolation and deterministic reproduction', () => {
  test('an isolated lock rejects workspace links and duplicate core copies', () => {
    const directory = mkdtempSync(join(tmpdir(), 'collaboration-isolation-test-'));
    const packages = { 'node_modules/@docx-editor.dev/core': {}, 'node_modules/yjs': {} };
    const write = (entries: Record<string, unknown>) =>
      writeFileSync(join(directory, 'package-lock.json'), JSON.stringify({ packages: entries }));
    try {
      write(packages);
      expect(() => assertIsolated(directory)).not.toThrow();
      write({ ...packages, 'node_modules/shared': { link: true } });
      expect(() => assertIsolated(directory)).toThrow('Workspace link');
      write({ ...packages, 'node_modules/pro/node_modules/@docx-editor.dev/core': {} });
      expect(() => assertIsolated(directory)).toThrow('Expected one');
      write(packages);
      mkdirSync(join(directory, 'node_modules'), { recursive: true });
      symlinkSync(tmpdir(), join(directory, 'node_modules/yjs'));
      expect(() => assertIsolated(directory)).toThrow('escapes');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  test('delivery order is reproducible and retains every update', () => {
    const values = Array.from({ length: 30 }, (_, i) => i);
    expect(shuffle(values, 592)).toEqual(shuffle(values, 592));
    expect(shuffle(values, 2180)).not.toEqual(shuffle(values, 592));
    expect(shuffle(values, 592).sort((a, b) => a - b)).toEqual(values);
  });
});

describe('release preview staging', () => {
  test('stages the fixed package cohort without changing the source manifest', async () => {
    const { stageManifest } = await import('./staging.mjs');
    const manifest = {
      name: '@docx-editor.dev/pro',
      version: '2.18.0',
      peerDependencies: { '@docx-editor.dev/core': '~2.19.0', yjs: '^13.6.32' },
    };
    const staged = stageManifest(manifest, {
      '@docx-editor.dev/pro': '2.19.0',
      '@docx-editor.dev/core': '2.19.0',
    });
    expect(staged.version).toBe('2.19.0');
    expect(staged.peerDependencies['@docx-editor.dev/core']).toBe('~2.19.0');
    expect(staged.peerDependencies.yjs).toBe('^13.6.32');
    expect(manifest.version).toBe('2.18.0');
  });
});
