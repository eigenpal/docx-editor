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
function condition(expression: string, needs: unknown, cancelled = false): boolean {
  const source = expression.replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '');
  return new Function('needs', 'cancelled', `return Boolean(${source});`)(needs, () => cancelled);
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
