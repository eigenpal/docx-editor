import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { jobLabel, summarizeJobs } from './post-release-report.mjs';
import { withRetries } from './common.mjs';
import { selectSiteRun, siteRunResult, updateSite, waitForSiteRun } from './site-update.mjs';

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

test('the site run is the one named after the request; an unnamed run only as a fallback', () => {
  const dispatchedAt = '2026-09-24T09:39:55Z';
  const request = '2.22.0-123-1-docx-editor.dev';
  const runs = [
    dispatchRun(1, '2026-09-24T09:39:30Z'),
    dispatchRun(4, '2026-09-24T09:40:30Z'),
    dispatchRun(2, '2026-09-24T09:40:05Z', { display_title: 'other-event' }),
    dispatchRun(3, '2026-09-24T09:40:10Z', { event: 'push' }),
    dispatchRun(5, '2026-09-24T09:40:20Z'),
  ];
  const pick = (list: any[], mode: string) =>
    selectSiteRun(list, { dispatchedAt, request, mode })?.id ?? null;
  // Without a named run, exact mode waits, and the fallback skips the run from before the dispatch.
  expect(pick(runs, 'exact')).toBeNull();
  expect(pick(runs, 'fallback')).toBe(5);
  const named = [
    ...runs,
    dispatchRun(6, '2026-09-24T09:40:01Z', { display_title: 'upstream-release 2.22.0-999-1-x' }),
    dispatchRun(7, '2026-09-24T09:40:40Z', { display_title: `upstream-release ${request}` }),
  ];
  expect(pick(named, 'exact')).toBe(7);
  expect(pick(named, 'fallback')).toBe(7);
  // Another workflow on the same dispatch event never counts as the site's sync.
  const otherWorkflow = [
    dispatchRun(15, '2026-09-24T09:40:00Z', { path: '.github/workflows/notify.yml' }),
    dispatchRun(16, '2026-09-24T09:40:09Z', { path: '.github/workflows/sync-release.yml' }),
  ];
  expect(
    selectSiteRun(otherWorkflow, {
      dispatchedAt,
      request,
      mode: 'fallback',
      workflow: '.github/workflows/sync-release.yml',
    })?.id
  ).toBe(16);
});

test('after a cancel, only a later run of the same version that was not followed replaces it', () => {
  const request = '2.22.0-1-1-site';
  const ours = dispatchRun(8, '2026-09-24T09:40:02Z', {
    display_title: `upstream-release ${request}`,
  });
  const sameSecond = dispatchRun(9, '2026-09-24T09:40:02Z', {
    display_title: 'upstream-release 2.22.0-2-1-site',
  });
  const otherVersion = dispatchRun(10, '2026-09-24T09:40:01Z', {
    display_title: 'upstream-release 2.22.1-3-1-site',
  });
  const pick = (list: any[], followed: number[]) =>
    selectSiteRun(list, { request, mode: 'replacement', after: ours, followed })?.id ?? null;
  expect(pick([ours, otherVersion, sameSecond], [8])).toBe(9);
  // Two runs cancelled in the same second must not replace each other forever.
  expect(pick([ours, otherVersion, sameSecond], [8, 9])).toBeNull();
  // A site that does not name its runs: only a later unnamed run replaces an unnamed one.
  const unnamed = dispatchRun(13, '2026-09-24T09:40:02Z');
  const laterUnnamed = dispatchRun(14, '2026-09-24T09:40:30Z');
  expect(
    selectSiteRun([unnamed, sameSecond, laterUnnamed], {
      request,
      mode: 'replacement',
      after: unnamed,
      followed: [13],
    })?.id
  ).toBe(14);
  const newerVersion = dispatchRun(11, '2026-09-24T09:41:00Z', {
    display_title: 'upstream-release 2.23.0-4-1-site',
  });
  expect(pick([ours, newerVersion], [8])).toBeNull();
});

