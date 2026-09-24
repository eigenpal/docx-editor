import { appendFileSync, realpathSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { compareVersions, run } from './common.mjs';

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
export function selectSiteRun(runs, { dispatchedAt, request, mode, after = null, followed = [] }) {
  const title = (item) => item.display_title?.trim();
  // The list request already keeps only runs created since the request's time margin.
  const dispatched = runs
    .filter((item) => item.event === 'repository_dispatch')
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
  const exact = dispatched.find((item) => title(item) === `${DISPATCH_EVENT} ${request}`);
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
        !followed.includes(item.id) &&
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
      const found = selectSiteRun(runs, { dispatchedAt, request, mode, after, followed });
      if (found) return found;
    }
    return null;
  };

  const followed = [];
  let current = await find({ attempts: findAttempts });
  if (!current) throw new Error(`No update run started in ${repository} after the request.`);
  const replaced = [];
  for (;;) {
    followed.push(current.id);
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

/**
 * Request one site update and wait for it. A version that is no longer npm `latest` is not
 * sent: a rerun after a newer release must not move the site back. The same check turns a
 * sync that a newer version cancelled into `superseded`, not a failure.
 */
export async function updateSite({
  repository,
  version,
  request,
  api,
  dispatch,
  latest,
  now = Date.now,
  wait = sleep,
}) {
  const superseded = async () => {
    const current = await latest();
    return compareVersions(current, version) > 0 ? current : null;
  };
  const newer = await superseded();
  if (newer) return { result: 'superseded', latest: newer, replaced: [] };
  const iso = (offset) => new Date(now() - offset).toISOString().replace(/\.\d+Z$/, 'Z');
  // A minute of margin for clock skew between the runner and GitHub.
  const since = iso(60_000);
  const dispatchedAt = iso(5_000);
  await withRetries(dispatch, { wait });
  const outcome = await waitForSiteRun({ repository, since, dispatchedAt, request, api, wait });
  if (outcome.result === 'cancelled') {
    const later = await superseded();
    if (later) return { ...outcome, result: 'superseded', latest: later };
  }
  return outcome;
}

async function npmLatest(name) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
        headers: { Accept: 'application/vnd.npm.install-v1+json' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`npm returned HTTP ${response.status}`);
      const latest = (await response.json())['dist-tags']?.latest;
      if (!/^\d+\.\d+\.\d+$/.test(latest ?? '')) throw new Error(`Unexpected latest tag ${latest}`);
      return latest;
    } catch (error) {
      if (attempt >= 5) throw error;
      await sleep(10_000 * attempt);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const {
    TARGET_REPOSITORY: repository,
    RELEASE_VERSION: version,
    REQUEST_ID: request,
    GITHUB_STEP_SUMMARY: summary,
  } = process.env;
  try {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !/^\d+\.\d+\.\d+$/.test(version ?? ''))
      throw new Error('Expected TARGET_REPOSITORY and a stable RELEASE_VERSION');
    if (!request?.startsWith(`${version}-`))
      throw new Error('REQUEST_ID must start with the version');
    const api = (path) => JSON.parse(run('gh', ['api', path]));
    const dispatch = () =>
      run('gh', [
        'api',
        `repos/${repository}/dispatches`,
        '-f',
        'event_type=upstream-release',
        '-f',
        `client_payload[version]=${version}`,
        '-f',
        `client_payload[request]=${request}`,
      ]);
    const outcome = await updateSite({
      repository,
      version,
      request,
      api,
      dispatch,
      latest: () => npmLatest('@docx-editor.dev/core'),
    });
    const line =
      outcome.result === 'superseded'
        ? `${repository} update: superseded by ${outcome.latest}, which the site follows instead.`
        : `${repository} update: ${outcome.result} (${outcome.url})` +
          (outcome.replaced.length
            ? ` after a newer sync replaced ${outcome.replaced.join(', ')}`
            : '');
    console.log(line);
    if (summary) appendFileSync(summary, `${line}\n`);
    if (!['success', 'superseded'].includes(outcome.result)) {
      console.error(
        `::error::The ${repository} update finished with ${outcome.result}: ${outcome.url}`
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`::error::${error.message.split('\n')[0]}`);
    console.error(error.message);
    process.exitCode = 1;
  }
}
