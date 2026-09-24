import { appendFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { run } from './common.mjs';

// A sent dispatch is not a finished update. This waits for the site's own sync run, so a
// failed site update fails the post-release job that requested it.

export const DISPATCH_EVENT = 'upstream-release';
const TRANSIENT = /HTTP (?:5\d\d|429)|rate limit|timed out|ECONNRESET|ETIMEDOUT/i;

/**
 * The sync run this request started: the first `upstream-release` dispatch run created at
 * or after the request. The dispatch API returns no run ID, so time is the only link.
 */
export function selectSiteRun(runs, since) {
  return (
    runs
      .filter(
        (item) =>
          item.event === 'repository_dispatch' &&
          item.display_title === DISPATCH_EVENT &&
          item.created_at >= since
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0] ?? null
  );
}

/** `pending` until the run completes, then its conclusion. */
export function siteRunResult(item) {
  return item.status === 'completed' ? (item.conclusion ?? 'unknown') : 'pending';
}

/** One API call, retried on temporary GitHub errors. A missing permission fails at once. */
export async function withRetries(call, { attempts = 5, delay = 10_000, wait = sleep } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      // GitHub also sends a secondary rate limit as HTTP 403, so rule that out first.
      if (/HTTP 403|not accessible/i.test(error.message) && !/rate limit/i.test(error.message))
        throw new Error(
          'release-pal cannot read Actions runs in this repository. Give the ' +
            'eigenpal-release-pal GitHub App the Actions: Read-only repository permission.'
        );
      if (attempt >= attempts || !TRANSIENT.test(error.message)) throw error;
      console.warn(`Temporary GitHub API error (attempt ${attempt}/${attempts}); retrying.`);
      await wait(delay * attempt);
    }
  }
}

export async function waitForSiteRun({
  repository,
  since,
  api,
  wait = sleep,
  findAttempts = 40,
  findDelay = 15_000,
  pollDelay = 30_000,
}) {
  let found = null;
  for (let attempt = 0; attempt < findAttempts && !found; attempt += 1) {
    if (attempt > 0) await wait(findDelay);
    const page = await withRetries(
      () =>
        api(
          `repos/${repository}/actions/runs?event=repository_dispatch&created=${encodeURIComponent(`>=${since}`)}&per_page=20`
        ),
      { wait }
    );
    found = selectSiteRun(page.workflow_runs ?? [], since);
  }
  if (!found) throw new Error(`No update run started in ${repository} after the request.`);
  console.log(`Waiting for ${found.html_url}`);
  let result = siteRunResult(found);
  while (result === 'pending') {
    await wait(pollDelay);
    result = siteRunResult(
      await withRetries(() => api(`repos/${repository}/actions/runs/${found.id}`), { wait })
    );
  }
  return { result, url: found.html_url };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { TARGET_REPOSITORY: repository, SINCE: since, GITHUB_STEP_SUMMARY: summary } = process.env;
  try {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !since)
      throw new Error('Expected TARGET_REPOSITORY and SINCE');
    const api = (path) => JSON.parse(run('gh', ['api', path]));
    const { result, url } = await waitForSiteRun({ repository, since, api });
    const line = `${repository} update: ${result} (${url})`;
    console.log(line);
    if (summary) appendFileSync(summary, `${line}\n`);
    if (result !== 'success') {
      console.error(`::error::The ${repository} update finished with ${result}: ${url}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
