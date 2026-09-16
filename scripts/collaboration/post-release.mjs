import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { git, run } from './common.mjs';
import { validateRecoverySource } from './recovery.mjs';

export function hasPublishedRelease(source, jobs, repository) {
  if (
    source.repository?.full_name !== repository ||
    source.head_repository?.full_name !== repository ||
    source.path !== '.github/workflows/release.yml' ||
    source.head_branch !== 'main' ||
    !['push', 'workflow_dispatch'].includes(source.event) ||
    source.status !== 'completed'
  )
    throw new Error('Expected a completed Release run from this repository on main');
  const steps = jobs.find((job) => job.name === 'Release')?.steps ?? [];
  return ['Release PR or Publish', 'Create umbrella version tag (vX.Y.Z)'].every((name) =>
    steps.some((step) => step.name === name && step.conclusion === 'success')
  );
}

export function identifyRelease(id, repository) {
  if (!/^\d+$/.test(id ?? '') || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? ''))
    throw new Error('Invalid source run');
  const api = (path) => JSON.parse(run('gh', ['api', `repos/${repository}/${path}`]));
  const source = api(`actions/runs/${id}`);
  const jobs = api(`actions/runs/${id}/attempts/${source.run_attempt}/jobs?per_page=100`).jobs;
  if (!hasPublishedRelease(source, jobs, repository)) return { published: false };
  const { version } = JSON.parse(git('show', `${source.head_sha}:packages/core/package.json`));
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a stable release version');
  validateRecoverySource(source, jobs, {
    repository,
    version,
    commit: git('rev-parse', `v${version}^{commit}`),
  });
  return { published: true, version };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = identifyRelease(process.env.SOURCE_RUN_ID, process.env.GITHUB_REPOSITORY);
    for (const [key, value] of Object.entries(result)) {
      console.log(`${key}=${value}`);
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
