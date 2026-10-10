import { appendFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { run, withRetries } from './common.mjs';

// One message per release that lists every post-release job with its result, so a reader
// knows what went through and what to fix without opening the run.

export const REPORT_JOB = 'Report';

/** A job's display name without its reusable-workflow prefix (`updates / catalog / …`). */
export function jobLabel(name) {
  return name.split(' / ').at(-1);
}

export function summarizeJobs(jobs, { version, published, runUrl, sourceUrl }) {
  const rows = jobs
    .filter((job) => job.name !== REPORT_JOB)
    .map((job) => ({
      label: jobLabel(job.name),
      result: job.conclusion ?? job.status,
      url: job.html_url,
    }));
  const count = (test) => rows.filter((row) => test(row.result)).length;
  const passed = count((result) => result === 'success');
  const skipped = count((result) => result === 'skipped');
  const failed = rows.length - passed - skipped;
  const release = version ? `Post-release ${version}` : 'Post-release';
  const title =
    failed > 0
      ? `${release}: ${failed} failed, ${skipped} skipped, ${passed} passed.`
      : skipped > 0
        ? `${release}: ${passed} passed, ${skipped} skipped. Check that each skipped step was not needed.`
        : `${release}: all ${passed} steps passed.`;
  // Only a confirmed release may say that the packages are on npm.
  const next =
    failed === 0
      ? ''
      : published
        ? 'The packages are already on npm; do not republish. Fix the cause, then rerun the failed jobs in the post-release run.'
        : 'The run could not confirm what was published. Check the Release run before you retry anything.';
  const icon = (result) => (result === 'success' ? '✅' : result === 'skipped' ? '⚪' : '❌');
  const suffix = (result) => (result === 'success' ? '' : `: ${result}`);
  const slack = [
    `${icon(failed ? 'failure' : skipped ? 'skipped' : 'success')} ${title}`,
    ...rows.map((row) => `${icon(row.result)} <${row.url}|${row.label}>${suffix(row.result)}`),
    next,
    `<${sourceUrl}|Release run> · <${runUrl}|Post-release run>`,
  ]
    .filter(Boolean)
    .join('\n');
  const markdown = [
    `### ${title}`,
    '',
    ...rows.map((row) => `- ${icon(row.result)} [${row.label}](${row.url})${suffix(row.result)}`),
    '',
    next,
    `[Release run](${sourceUrl}) · [Post-release run](${runUrl})`,
  ]
    .filter((line, index, all) => line !== '' || all[index - 1] !== '')
    .join('\n');
  return { failed, skipped, passed, slack, markdown };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const env = process.env;
  try {
    // Few attempts: the job has 15 minutes, and a plain alert follows if this fails.
    const pages = await withRetries(
      () =>
        JSON.parse(
          run('gh', [
            'api',
            // `latest`: after a rerun, each job's newest attempt, not the first failure.
            `repos/${env.REPO}/actions/runs/${env.RUN_ID}/jobs?filter=latest&per_page=100`,
          ])
        ),
      { attempts: 4 }
    );
    const report = summarizeJobs(pages.jobs, {
      version: env.VERSION,
      published: env.PUBLISHED === 'true',
      runUrl: env.RUN_URL,
      sourceUrl: env.SOURCE_URL,
    });
    console.log(report.markdown);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${report.markdown}\n`);
    if (env.SLACK_WEBHOOK_URL) {
      await withRetries(
        async () => {
          // A request that timed out may have been delivered, so it is not sent again.
          const response = await fetch(env.SLACK_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: report.slack }),
            signal: AbortSignal.timeout(30_000),
          }).catch((error) => {
            throw new Error(`Slack did not answer: ${error.name}`);
          });
          if (!response.ok) throw new Error(`Slack returned HTTP ${response.status}`);
        },
        { attempts: 3, delay: 5_000 }
      );
    }
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
