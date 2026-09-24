import { appendFileSync, realpathSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { run } from './common.mjs';

// A sent dispatch is not a finished update. This waits for the site's own sync run, so a
// failed site update fails the post-release job that requested it.

export const DISPATCH_EVENT = 'upstream-release';
const PERMISSION = /Resource not accessible by integration/i;
const RATE_LIMIT = /rate limit/i;
const TRANSIENT = /HTTP (?:5\d\d|429)|timed out|ECONNRESET|ETIMEDOUT/i;

/**
 * The sync run a request started, in order of preference:
 *
 * - `mode: 'exact'`: the run named `upstream-release <request>`. Each site names its dispatch
 *   runs after the request ID, so this is exact.
 * - `mode: 'fallback'`: a site that does not name its runs shows the bare event name. The
 *   first such run created after `dispatchedAt` is the best match the dispatch API allows.
 * - `mode: 'replacement'`: after the site cancels a run for a newer one, the next run of the
 *   same version. The request ID starts with the version.
 */
export function selectSiteRun(runs, { since, dispatchedAt, request, mode, after = null }) {
  const title = (item) => item.display_title?.trim();
  const dispatched = runs
    .filter((item) => item.event === 'repository_dispatch')
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
  const exact = dispatched.find(
    (item) => item.created_at >= since && title(item) === `${DISPATCH_EVENT} ${request}`
  );
  if (mode === 'exact') return exact ?? null;
  if (mode === 'fallback')
    return (
      exact ??
      dispatched.find(
        (item) => item.created_at >= dispatchedAt && title(item) === DISPATCH_EVENT
      ) ??
      null
    );
  const version = request.split('-')[0];
  return (
    dispatched.find(
      (item) =>
        item.id !== after.id &&
        item.created_at >= after.created_at &&
        title(item)?.startsWith(`${DISPATCH_EVENT} ${version}-`)
    ) ?? null
  );
}

/** `pending` until the run completes, then its conclusion. */
export function siteRunResult(item) {
  return item.status === 'completed' ? (item.conclusion ?? 'unknown') : 'pending';
}

/**
 * One API call, retried on temporary GitHub errors. A rate limit waits longer, because the
 * limit resets on a fixed window. A missing permission fails at once and says which one.
 */
export async function withRetries(
  call,
  { attempts = 8, delay = 10_000, rateLimitDelay = 60_000, wait = sleep } = {}
) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      if (PERMISSION.test(error.message))
        throw new Error(
          'release-pal cannot read Actions runs in this repository. Give the ' +
            'eigenpal-release-pal GitHub App the Actions: Read-only repository permission.\n' +
            error.message
        );
      const limited = RATE_LIMIT.test(error.message);
      if (attempt >= attempts || !(limited || TRANSIENT.test(error.message))) throw error;
      console.warn(`Temporary GitHub API error (attempt ${attempt}/${attempts}); retrying.`);
      await wait((limited ? rateLimitDelay : delay) * attempt);
    }
  }
}

export async function waitForSiteRun({
  repository,
  since,
  dispatchedAt = since,
  request,
  api,
  wait = sleep,
  findAttempts = 40,
  exactAttempts = 8,
  replacementAttempts = 3,
  findDelay = 15_000,
  pollDelay = 30_000,
}) {
  const list = () =>
    withRetries(
      () =>
        api(
          `repos/${repository}/actions/runs?event=repository_dispatch&created=${encodeURIComponent(`>=${since}`)}&per_page=50`
        ),
      { wait }
    );
  const find = async ({ attempts, after = null }) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await wait(findDelay);
      // Give the exact name time to appear before accepting an unnamed run.
      const mode = after ? 'replacement' : attempt < exactAttempts ? 'exact' : 'fallback';
      const runs = (await list()).workflow_runs ?? [];
      const found = selectSiteRun(runs, { since, dispatchedAt, request, mode, after });
      if (found) return found;
    }
    return null;
  };

  let current = await find({ attempts: findAttempts });
  if (!current) throw new Error(`No update run started in ${repository} after the request.`);
  const replaced = [];
  for (;;) {
    console.log(`Waiting for ${current.html_url}`);
    let result = siteRunResult(current);
    while (result === 'pending') {
      await wait(pollDelay);
      const id = current.id;
      current = await withRetries(() => api(`repos/${repository}/actions/runs/${id}`), { wait });
      result = siteRunResult(current);
    }
    // The site's own concurrency group cancels a pending sync when a newer one queues.
    // That newer run does the update, so follow it instead of reporting a failure.
    if (result !== 'cancelled') return { result, url: current.html_url, replaced };
    const next = await find({ attempts: replacementAttempts, after: current });
    if (!next) return { result, url: current.html_url, replaced };
    replaced.push(current.html_url);
    current = next;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const {
    TARGET_REPOSITORY: repository,
    SINCE: since,
    DISPATCHED_AT: dispatchedAt,
    REQUEST_ID: request,
    GITHUB_STEP_SUMMARY: summary,
  } = process.env;
  try {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !since || !request)
      throw new Error('Expected TARGET_REPOSITORY, SINCE, and REQUEST_ID');
    const api = (path) => JSON.parse(run('gh', ['api', path]));
    const { result, url, replaced } = await waitForSiteRun({
      repository,
      since,
      dispatchedAt: dispatchedAt || since,
      request,
      api,
    });
    const note = replaced.length ? ` after a newer sync replaced ${replaced.join(', ')}` : '';
    const line = `${repository} update: ${result} (${url})${note}`;
    console.log(line);
    if (summary) appendFileSync(summary, `${line}\n`);
    if (result !== 'success') {
      console.error(`::error::The ${repository} update finished with ${result}: ${url}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`::error::${error.message.split('\n')[0]}`);
    console.error(error.message);
    process.exitCode = 1;
  }
}
