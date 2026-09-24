import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { jobLabel, summarizeJobs } from './post-release-report.mjs';
import { selectSiteRun, siteRunResult, waitForSiteRun, withRetries } from './site-update.mjs';

const workflow = (name: string): any =>
  Bun.YAML.parse(
    readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8')
  );
const noWait = async () => {};
const dispatchRun = (id: number, created_at: string, extra: object = {}) => ({
  id,
  created_at,
  event: 'repository_dispatch',
  display_title: 'upstream-release',
  status: 'completed',
  conclusion: 'success',
  html_url: `https://example.test/runs/${id}`,
  ...extra,
});

test('the site run is the first release dispatch at or after the request', () => {
  const since = '2026-09-24T09:40:00Z';
  const runs = [
    dispatchRun(1, '2026-09-24T09:39:59Z'),
    dispatchRun(4, '2026-09-24T09:40:30Z'),
    dispatchRun(2, '2026-09-24T09:40:05Z', { display_title: 'other-event' }),
    dispatchRun(3, '2026-09-24T09:40:10Z', { event: 'push' }),
    dispatchRun(5, '2026-09-24T09:40:20Z'),
  ];
  expect(selectSiteRun(runs, since)?.id).toBe(5);
  expect(selectSiteRun([dispatchRun(1, '2026-09-24T09:39:00Z')], since)).toBeNull();
});

test('a site run is pending until it completes, then reports its conclusion', () => {
  expect(siteRunResult({ status: 'in_progress', conclusion: null })).toBe('pending');
  expect(siteRunResult({ status: 'completed', conclusion: 'failure' })).toBe('failure');
});

test('API calls retry temporary errors and fail at once without the Actions permission', async () => {
  let calls = 0;
  const flaky = () => {
    calls += 1;
    if (calls < 3) throw new Error('gh api failed:\nHTTP 502: Bad Gateway');
    return 'ok';
  };
  expect(await withRetries(flaky, { wait: noWait })).toBe('ok');
  expect(calls).toBe(3);

  let limited = 0;
  const rateLimited = () => {
    limited += 1;
    if (limited === 1) throw new Error('HTTP 403: You have exceeded a secondary rate limit');
    return 'ok';
  };
  expect(await withRetries(rateLimited, { wait: noWait })).toBe('ok');

  const forbidden = () => {
    throw new Error('HTTP 403: Resource not accessible by integration');
  };
  await expect(withRetries(forbidden, { wait: noWait })).rejects.toThrow(
    'Actions: Read-only repository permission'
  );

  const missing = () => {
    throw new Error('HTTP 404: Not Found');
  };
  await expect(withRetries(missing, { wait: noWait })).rejects.toThrow('HTTP 404');
});

test('waiting follows the selected run to its conclusion', async () => {
  const since = '2026-09-24T09:40:00Z';
  const states = ['queued', 'in_progress', 'completed'];
  const api = (path: string) => {
    if (path.includes('/actions/runs?'))
      return { workflow_runs: [dispatchRun(7, '2026-09-24T09:40:02Z', { status: 'queued' })] };
    const status = states.shift();
    return dispatchRun(7, '2026-09-24T09:40:02Z', {
      status,
      conclusion: status === 'completed' ? 'failure' : null,
    });
  };
  const result = await waitForSiteRun({ repository: 'o/site', since, api, wait: noWait });
  expect(result).toEqual({ result: 'failure', url: 'https://example.test/runs/7' });
  await expect(
    waitForSiteRun({
      repository: 'o/site',
      since,
      api: () => ({ workflow_runs: [] }),
      wait: noWait,
      findAttempts: 2,
    })
  ).rejects.toThrow('No update run started in o/site');
});

test('the report counts every job, including source, and never calls a skip a pass', () => {
  const job = (name: string, conclusion: string) => ({
    name,
    conclusion,
    status: 'completed',
    html_url: `https://example.test/${encodeURIComponent(name)}`,
  });
  const context = { version: '2.22.0', runUrl: 'https://run', sourceUrl: 'https://source' };

  const sourceFailed = summarizeJobs(
    [
      job('source', 'failure'),
      job('updates / ${{ matrix.label }}', 'skipped'),
      job('Report', 'success'),
    ],
    context
  );
  expect(sourceFailed.failed).toBe(1);
  expect(sourceFailed.slack).toContain('❌ Post-release 2.22.0: 1 failed, 1 skipped, 0 passed.');
  expect(sourceFailed.slack).toContain('|Site update>: skipped');
  expect(sourceFailed.slack).not.toContain('Report');

  const skippedOnly = summarizeJobs(
    [job('updates / Verify published packages', 'success'), job('Release comments', 'skipped')],
    context
  );
  expect(skippedOnly.failed).toBe(0);
  expect(skippedOnly.slack.split('\n')[0]).toStartWith('⚪');
  expect(skippedOnly.markdown).toContain(
    '- ⚪ [Release comments](https://example.test/Release%20comments): skipped'
  );

  const allPassed = summarizeJobs(
    [job('updates / catalog / Merge verified catalog', 'success')],
    context
  );
  expect(allPassed.slack.split('\n')[0]).toBe('✅ Post-release 2.22.0: all 1 steps passed.');
  expect(allPassed.slack).not.toContain('do not republish');
  expect(jobLabel('updates / catalog / Merge verified catalog')).toBe('Merge verified catalog');
});

test('each post-release step is its own job, and the comments wait only for verification', () => {
  const downstream = workflow('post-release');
  const recovery = workflow('recover-release');
  expect(recovery.jobs.sites.strategy.matrix.include.map((site: any) => site.repository)).toEqual([
    'docx-editor.dev',
    'docx-to-markdown.com',
    'docx-to-pdf.dev',
  ]);
  const wait = recovery.jobs.sites.steps.find(
    (step: any) => step.name === 'Wait for the site update to finish'
  );
  expect(wait.run).toBe('node scripts/collaboration/site-update.mjs');
  expect(downstream.jobs.announcements.if).toContain('!cancelled()');
  expect(downstream.jobs.announcements.if).toContain('published_packages');
  expect(downstream.jobs.report.needs).toEqual(['source', 'updates', 'announcements']);
  expect(downstream.jobs.report.if).toStartWith('always()');
  const catalog = workflow('collaboration-catalog');
  const merge = catalog.jobs.merge.steps.find(
    (step: any) => step.name === 'Recheck and merge the tested commit'
  );
  expect(merge.run.indexOf('catalog-merge.mjs check')).toBeLessThan(
    merge.run.indexOf('event=APPROVE')
  );
  expect(merge.run).toContain('commit_id="$EXPECTED_HEAD"');
  expect(catalog.jobs.merge.permissions['pull-requests']).toBe('write');
});
