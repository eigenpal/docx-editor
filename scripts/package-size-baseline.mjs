import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The run does not have to be finished or green. Main pushes cancel each other
// (`cancel-in-progress`), and a PR often starts while its base is still running.
// The build job uploads `package-sizes` only after the build and size check pass,
// so a retained artifact on the exact base commit is a sound baseline.
export function selectBaselineRuns(runs, { repository, branch, sha }) {
  return runs
    .filter(
      (run) =>
        run.head_sha === sha &&
        run.head_branch === branch &&
        run.event === 'push' &&
        run.path === '.github/workflows/ci.yml' &&
        run.head_repository?.full_name === repository
    )
    .sort((a, b) => b.id - a.id);
}

export function downloadBaseline(
  { repository, branch, sha, directory = 'baseline' },
  run = (args) => execFileSync('gh', args, { encoding: 'utf8', timeout: 120_000 })
) {
  assert.match(repository ?? '', /^[\w.-]+\/[\w.-]+$/);
  assert.match(sha ?? '', /^[a-f0-9]{40}$/);
  assert.ok(branch, 'PR base branch is required');
  // A failed or missing download must never leave an older report available to the gate.
  mkdirSync(directory, { recursive: true });
  rmSync(join(directory, 'package-sizes.json'), { force: true });
  const api = (path) =>
    JSON.parse(run(['api', '-H', 'Cache-Control: no-cache', `repos/${repository}/${path}`]));
  const query = new URLSearchParams({ branch, event: 'push', head_sha: sha, per_page: '100' });
  const candidates = selectBaselineRuns(
    api(`actions/workflows/ci.yml/runs?${query}`).workflow_runs,
    {
      repository,
      branch,
      sha,
    }
  );
  const source = candidates.find((candidate) =>
    api(`actions/runs/${candidate.id}/artifacts?per_page=100`).artifacts.some(
      (artifact) => artifact.name === 'package-sizes' && !artifact.expired
    )
  );
  if (!source) {
    console.log(
      `No CI run for ${branch}@${sha} has a retained package-sizes artifact (${candidates.length} checked); reporting sizes without deltas.`
    );
    return;
  }
  run([
    'run',
    'download',
    String(source.id),
    '--repo',
    repository,
    '-n',
    'package-sizes',
    '-D',
    directory,
  ]);
  const message = `Package-size baseline: ${branch}@${sha}, CI run https://github.com/${repository}/actions/runs/${source.id}.`;
  console.log(message);
  return message;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const message = downloadBaseline({
    repository: process.env.GITHUB_REPOSITORY,
    branch: process.env.BASE_BRANCH,
    sha: process.env.BASE_SHA,
  });
  if (message && process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
}
