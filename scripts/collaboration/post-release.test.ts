import { expect, test } from 'bun:test';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  const verify = workflow('verify-release');
  expect(downstream.on.workflow_run).toEqual({
    workflows: ['Release'],
    branches: ['main'],
    types: ['completed'],
  });
  expect(downstream.jobs.verify.needs).toBe('source');
  expect(downstream.jobs.verify.if).toContain("published == 'true'");
  expect(downstream.jobs.verify.uses).toBe('./.github/workflows/verify-release.yml');
  expect(downstream.jobs.downstream.needs).toEqual(['source', 'verify']);
  expect(downstream.jobs.downstream.uses).toBe('./.github/workflows/release-downstream.yml');
  expect(downstream.jobs.announcements.needs).toEqual(['source', 'verify']);
  expect(recovery.jobs.verify.uses).toBe('./.github/workflows/verify-release.yml');
  expect(recovery.jobs.downstream.needs).toBe('verify');
  expect(recovery.jobs.downstream.uses).toBe('./.github/workflows/release-downstream.yml');
  const download = verify.jobs.verify.steps.find((step: any) =>
    step.uses?.startsWith('actions/download-artifact@')
  );
  expect(download.with['run-id']).toBe('${{ inputs.source_run_id }}');
  expect(download.with.name).toBe('collaboration-candidate');
});

test('post-release retries neither hold the release concurrency lock nor have publication credentials', () => {
  const release = workflow('release');
  for (const name of ['recover-release', 'verify-release', 'release-downstream', 'post-release']) {
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

test('retrying release comments deduplicates existing messages and preserves PR versus issue commands', () => {
  const steps = workflow('post-release').jobs.announcements.steps;
  const script = steps.find((step: any) => step.run?.includes('comment_release()')).run;
  const helper = script.match(/comment_release\(\) \{[\s\S]*?\n\}/)?.[0];
  expect(helper).toBeDefined();
  const dir = mkdtempSync(join(tmpdir(), 'release-comment-test-'));
  try {
    writeFileSync(
      join(dir, 'gh'),
      `#!/bin/bash
if [ "$1" = api ]; then
  if [ "$API_FAIL" = 1 ]; then exit 1; fi
  printf '%s\\n' "$COMMENTS"
else
  printf '%s\\n' "$@" > "$CALL_LOG"
fi
`,
      { mode: 0o755 }
    );
    for (const [kind, comments, apiFail] of [
      ['pr', '', '0'],
      ['issue', '', '0'],
      ['pr', '🚀 Released in [v2.19.0](https://example.test/release)', '0'],
      ['issue', '', '1'],
    ]) {
      const log = join(dir, 'call');
      rmSync(log, { force: true });
      execFileSync(
        'bash',
        [
          '-euo',
          'pipefail',
          '-c',
          `${helper}\ncomment_release ${kind} 42 v2.19.0 https://example.test/release`,
        ],
        {
          env: {
            ...process.env,
            PATH: `${dir}:${process.env.PATH}`,
            REPO: 'example/repository',
            COMMENTS: comments,
            API_FAIL: apiFail,
            CALL_LOG: log,
          },
          stdio: 'pipe',
        }
      );
      if (comments || apiFail === '1') expect(existsSync(log)).toBe(false);
      else expect(readFileSync(log, 'utf8')).toStartWith(`${kind}\ncomment\n42\n`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