test('a site never receives a version older than npm latest', async () => {
  let dispatched = 0;
  const base = {
    repository: 'o/site',
    version: '2.22.0',
    request: '2.22.0-1-1-site',
    wait: noWait,
    now: () => Date.parse('2026-09-24T09:40:00Z'),
    dispatch: () => {
      dispatched += 1;
    },
  };
  const skipped = await updateSite({
    ...base,
    api: () => ({ workflow_runs: [] }),
    latest: async () => '2.23.0',
  });
  expect(skipped).toMatchObject({ result: 'superseded', latest: '2.23.0' });
  expect(dispatched).toBe(0);

  // A newer version's sync cancelled ours: the site follows the newer release.
  const cancelled = dispatchRun(12, '2026-09-24T09:40:02Z', {
    display_title: 'upstream-release 2.22.0-1-1-site',
    conclusion: 'cancelled',
  });
  const answers = ['2.22.0', '2.22.1'];
  const followedNewer = await updateSite({
    ...base,
    api: () => ({ workflow_runs: [cancelled] }),
    latest: async () => answers.shift()!,
  });
  expect(followedNewer).toMatchObject({ result: 'superseded', latest: '2.22.1' });
  expect(dispatched).toBe(1);

  // A failed request is not sent twice: a retry could start a second sync.
  let attempts = 0;
  await expect(
    updateSite({
      ...base,
      api: () => ({ workflow_runs: [] }),
      latest: async () => '2.22.0',
      dispatch: () => {
        attempts += 1;
        throw new Error('HTTP 502: Bad Gateway');
      },
    })
  ).rejects.toThrow('HTTP 502');
  expect(attempts).toBe(1);
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
  await expect(
    withRetries(forbidden, { wait: noWait, permission: 'Needs Actions: Read-only.' })
  ).rejects.toThrow('Needs Actions: Read-only.');
  // Without a hint, the original message stays.
  await expect(withRetries(forbidden, { wait: noWait })).rejects.toThrow(
    'Resource not accessible by integration'
  );

  const missing = () => {
    throw new Error('HTTP 404: Not Found');
  };
  await expect(withRetries(missing, { wait: noWait })).rejects.toThrow('HTTP 404');

  // Any other 403 keeps its own message instead of blaming the Actions permission.
  const sso = () => {
    throw new Error('HTTP 403: Resource protected by organization SAML enforcement');
  };
  await expect(withRetries(sso, { wait: noWait })).rejects.toThrow('SAML enforcement');

  const waits: number[] = [];
  let primary = 0;
  const primaryLimit = () => {
    primary += 1;
    if (primary < 3) throw new Error('HTTP 403: API rate limit exceeded for installation');
    return 'ok';
  };
  const record = async (ms: number) => {
    waits.push(ms);
  };
  expect(await withRetries(primaryLimit, { wait: record })).toBe('ok');
  expect(waits).toEqual([60_000, 120_000]);
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
  const request = '2.22.0-r';
  const result = await waitForSiteRun({
    repository: 'o/site',
    since,
    request,
    api,
    wait: noWait,
    exactAttempts: 1,
  });
  expect(result).toEqual({ result: 'failure', url: 'https://example.test/runs/7', replaced: [] });
  await expect(
    waitForSiteRun({
      repository: 'o/site',
      since,
      request,
      api: () => ({ workflow_runs: [] }),
      wait: noWait,
      findAttempts: 2,
    })
  ).rejects.toThrow('No update run started in o/site');
});

test('a sync that the site cancels for a newer one reports the newer run', async () => {
  const since = '2026-09-24T09:40:00Z';
  const request = '2.22.0-1-1-site';
  const ours = dispatchRun(8, '2026-09-24T09:40:02Z', {
    display_title: `upstream-release ${request}`,
    conclusion: 'cancelled',
  });
  const newer = dispatchRun(9, '2026-09-24T09:41:00Z', {
    display_title: 'upstream-release 2.22.0-2-1-site',
  });
  const api = (path: string) =>
    path.includes('/actions/runs?') ? { workflow_runs: [ours, newer] } : newer;
  const result = await waitForSiteRun({ repository: 'o/site', since, request, api, wait: noWait });
  expect(result).toEqual({
    result: 'success',
    url: 'https://example.test/runs/9',
    replaced: ['https://example.test/runs/8'],
  });
  const alone = await waitForSiteRun({
    repository: 'o/site',
    since,
    request,
    api: () => ({ workflow_runs: [ours] }),
    wait: noWait,
  });
  expect(alone.result).toBe('cancelled');
});

