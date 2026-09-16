import { appendFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { run } from './common.mjs';

const REQUIRED = ['build', ...[1, 2, 3, 4].map((shard) => `collaboration (${shard}/4)`)];

export function catalogMergeState(pr, runs, version, repository) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a stable version');
  if (pr.state === 'MERGED') return 'merged';
  if (
    pr.state !== 'OPEN' ||
    pr.isDraft ||
    pr.isCrossRepository ||
    pr.headRepository?.nameWithOwner !== repository ||
    pr.baseRefName !== 'main' ||
    pr.headRefName !== `automation/collaboration-catalog-${version}` ||
    pr.author?.login !== 'app/eigenpal-release-pal'
  )
    throw new Error(
      'Only generated release-pal catalog PRs targeting main can merge automatically'
    );
  const allowed = [
    '.collaboration/releases.json',
    'docs/site/content/pro/collaboration-versions.mdx',
    ...['fixture.json', 'package.json', 'package-lock.json'].map(
      (file) => `.collaboration/releases/${version}/${file}`
    ),
  ].sort();
  if (JSON.stringify(pr.files.map((file) => file.path).sort()) !== JSON.stringify(allowed))
    throw new Error('Catalog PR changes files outside the generated baseline');
  if (pr.mergeable === 'CONFLICTING') throw new Error('Catalog PR has merge conflicts');
  const checks = pr.statusCheckRollup ?? [];
  let pending = !checks.length || pr.mergeable !== 'MERGEABLE';
  for (const check of checks) {
    if (check.__typename === 'CheckRun') {
      if (check.status !== 'COMPLETED') {
        pending = true;
        continue;
      }
      if (!['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(check.conclusion))
        throw new Error(`Check failed: ${check.name} (${check.conclusion})`);
    } else if (check.state === 'PENDING' || check.state === 'EXPECTED') pending = true;
    else if (check.state !== 'SUCCESS') throw new Error(`Check failed: ${check.context}`);
  }
  if (
    REQUIRED.some(
      (name) => !checks.some((check) => check.name === name && check.conclusion === 'SUCCESS')
    )
  )
    pending = true;
  // Jobs appear in stages. A green set of currently registered checks is not
  // enough: wait for the entire CI workflow at this exact PR head to finish.
  const ci = runs
    .filter(
      (item) =>
        item.path === '.github/workflows/ci.yml' &&
        item.event === 'pull_request' &&
        item.head_sha === pr.headRefOid
    )
    .sort((a, b) => b.id - a.id)[0];
  if (!ci || ci.status !== 'completed') pending = true;
  else if (ci.conclusion !== 'success') throw new Error(`CI workflow failed: ${ci.conclusion}`);
  return pending ? 'pending' : 'ready';
}

async function main() {
  const {
    GITHUB_REPOSITORY: repository,
    PR_NUMBER: number,
    RELEASE_VERSION: version,
    EXPECTED_HEAD: expected,
  } = process.env;
  const mode = process.argv[2];
  if (
    !['wait', 'check'].includes(mode) ||
    !/^\d+$/.test(number ?? '') ||
    !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')
  )
    throw new Error('Invalid catalog merge inputs');
  const deadline = Date.now() + 35 * 60_000;
  let head = expected;
  for (;;) {
    const pr = JSON.parse(
      run('gh', [
        'pr',
        'view',
        number,
        '--repo',
        repository,
        '--json',
        'state,isDraft,isCrossRepository,headRepository,baseRefName,headRefName,headRefOid,author,files,mergeable,statusCheckRollup',
      ])
    );
    head ??= pr.headRefOid;
    if (pr.headRefOid !== head)
      throw new Error('Catalog PR changed while waiting; rerun capture to check the new head');
    const runs = JSON.parse(
      run('gh', [
        'api',
        `repos/${repository}/actions/runs?event=pull_request&head_sha=${head}&per_page=100`,
      ])
    ).workflow_runs;
    const state = catalogMergeState(pr, runs, version, repository);
    console.log(`Catalog PR #${number} at ${head}: ${state}`);
    if (state === 'merged') return;
    if (state === 'ready') {
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `head=${head}\n`);
      return;
    }
    if (mode === 'check' || Date.now() >= deadline)
      throw new Error('Catalog checks are not complete; leaving the PR open');
    await sleep(20_000);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
