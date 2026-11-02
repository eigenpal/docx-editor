import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

interface Step {
  run?: string;
  if?: string;
  'continue-on-error'?: boolean;
}
interface Job {
  needs?: string | string[];
  if?: string;
  'continue-on-error'?: boolean;
  strategy?: { matrix: { include: { label: string; command: string }[] } };
  steps: Step[];
}
const workflow = Bun.YAML.parse(
  readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
) as { on: Record<string, unknown>; jobs: Record<string, Job> };

// Evaluate the repository's trusted condition with the same boolean operators.
// Tests supply only the contexts and status function used by this workflow.
function condition(
  expression: string,
  needs: unknown,
  cancelled = false,
  ref = 'refs/heads/main'
): boolean {
  const source = expression.replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '');
  return new Function('needs', 'cancelled', 'github', `return Boolean(${source});`)(
    needs,
    () => cancelled,
    { ref }
  );
}
function context(mode: string, results: Record<string, string> = {}) {
  return {
    mode: { result: 'success', outputs: { mode } },
    ...Object.fromEntries(
      ['checks', 'build', 'collaboration'].map((name) => [
        name,
        { result: results[name] ?? 'success' },
      ])
    ),
  };
}

test('manual and push publication require every prepublish gate to succeed', () => {
  expect(workflow.on).toHaveProperty('push');
  expect(workflow.on).toHaveProperty('workflow_dispatch');
  const release = workflow.jobs.release;
  expect(release.needs).toEqual(['mode', 'checks', 'build', 'collaboration']);
  expect(condition(release.if!, context('publish'))).toBe(true);
  for (const gate of ['checks', 'build', 'collaboration']) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      expect(condition(release.if!, context('publish', { [gate]: result }))).toBe(false);
    }
  }
  expect(condition(release.if!, context('publish'), true)).toBe(false);
  expect(
    condition(release.if!, { ...context('publish'), mode: { result: 'failure', outputs: {} } })
  ).toBe(false);
});

test('no stable job runs outside main, so other branches never publish', () => {
  const skipped = { checks: 'skipped', build: 'skipped', collaboration: 'skipped' };
  for (const ref of ['refs/heads/changeset-release/main', 'refs/heads/feature', 'refs/tags/v1']) {
    for (const job of ['checks', 'build', 'collaboration'])
      expect(condition(workflow.jobs[job].if!, context('publish'), false, ref)).toBe(false);
    expect(condition(workflow.jobs.release.if!, context('publish'), false, ref)).toBe(false);
    expect(condition(workflow.jobs.release.if!, context('pending', skipped), false, ref)).toBe(
      false
    );
  }
  const refusal = workflow.jobs.mode.steps.find(
    (step) => (step as { name?: string }).name === 'Refuse stable releases outside main'
  )!;
  expect(refusal.if).toBe(
    "${{ env.RELEASE_CHANNEL == 'release' && github.ref != 'refs/heads/main' }}"
  );
});

test('pending changesets keep the PR update path and idle releases remain skipped', () => {
  const skipped = { checks: 'skipped', build: 'skipped', collaboration: 'skipped' };
  expect(condition(workflow.jobs.release.if!, context('pending', skipped))).toBe(true);
  expect(condition(workflow.jobs.release.if!, context('idle', skipped))).toBe(false);
  for (const job of ['checks', 'build', 'collaboration']) {
    expect(condition(workflow.jobs[job].if!, context('publish'))).toBe(true);
    expect(condition(workflow.jobs[job].if!, context('pending'))).toBe(false);
    expect(condition(workflow.jobs[job].if!, context('idle'))).toBe(false);
    expect(workflow.jobs[job]['continue-on-error']).not.toBe(true);
  }
});

