import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { catalogMergeState } from './catalog-merge.mjs';

const repository = 'eigenpal/docx-editor';
const version = '2.19.0';
const check = (name: string) => ({
  __typename: 'CheckRun',
  name,
  status: 'COMPLETED',
  conclusion: 'SUCCESS',
});
function pullRequest() {
  return {
    state: 'OPEN',
    isDraft: false,
    isCrossRepository: false,
    headRepository: { nameWithOwner: repository },
    baseRefName: 'main',
    headRefName: `automation/collaboration-catalog-${version}`,
    headRefOid: 'tested',
    author: { login: 'app/eigenpal-release-pal' },
    mergeable: 'MERGEABLE',
    files: [
      '.collaboration/releases.json',
      'docs/site/content/pro/collaboration-versions.mdx',
      ...['fixture.json', 'package.json', 'package-lock.json'].map(
        (file) => `.collaboration/releases/${version}/${file}`
      ),
    ].map((path) => ({ path })),
    statusCheckRollup: ['build', ...[1, 2, 3, 4].map((shard) => `collaboration (${shard}/4)`)].map(
      check
    ),
  };
}
const run = {
  id: 1,
  path: '.github/workflows/ci.yml',
  event: 'pull_request',
  head_sha: 'tested',
  status: 'completed',
  conclusion: 'success',
};
const state = (pr = pullRequest(), runs = [run]) =>
  catalogMergeState(pr, runs, version, repository);

test('a generated catalog with completed CI and compatibility checks can merge', () => {
  expect(state()).toBe('ready');
});

test('green registered checks cannot bypass CI jobs that have not been created yet', () => {
  expect(state(pullRequest(), [])).toBe('pending');
  expect(state(pullRequest(), [{ ...run, status: 'in_progress', conclusion: '' }])).toBe('pending');
  expect(state(pullRequest(), [{ ...run, head_sha: 'old-head' }])).toBe('pending');
  expect(state(pullRequest(), [{ ...run, event: 'push' }])).toBe('pending');
});

test('missing or skipped collaboration shards cannot count as success', () => {
  const pr = pullRequest();
  pr.statusCheckRollup.pop();
  expect(state(pr)).toBe('pending');
  pr.statusCheckRollup.push({ ...check('collaboration (4/4)'), conclusion: 'SKIPPED' });
  expect(state(pr)).toBe('pending');
});

test('pending checks wait and any failed check or CI run blocks merging', () => {
  const pr = pullRequest();
  pr.statusCheckRollup.push({
    ...check('optional security check'),
    status: 'IN_PROGRESS',
    conclusion: '',
  });
  expect(state(pr)).toBe('pending');
  pr.statusCheckRollup.at(-1)!.status = 'COMPLETED';
  pr.statusCheckRollup.at(-1)!.conclusion = 'FAILURE';
  expect(() => state(pr)).toThrow('Check failed');
  expect(() => state(pullRequest(), [{ ...run, conclusion: 'failure' }])).toThrow(
    'CI workflow failed'
  );
});

test('external status contexts are also checked', () => {
  const pr: any = pullRequest();
  pr.statusCheckRollup.push({ __typename: 'StatusContext', context: 'Vercel', state: 'PENDING' });
  expect(state(pr)).toBe('pending');
  pr.statusCheckRollup.at(-1).state = 'FAILURE';
  expect(() => state(pr)).toThrow('Check failed');
  pr.statusCheckRollup.at(-1).state = 'SUCCESS';
  expect(state(pr)).toBe('ready');
});

test('only the generated baseline files, repository, author, and branch are eligible', () => {
  for (const change of [
    { headRefName: 'feature' },
    { baseRefName: 'other' },
    { isDraft: true },
    { isCrossRepository: true },
    { state: 'CLOSED' },
    { author: { login: 'someone' } },
    { headRepository: { nameWithOwner: 'fork/docx-editor' } },
  ]) {
    expect(() => state({ ...pullRequest(), ...change })).toThrow('Only generated');
  }
  const pr = pullRequest();
  pr.files.push({ path: '.github/workflows/release.yml' });
  expect(() => state(pr)).toThrow('outside the generated baseline');
});

test('merge conflicts stop automation and unknown mergeability waits', () => {
  expect(() => state({ ...pullRequest(), mergeable: 'CONFLICTING' })).toThrow('merge conflicts');
  expect(state({ ...pullRequest(), mergeable: 'UNKNOWN' })).toBe('pending');
  expect(state({ ...pullRequest(), state: 'MERGED' })).toBe('merged');
});

test('workflow rechecks CI and merges only the tested SHA, without relying on native auto-merge', () => {
  const workflow: any = Bun.YAML.parse(
    readFileSync(
      new URL('../../.github/workflows/collaboration-catalog.yml', import.meta.url),
      'utf8'
    )
  );
  const steps = workflow.jobs.merge.steps;
  const waitIndex = steps.findIndex((step: any) => step.run?.includes('catalog-merge.mjs wait'));
  const tokenIndex = steps.findIndex((step: any) =>
    step.uses?.startsWith('actions/create-github-app-token')
  );
  expect(tokenIndex).toBeGreaterThan(waitIndex);
  const merge = steps.at(-1);
  expect(merge.run).toContain('catalog-merge.mjs check');
  expect(merge.run).toContain('--match-head-commit "$EXPECTED_HEAD"');
  expect(merge.run).not.toContain('--auto');
  expect(merge.run).not.toContain('--admin');
});