test('the report counts every job, including source, and never calls a skip a pass', () => {
  const job = (name: string, conclusion: string) => ({
    name,
    conclusion,
    status: 'completed',
    html_url: `https://example.test/${encodeURIComponent(name)}`,
  });
  const context = {
    version: '2.22.0',
    published: false,
    runUrl: 'https://run',
    sourceUrl: 'https://source',
  };

  const sourceFailed = summarizeJobs(
    [
      job('source', 'failure'),
      job('downstream / Site update', 'skipped'),
      job('Report', 'success'),
    ],
    context
  );
  expect(sourceFailed.failed).toBe(1);
  expect(sourceFailed.slack).toContain('❌ Post-release 2.22.0: 1 failed, 1 skipped, 0 passed.');
  expect(sourceFailed.slack).toContain('|Site update>: skipped');
  expect(jobLabel('downstream / Site update (docx-editor.dev)')).toBe(
    'Site update (docx-editor.dev)'
  );
  expect(sourceFailed.slack).not.toContain('Report');
  // Nothing confirmed the release, so the report must not claim the packages are on npm.
  expect(sourceFailed.slack).not.toContain('do not republish');
  expect(sourceFailed.slack).toContain('could not confirm what was published');
  const siteFailed = summarizeJobs([job('downstream / Site update (docx-editor.dev)', 'failure')], {
    ...context,
    published: true,
  });
  expect(siteFailed.slack).toContain('do not republish');

  const skippedOnly = summarizeJobs(
    [job('verify / Verify published packages', 'success'), job('Release comments', 'skipped')],
    context
  );
  expect(skippedOnly.failed).toBe(0);
  expect(skippedOnly.slack.split('\n')[0]).toStartWith('⚪');
  expect(skippedOnly.markdown).toContain(
    '- ⚪ [Release comments](https://example.test/Release%20comments): skipped'
  );

  const allPassed = summarizeJobs(
    [job('downstream / catalog / Merge verified catalog', 'success')],
    context
  );
  expect(allPassed.slack.split('\n')[0]).toBe('✅ Post-release 2.22.0: all 1 steps passed.');
  expect(allPassed.slack).not.toContain('do not republish');
  expect(jobLabel('downstream / catalog / Merge verified catalog')).toBe('Merge verified catalog');
});

test('each post-release step is its own job, and the comments wait only for verification', () => {
  const downstream = workflow('post-release');
  const recovery = workflow('release-downstream');
  expect(recovery.jobs.sites.name).toBe('Site update');
  expect(recovery.jobs.sites.strategy.matrix.include).toEqual([
    { repository: 'docx-editor.dev', workflow: 'sync-upstream-api.yml' },
    { repository: 'docx-to-markdown.com', workflow: 'sync-release.yml' },
    { repository: 'docx-to-pdf.dev', workflow: 'sync-release.yml' },
  ]);
  expect(recovery.jobs.sites.env.SYNC_WORKFLOW).toBe('.github/workflows/${{ matrix.workflow }}');
  const update = recovery.jobs.sites.steps.find(
    (step: any) => step.name === 'Request the site update and wait for it'
  );
  expect(update.run).toBe('node scripts/collaboration/site-update.mjs');
  expect(recovery.jobs.sites.env.REQUEST_ID).toStartWith('${{ inputs.version }}-');
  // Verification is gated on the calling job, so a skip there skips everything after it,
  // and nothing depends on reusable-workflow outputs, which a rerun can lose.
  expect(downstream.jobs.verify.if).toContain("github.ref == 'refs/heads/main'");
  expect(workflow('recover-release').jobs.verify.if).toBe("github.ref == 'refs/heads/main'");
  expect(downstream.jobs.downstream.if).toBeUndefined();
  expect(JSON.stringify(downstream.jobs)).not.toContain('outputs.published_packages');
  const fallback = downstream.jobs.report.steps.at(-1);
  expect(fallback.if).toBe('failure() || cancelled()');
  expect(fallback.run).toContain('curl');
  expect(downstream.jobs.announcements.needs).toEqual(['source', 'verify']);
  expect(downstream.jobs.report.needs).toEqual(['source', 'verify', 'downstream', 'announcements']);
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
  // A merged PR cannot take a review, so the merge step checks the state first.
  expect(merge.run.indexOf('= MERGED')).toBeLessThan(merge.run.indexOf('event=APPROVE'));
  // A rerun finds the catalog already recorded, and reports that as a pass.
  expect(catalog.jobs.merge.if).toContain("needs.capture.outputs.recorded == 'true'");
  expect(downstream.jobs.report.permissions).toEqual({ actions: 'read', contents: 'read' });
});

test('only verification holds the downstream concurrency group, not the site waits', () => {
  const verify = workflow('verify-release');
  const recovery = workflow('release-downstream');
  expect(verify.concurrency).toBeUndefined();
  expect(verify.jobs.verify.concurrency).toEqual({
    group: 'post-release-updates',
    'cancel-in-progress': false,
  });
  expect(recovery.concurrency).toBeUndefined();
  expect(recovery.jobs.sites.concurrency).toBeUndefined();
  expect(recovery.jobs.sites.env.REQUEST_ID).toContain('${{ github.run_id }}');
});
