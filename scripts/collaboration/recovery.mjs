import { pathToFileURL } from 'node:url';
import { compareVersions, git, run } from './common.mjs';
import { registry, PUBLICATION_TIMEOUT_MS } from './registry.mjs';
import { readPublicationCandidate, verifyPublication } from './publication.mjs';

export function validateRecoverySource(source, jobs, { repository, version, commit }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a stable release version');
  if (
    source.repository?.full_name !== repository ||
    source.head_repository?.full_name !== repository ||
    source.path !== '.github/workflows/release.yml' ||
    source.head_branch !== 'main' ||
    !['push', 'workflow_dispatch'].includes(source.event) ||
    source.status !== 'completed' ||
    source.head_sha !== commit
  )
    throw new Error('Source must be a completed Release run on main at the requested version tag');
  if (
    !jobs.some(
      (job) =>
        job.name === 'Release' &&
        job.steps?.some(
          (step) => step.name === 'Release PR or Publish' && step.conclusion === 'success'
        )
    )
  )
    throw new Error('Source run has no successful publication step');
}

export function validateRecoveryPackages(manifest, packages, version) {
  const expected = packages
    .filter((pkg) => !pkg.private)
    .map((pkg) => pkg.name)
    .sort();
  if (
    JSON.stringify(Object.keys(manifest.packages).sort()) !== JSON.stringify(expected) ||
    packages.some((pkg) => !pkg.private && pkg.version !== version) ||
    Object.values(manifest.packages).some((pkg) => pkg.version !== version)
  )
    throw new Error('Candidate packages do not match the tagged release');
}

export async function verifyRecoveryPublication(
  manifest,
  version,
  { lookup = registry, now = Date.now, log = console.log } = {}
) {
  const deadline = now() + PUBLICATION_TIMEOUT_MS;
  await verifyPublication(manifest, { lookup, now, log, deadline });
  // Exact version metadata and dist-tags can propagate independently. Use the
  // remaining verification budget, not another timeout or a one-shot tag read.
  const controller = new AbortController();
  try {
    await Promise.all(
      ['@docx-editor.dev/core', '@docx-editor.dev/docx-to-markdown'].map(async (name) => {
        await lookup(name, '', {
          waitForPublication: true,
          deadline,
          signal: controller.signal,
          pendingReason(document) {
            const latest = document['dist-tags']?.latest;
            if (latest === version) return;
            if (latest == null) return `latest tag is missing; waiting for ${version}`;
            if (typeof latest !== 'string' || !/^\d+\.\d+\.\d+$/.test(latest))
              throw new Error(`Unexpected latest tag for ${name}: ${JSON.stringify(latest)}`);
            if (compareVersions(latest, version) > 0)
              throw new Error(
                `${name}@${version} is superseded by latest ${latest}; recover historical baselines separately`
              );
            return `latest is still ${latest}; waiting for ${version}`;
          },
        });
        log(`Verified ${name} latest is ${version}`);
      })
    );
  } catch (error) {
    controller.abort(error);
    throw error;
  }
  log('Published artifacts and latest tags are ready for downstream updates.');
}

async function main() {
  const [phase, directory] = process.argv.slice(2);
  const {
    SOURCE_RUN_ID: id,
    RELEASE_VERSION: version,
    GITHUB_REPOSITORY: repository,
  } = process.env;
  if (
    !/^\d+$/.test(id ?? '') ||
    !/^\d+\.\d+\.\d+$/.test(version ?? '') ||
    !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')
  )
    throw new Error('Invalid recovery inputs');
  const tag = `v${version}`;
  if (phase === 'source') {
    const api = (path) => JSON.parse(run('gh', ['api', `repos/${repository}/${path}`]));
    const source = api(`actions/runs/${id}`);
    const jobs = api(`actions/runs/${id}/attempts/${source.run_attempt}/jobs?per_page=100`).jobs;
    validateRecoverySource(source, jobs, {
      repository,
      version,
      commit: git('rev-parse', `${tag}^{commit}`),
    });
    console.log(`Validated Release run ${id} for ${tag}`);
  } else if (phase === 'verify') {
    const manifest = readPublicationCandidate(directory);
    const paths = git('ls-tree', '-r', '--name-only', tag, 'packages')
      .split('\n')
      .filter((path) => /^packages\/[^/]+\/package.json$/.test(path));
    const packages = paths.map((path) => JSON.parse(git('show', `${tag}:${path}`)));
    validateRecoveryPackages(manifest, packages, version);
    await verifyRecoveryPublication(manifest, version);
  } else throw new Error('Expected source or verify');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