test('publication runs the advisory command and validates the freshly built API', () => {
  const checks = workflow.jobs.checks;
  expect(checks.strategy!.matrix.include).toContainEqual({
    label: 'shipped dependency advisories',
    command: 'bun run check:shipped-advisories',
  });
  const dispatch = checks.steps.find((step) => step.run === '${{ matrix.command }}');
  expect(dispatch).toBeDefined();
  expect(dispatch!.if).toBeUndefined();
  expect(dispatch!['continue-on-error']).not.toBe(true);

  const build = workflow.jobs.build;
  const compile = build.steps.findIndex((step) => step.run === 'bun run build:packages');
  const api = build.steps.findIndex((step) => step.run === 'bun run api:check');
  expect(compile).toBeGreaterThanOrEqual(0);
  expect(api).toBeGreaterThan(compile);
  expect(build.steps[api].if).toBeUndefined();
  expect(build.steps[api]['continue-on-error']).not.toBe(true);
});

interface CanaryStep extends Step {
  name?: string;
  uses?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
}
interface CanaryJob {
  if?: string;
  'runs-on'?: string;
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  steps: CanaryStep[];
}
const raw = Bun.YAML.parse(
  readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
) as {
  on: {
    schedule?: { cron: string }[];
    workflow_dispatch?: { inputs?: Record<string, { options?: string[]; default?: string }> };
  };
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<string, CanaryJob>;
};

// Evaluate a workflow expression with the given contexts. GitHub's `==` on a missing
// input compares null with a string; JavaScript's `==` on undefined gives the same answer.
function evaluate(expression: string, contexts: Record<string, unknown>): unknown {
  const source = expression.replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '');
  const names = Object.keys(contexts);
  return new Function(...names, `return (${source});`)(...names.map((name) => contexts[name]));
}
const runs = {
  push: { github: { event_name: 'push' }, inputs: {} },
  schedule: { github: { event_name: 'schedule' }, inputs: {} },
  dispatchRelease: { github: { event_name: 'workflow_dispatch' }, inputs: { channel: 'release' } },
  dispatchCanary: { github: { event_name: 'workflow_dispatch' }, inputs: { channel: 'canary' } },
};

test('the canary runs nightly and on demand, in its own concurrency group', () => {
  expect(raw.on.schedule).toEqual([{ cron: '23 3 * * *' }]);
  expect(raw.on.workflow_dispatch?.inputs?.channel.options).toEqual(['release', 'canary']);
  expect(raw.on.workflow_dispatch?.inputs?.channel.default).toBe('release');
  const group = (run: Record<string, unknown>) => evaluate(raw.concurrency.group, run);
  expect(group(runs.push)).toBe('release');
  expect(group(runs.dispatchRelease)).toBe('release');
  expect(group(runs.schedule)).toBe('release-canary');
  expect(group(runs.dispatchCanary)).toBe('release-canary');
  expect(raw.concurrency['cancel-in-progress']).toBe(false);
});

test('a canary run can only answer canary or idle', () => {
  const output = raw.jobs.mode.outputs!.mode;
  const answer = (run: Record<string, unknown>, mode?: string) =>
    evaluate(output, { ...run, steps: { mode: { outputs: { mode } } } });
  for (const run of [runs.schedule, runs.dispatchCanary]) {
    for (const mode of ['pending', 'publish', 'idle', '', undefined])
      expect(answer(run, mode)).toBe('idle');
    expect(answer(run, 'canary')).toBe('canary');
  }
  for (const run of [runs.push, runs.dispatchRelease])
    for (const mode of ['pending', 'publish', 'idle']) expect(answer(run, mode)).toBe(mode);
});

test('only a canary run with a green commit reaches the canary job', () => {
  const job = raw.jobs.canary;
  const needs = (mode: string, commit = 'a'.repeat(40), result = 'success') => ({
    mode: { result, outputs: { mode, commit } },
  });
  expect(evaluate(job.if!, { ...runs.schedule, needs: needs('canary') })).toBe(true);
  expect(evaluate(job.if!, { ...runs.dispatchCanary, needs: needs('canary') })).toBe(true);
  expect(evaluate(job.if!, { ...runs.push, needs: needs('canary') })).toBe(false);
  expect(evaluate(job.if!, { ...runs.dispatchRelease, needs: needs('canary') })).toBe(false);
  expect(evaluate(job.if!, { ...runs.schedule, needs: needs('idle') })).toBe(false);
  expect(evaluate(job.if!, { ...runs.schedule, needs: needs('canary', '') })).toBe(false);
  expect(
    evaluate(job.if!, { ...runs.schedule, needs: needs('canary', 'a'.repeat(40), 'failure') })
  ).toBe(false);
  // The stable path never runs for a canary answer.
  for (const name of ['checks', 'build', 'collaboration'])
    expect(condition(workflow.jobs[name].if!, context('canary'))).toBe(false);
  const skipped = { checks: 'skipped', build: 'skipped', collaboration: 'skipped' };
  expect(condition(workflow.jobs.release.if!, context('canary', skipped))).toBe(false);
});

