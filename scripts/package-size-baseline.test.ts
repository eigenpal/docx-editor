import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadBaseline, selectBaselineRun } from './package-size-baseline.mjs';

const options = { repository: 'eigenpal/docx-editor', branch: 'main', sha: 'a'.repeat(40) };
const source = {
  id: 10,
  head_sha: options.sha,
  head_branch: 'main',
  event: 'push',
  path: '.github/workflows/ci.yml',
  conclusion: 'success',
  status: 'completed',
  head_repository: { full_name: options.repository },
};
const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('selects the newest successful run for the exact base, regardless of response order', () => {
  const runs = [{ ...source, id: 50, head_sha: 'b'.repeat(40) }, source, { ...source, id: 11 }];
  expect(selectBaselineRun(runs, options)?.id).toBe(11);
});

test.each([
  { head_sha: 'b'.repeat(40) },
  { head_branch: 'other' },
  { event: 'pull_request' },
  { path: '.github/workflows/release.yml' },
  { conclusion: 'failure' },
  { status: 'in_progress' },
  { head_repository: { full_name: 'fork/docx-editor' } },
])('rejects a baseline with mismatched provenance: %j', (change) => {
  expect(selectBaselineRun([{ ...source, ...change }], options)).toBeUndefined();
});

test('downloads only the verified run and includes the base SHA in the API query', () => {
  const directory = mkdtempSync(join(tmpdir(), 'package-size-baseline-'));
  directories.push(directory);
  const calls: string[][] = [];
  downloadBaseline({ ...options, directory }, (args: string[]) => {
    calls.push(args);
    if (args.at(-1)?.includes('/runs?')) return JSON.stringify({ workflow_runs: [source] });
    if (args.at(-1)?.includes('/artifacts?'))
      return JSON.stringify({ artifacts: [{ name: 'package-sizes', expired: false }] });
    return '';
  });
  expect(calls[0].at(-1)).toContain(`head_sha=${options.sha}`);
  expect(calls[2]).toEqual([
    'run',
    'download',
    '10',
    '--repo',
    options.repository,
    '-n',
    'package-sizes',
    '-D',
    directory,
  ]);
});

test.each(['wrong-commit', 'expired-artifact'])(
  'never uses a stale file when the baseline is unavailable: %s',
  (reason) => {
    const directory = mkdtempSync(join(tmpdir(), 'package-size-baseline-'));
    directories.push(directory);
    const report = join(directory, 'package-sizes.json');
    writeFileSync(report, 'stale report');
    downloadBaseline({ ...options, directory }, (args: string[]) => {
      expect(args[0]).toBe('api');
      if (args.at(-1)?.includes('/runs?'))
        return JSON.stringify({
          workflow_runs: [
            { ...source, head_sha: reason === 'wrong-commit' ? 'b'.repeat(40) : options.sha },
          ],
        });
      return JSON.stringify({ artifacts: [{ name: 'package-sizes', expired: true }] });
    });
    expect(existsSync(report)).toBe(false);
  }
);

test('workflow pins baseline lookup to the triggering PR base', () => {
  const workflow = Bun.YAML.parse(
    readFileSync(join(import.meta.dir, '../.github/workflows/ci.yml'), 'utf8')
  ) as any;
  const step = workflow.jobs['package-size'].steps.find(
    (step: any) => step.run === 'node scripts/package-size-baseline.mjs'
  );
  expect(step.env.BASE_SHA).toBe('${{ github.event.pull_request.base.sha }}');
  expect(step.env.BASE_BRANCH).toBe('${{ github.event.pull_request.base.ref }}');
});
