import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { hasPublishedRelease } from './post-release.mjs';

const repository = 'eigenpal/docx-editor';
const source = {
  repository: { full_name: repository },
  head_repository: { full_name: repository },
  path: '.github/workflows/release.yml',
  head_branch: 'main',
  event: 'push',
  status: 'completed',
};
const publish = { name: 'Release PR or Publish', conclusion: 'success' };
const tag = { name: 'Create umbrella version tag (vX.Y.Z)', conclusion: 'success' };
const jobs = (steps: unknown[]) => [{ name: 'Release', steps }];

test('downstream runs after a real publication, including an old run that failed after tagging', () => {
  for (const conclusion of ['success', 'failure']) {
    expect(hasPublishedRelease({ ...source, conclusion }, jobs([publish, tag]), repository)).toBe(
      true
    );
  }
});

test('PR updates, no-op release reruns, failed publication, and failed tagging do not dispatch', () => {
  for (const steps of [
    [],
    [publish],
    [publish, { ...tag, conclusion: 'skipped' }],
    [{ ...publish, conclusion: 'failure' }, tag],
    [publish, { ...tag, conclusion: 'failure' }],
  ]) {
    expect(hasPublishedRelease(source, jobs(steps), repository)).toBe(false);
  }
  expect(hasPublishedRelease(source, [], repository)).toBe(false);
});

test('foreign repositories, branches, workflows, and unfinished runs are rejected', () => {
  for (const changed of [
    { repository: { full_name: 'fork/repo' } },
    { head_repository: { full_name: 'fork/repo' } },
    { head_branch: 'feature' },
    { path: '.github/workflows/ci.yml' },
    { status: 'in_progress' },
    { event: 'pull_request' },
  ]) {
    expect(() =>
      hasPublishedRelease({ ...source, ...changed }, jobs([publish, tag]), repository)
    ).toThrow();
  }
});

const workflow = (name: string): any =>
  Bun.YAML.parse(
    readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8')
  );

test('publication and its Slack notification cannot wait on registry verification or downstream workflows', () => {
  const release = workflow('release');
  const steps = release.jobs.release.steps;
  expect(steps.some((step: any) => step.run?.includes('verify-published'))).toBe(false);
  expect(steps.some((step: any) => step.run?.includes('/dispatches'))).toBe(false);
  expect(Object.values(release.jobs).some((job: any) => job.uses)).toBe(false);
  const slack = steps.find((step: any) => step.name === 'Notify Slack — release succeeded');
  expect(slack.if).toContain('steps.changesets.outputs.published');
  expect(slack['continue-on-error']).toBe(true);
  expect(slack.run).toContain('--max-time 30');
});

test('downstream starts on completed main releases and all effects depend on verified artifacts', () => {
  const downstream = workflow('post-release');
  const recovery = workflow('recover-release');
  expect(downstream.on.workflow_run).toEqual({
    workflows: ['Release'],
    branches: ['main'],
    types: ['completed'],
  });
  expect(downstream.jobs.updates.needs).toBe('source');
  expect(downstream.jobs.updates.if).toContain("published == 'true'");
  expect(downstream.jobs.updates.uses).toBe('./.github/workflows/recover-release.yml');
  expect(downstream.jobs.announcements.needs).toContain('updates');
  expect(recovery.jobs.sites.needs).toBe('verify');
  expect(recovery.jobs.catalog.needs).toBe('verify');
  const download = recovery.jobs.verify.steps.find((step: any) =>
    step.uses?.startsWith('actions/download-artifact@')
  );
  expect(download.with['run-id']).toBe('${{ inputs.source_run_id }}');
  expect(download.with.name).toBe('collaboration-candidate');
});

test('post-release retries neither hold the release concurrency lock nor have publication credentials', () => {
  const release = workflow('release');
  for (const name of ['recover-release', 'post-release']) {
    const downstream = workflow(name);
    expect(downstream.concurrency?.group).not.toBe(release.concurrency.group);
    expect(downstream.permissions?.['id-token']).toBeUndefined();
    for (const job of Object.values(downstream.jobs) as any[]) {
      expect(job.permissions?.['id-token']).toBeUndefined();
      for (const step of job.steps ?? []) {
        expect(step.uses ?? '').not.toContain('changesets/action');
        expect(step.run ?? '').not.toMatch(/(?:npm|changeset) publish/);
      }
    }
  }
});