test('the canary versions before it builds and publishes only to the canary tag', () => {
  const job = raw.jobs.canary;
  expect(job['runs-on']).toBe('ubuntu-latest');
  expect(job.permissions).toEqual({ contents: 'read', actions: 'read', 'id-token': 'write' });
  const index = (run: string) => job.steps.findIndex((step) => step.run === run);
  const version = index('bun run changeset version --snapshot canary');
  const build = index('bun run build:packages');
  const install = index('bun run check:consumer-install');
  const pdf = index("bun run --filter '@docx-editor.dev/docx-to-pdf' check:consumer");
  const gate = job.steps.findIndex((step) => step.name === 'Confirm no stable release is active');
  const publish = index('bun run changeset publish --tag canary --no-git-tag');
  expect(version).toBeGreaterThan(0);
  expect(build).toBeGreaterThan(version);
  expect(install).toBeGreaterThan(build);
  expect(pdf).toBeGreaterThan(build);
  expect(gate).toBeGreaterThan(Math.max(install, pdf));
  expect(publish).toBe(gate + 1);
  // The gate is the last check before publishing, and only its clear answer publishes.
  expect(job.steps[gate].run).toBe('node scripts/release-mode.mjs');
  expect(job.steps[gate].env?.RELEASE_CHANNEL).toBe('canary-gate');
  expect(job.steps[publish].if).toBe("${{ steps.gate.outputs.clear == 'true' }}");
  expect(job.steps[publish].env).toEqual({ NPM_CONFIG_PROVENANCE: 'true' });
  for (const step of job.steps) {
    expect(step.uses ?? '').not.toContain('changesets/action');
    expect(step.run ?? '').not.toMatch(/git (?:tag|push)|gh (?:release|workflow run)/);
    expect(step['continue-on-error']).not.toBe(true);
    // Canaries never post to Slack.
    expect(JSON.stringify(step)).not.toMatch(/slack/i);
  }
  // A canary run never reaches the stable failure alert either.
  const alert = workflow.jobs['notify-failure'].if!;
  for (const run of [runs.schedule, runs.dispatchCanary])
    expect(evaluate(alert, { ...run, failure: () => true })).toBe(false);
  for (const run of [runs.push, runs.dispatchRelease])
    expect(evaluate(alert, { ...run, failure: () => true })).toBe(true);
  const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  expect(checkout?.with?.ref).toBe('${{ needs.mode.outputs.commit }}');
});

test('the canary commit comes from a green main CI run in this repository', () => {
  const step = raw.jobs.mode.steps.find(
    (entry) => entry.name === 'Find the newest main commit that passed CI'
  )!;
  expect(step.run).toContain('"$REPOSITORY" != "eigenpal/docx-editor"');
  expect(step.run).toContain('"$REF" != "refs/heads/main"');
  expect(step.run).toContain('--workflow ci.yml --branch main --event push');
  expect(step.run).toContain('--status success');
  expect(raw.jobs.mode.permissions).toEqual({ contents: 'read', actions: 'read' });
});

test('post-release skips scheduled canary runs', () => {
  const post = Bun.YAML.parse(
    readFileSync(new URL('../.github/workflows/post-release.yml', import.meta.url), 'utf8')
  ) as { jobs: { source: { if: string } } };
  const run = (event: string, repository = 'eigenpal/docx-editor') =>
    evaluate(post.jobs.source.if, {
      github: {
        repository: 'eigenpal/docx-editor',
        event: { workflow_run: { event, head_repository: { full_name: repository } } },
      },
    });
  expect(run('push')).toBe(true);
  expect(run('workflow_dispatch')).toBe(true);
  expect(run('schedule')).toBe(false);
  expect(run('push', 'fork/docx-editor')).toBe(false);
});
