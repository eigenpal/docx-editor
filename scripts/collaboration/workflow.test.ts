import { afterEach, expect, test } from 'bun:test';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { ROOT, run, sha } from './common.mjs';
import { verifyCandidate } from './installation.mjs';

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function repository() {
  const dir = mkdtempSync(join(tmpdir(), 'collaboration-policy-history-'));
  directories.push(dir);
  const write = (file: string, text: string) => {
    const full = join(dir, file);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  };
  const data = (file: string, value: unknown) => write(file, JSON.stringify(value, null, 2) + '\n');
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  const commit = () => {
    git('add', '.');
    git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  const check = (...args: string[]) =>
    spawnSync(process.execPath, [join(dir, 'scripts/collaboration/cli.mjs'), 'check', ...args], {
      cwd: dir,
      encoding: 'utf8',
    });
  cpSync(import.meta.dirname, join(dir, 'scripts/collaboration'), { recursive: true });
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Compatibility test');
  write(
    'packages/pro/src/collaboration/document-compatibility.ts',
    'const versions = {protocolVersion: 1, sharedSchemaVersion: 3, repairVersion: 1, canonicalModelVersion: 1,};\n'
  );
  write('packages/core/src/store/example.ts', 'export const value = 1;\n');
  data('packages/pro/package.json', { version: '2.18.0' });
  data('.changeset/config.json', { fixed: [['@docx-editor.dev/core', '@docx-editor.dev/pro']] });
  const published = commit();
  data('.collaboration/releases.json', {
    baseline: '2.18.0',
    releases: [
      {
        version: '2.18.0',
        commit: published,
        directory: '.collaboration/releases/2.18.0',
        hashes: {},
        format: 'docx-collaboration:1.3.1.1',
        versions: {
          protocolVersion: 1,
          sharedSchemaVersion: 3,
          repairVersion: 1,
          canonicalModelVersion: 1,
        },
      },
    ],
  });
  mkdirSync(join(dir, '.collaboration/changes'), { recursive: true });
  write(
    'docs/site/content/pro/collaboration-versions.mdx',
    '## Upgrade saved rooms\n\n<!-- collaboration-releases:start -->\n<!-- collaboration-releases:end -->\n'
  );
  execFileSync(
    process.execPath,
    [join(dir, 'scripts/collaboration/cli.mjs'), 'catalog', '--table'],
    { cwd: dir }
  );
  const base = commit();
  const addDecision = (impact = 'compatible') => {
    data('.collaboration/changes/test-change.json', {
      impact,
      fields: [],
      before: 'Old shared editing behavior.',
      after: 'New shared editing behavior.',
      reason: 'The shared format interpretation stays unchanged.',
      tests: ['scripts/collaboration/policy.test.ts'],
      changeset: 'test-change',
      migration: null,
    });
    write(
      '.changeset/test-change.md',
      "---\n'@docx-editor.dev/pro': patch\n---\n\nPreserve shared text.\n"
    );
  };
  return { dir, write, data, git, commit, check, base, addDecision };
}

test('a relevant change cannot borrow a decision from a previous PR', () => {
  const repo = repository();
  repo.addDecision();
  const previous = repo.commit();
  repo.write('packages/core/src/store/example.ts', 'export const value = 2;\n');
  const result = repo.check('--base', previous);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('decision missing');
});

test('renaming protected code outside the protected path still requires a decision', () => {
  const repo = repository();
  repo.git('mv', 'packages/core/src/store/example.ts', 'packages/core/example.ts');
  const result = repo.check('--base', repo.base);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('decision missing');
});

test('consumed Changesets are validated from the complete release range', () => {
  const repo = repository();
  repo.addDecision();
  repo.write('packages/core/src/store/example.ts', 'export const value = 2;\n');
  expect(repo.check('--base', repo.base).status).toBe(0);
  repo.commit();
  rmSync(join(repo.dir, '.changeset/test-change.md'));
  repo.data('packages/pro/package.json', { version: '2.18.1' });
  repo.write('packages/pro/CHANGELOG.md', '# Changelog\n\n## 2.18.1\n\nPreserve shared text.\n');
  repo.commit();
  const result = repo.check('--release');
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});

test('historical decisions cannot be removed or rewritten', () => {
  const repo = repository();
  repo.addDecision();
  const base = repo.commit();
  repo.write('.collaboration/changes/test-change.json', '{}\n');
  expect(repo.check('--base', base).stderr).toContain('Historical decision changed');
  rmSync(join(repo.dir, '.collaboration/changes/test-change.json'));
  expect(repo.check('--base', base).stderr).toContain('Historical decision deleted');
});

test('a consumed migration Changeset must retain its warning in this release', () => {
  const repo = repository();
  repo.addDecision('migration-required');
  const decision = JSON.parse(
    readFileSync(join(repo.dir, '.collaboration/changes/test-change.json'), 'utf8')
  );
  repo.data('.collaboration/changes/test-change.json', {
    ...decision,
    fields: ['repairVersion'],
    migration: 'upgrade-saved-rooms',
  });
  repo.write(
    'packages/pro/src/collaboration/document-compatibility.ts',
    'const versions = {protocolVersion: 1, sharedSchemaVersion: 3, repairVersion: 2, canonicalModelVersion: 1,};\n'
  );
  rmSync(join(repo.dir, '.changeset/test-change.md'));
  repo.data('packages/pro/package.json', { version: '2.19.0' });
  repo.write('packages/pro/CHANGELOG.md', '# Changelog\n\n## 2.19.0\n\nFix shared repair.\n');
  repo.commit();
  expect(repo.check('--release').stderr).toContain('lost migration instructions');
  repo.write(
    'packages/pro/CHANGELOG.md',
    '# Changelog\n\n## 2.19.0\n\nBreaking collaboration upgrade. See #upgrade-saved-rooms.\n'
  );
  expect(repo.check('--release').status).toBe(0);
  repo.data('packages/pro/package.json', { version: '2.18.1' });
  repo.write(
    'packages/pro/CHANGELOG.md',
    '# Changelog\n\n## 2.18.1\n\nBreaking collaboration upgrade. See #upgrade-saved-rooms.\n'
  );
  expect(repo.check('--release').stderr).toContain('cannot ship in a patch');
});

test('publication refuses modified tarballs before invoking npm', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collaboration-tamper-'));
  directories.push(dir);
  writeFileSync(join(dir, 'package-lock.json'), '{}');
  writeFileSync(join(dir, 'pro.tgz'), 'tampered');
  writeFileSync(
    join(dir, 'candidate.json'),
    JSON.stringify({
      lockHash: sha('{}'),
      packages: {
        '@docx-editor.dev/pro': { filename: 'pro.tgz', hash: sha('original') },
      },
    })
  );
  expect(() => verifyCandidate(resolve(dir))).toThrow('Candidate tarball changed');
});

test('the first baseline cannot hide a format change without a package release', () => {
  const repo = repository();
  repo.addDecision('migration-required');
  const decision = JSON.parse(
    readFileSync(join(repo.dir, '.collaboration/changes/test-change.json'), 'utf8')
  );
  repo.data('.collaboration/changes/test-change.json', {
    ...decision,
    fields: ['repairVersion'],
    migration: 'upgrade-saved-rooms',
  });
  repo.write(
    'packages/pro/src/collaboration/document-compatibility.ts',
    'const versions = {protocolVersion: 1, sharedSchemaVersion: 3, repairVersion: 2, canonicalModelVersion: 1,};\n'
  );
  repo.write(
    '.changeset/test-change.md',
    "---\n'@docx-editor.dev/pro': minor\n---\n\nBreaking collaboration upgrade. See #upgrade-saved-rooms.\n"
  );
  repo.commit();
  expect(repo.check('--release').stderr).toContain('without a new package release');
});

test('a staged PR preview cannot pass the final publication check', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collaboration-preview-'));
  directories.push(dir);
  writeFileSync(join(dir, 'candidate.json'), JSON.stringify({ preview: true }));
  expect(() => verifyCandidate(dir, { publication: true })).toThrow('PR preview');
});

test('an existing core Changeset covers the fixed Pro release group', () => {
  const repo = repository();
  repo.addDecision();
  repo.write('packages/core/src/store/example.ts', 'export const value = 2;\n');
  repo.write(
    '.changeset/test-change.md',
    "---\n'@docx-editor.dev/core': patch\n---\n\nPreserve shared text.\n"
  );
  expect(repo.check('--base', repo.base).status).toBe(0);
});

test('a final release with consumed Changesets needs no preview release plan', () => {
  const repo = repository();
  const result = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import { pendingVersions } from './scripts/collaboration/staging.mjs'; console.log(JSON.stringify(await pendingVersions()));",
    ],
    { cwd: repo.dir, encoding: 'utf8' }
  );
  expect(JSON.parse(result)).toEqual({});
});

test('preview planning reads all pending notes without a local main branch', () => {
  const repo = repository();
  repo.write('bun.lock', '{}\n');
  repo.data('package.json', { name: 'preview-test', private: true, workspaces: ['packages/*'] });
  repo.data('packages/core/package.json', { name: '@docx-editor.dev/core', version: '2.18.0' });
  repo.data('packages/pro/package.json', { name: '@docx-editor.dev/pro', version: '2.18.0' });
  repo.data('.changeset/config.json', {
    baseBranch: 'main',
    fixed: [['@docx-editor.dev/core', '@docx-editor.dev/pro']],
  });
  repo.write(
    '.changeset/already-on-main.md',
    '---\n"@docx-editor.dev/core": minor\n---\n\nExisting release note.\n'
  );
  const base = repo.commit();
  repo.git('update-ref', 'refs/remotes/origin/main', base);
  repo.git('checkout', '--detach', '-q');
  for (const branch of repo.git('for-each-ref', '--format=%(refname)', 'refs/heads').split('\n')) {
    if (branch) repo.git('update-ref', '-d', branch);
  }
  repo.write('.changeset/new-pr.md', '---\n"@docx-editor.dev/pro": patch\n---\n\nNew fix.\n');
  repo.commit();
  symlinkSync(join(ROOT, 'node_modules'), join(repo.dir, 'node_modules'), 'dir');
  const result = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import { pendingVersions } from './scripts/collaboration/staging.mjs'; console.log(JSON.stringify(await pendingVersions()));",
    ],
    { cwd: repo.dir, encoding: 'utf8' }
  );
  expect(JSON.parse(result)).toEqual({
    '@docx-editor.dev/core': '2.19.0',
    '@docx-editor.dev/pro': '2.19.0',
  });
  expect(repo.git('for-each-ref', '--format=%(refname)', 'refs/heads')).toBe('');
});

test('failed tooling commands retain stdout and stderr diagnostics', () => {
  expect(() =>
    run(process.execPath, [
      '-e',
      'console.log("plan failed"); console.error("details"); process.exit(1)',
    ])
  ).toThrow(/plan failed[\s\S]*details/);
});
