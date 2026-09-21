import { afterEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workflow = Bun.YAML.parse(
  readFileSync(
    new URL('../.github/workflows/dependabot-slack-reminders.yml', import.meta.url),
    'utf8'
  )
) as {
  jobs: { remind: { steps: { name: string; run?: string; env?: Record<string, string> }[] } };
};
const steps = workflow.jobs.remind.steps;
const payloadStep = steps.find(
  (step) => step.name === 'Fetch open alerts and build the Slack payload'
)!;
const directories: string[] = [];

test('Dependabot summaries and failure notices use the dedicated Slack destination', () => {
  for (const name of ['Post to Slack', 'Notify Slack — reminder failed']) {
    const step = steps.find((candidate) => candidate.name === name)!;
    expect(step.env?.SLACK_WEBHOOK_URL).toBe('${{ secrets.DOCX_EDITOR_SLACK_WEBHOOK_URL }}');
  }
});

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function buildPayload(mode: 'daily' | 'weekly', alerts: unknown[]) {
  const directory = mkdtempSync(join(tmpdir(), 'docx-dependabot-payload-'));
  directories.push(directory);
  const fixture = join(directory, 'fixture.json');
  const output = join(directory, 'output');
  writeFileSync(fixture, JSON.stringify(alerts));
  // Run the actual workflow shell and jq program without GitHub or Slack requests.
  writeFileSync(join(directory, 'gh'), '#!/bin/sh\ncat "$ALERT_FIXTURE"\n', { mode: 0o755 });
  const stdout = execFileSync('bash', ['-c', payloadStep.run!], {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      ALERT_FIXTURE: fixture,
      GITHUB_OUTPUT: output,
      MODE: mode,
      REPO: 'eigenpal/docx-editor',
    },
  });
  const payloadPath = join(directory, 'slack-payload.json');
  return {
    stdout,
    output: readFileSync(output, 'utf8'),
    payload: existsSync(payloadPath) ? JSON.parse(readFileSync(payloadPath, 'utf8')) : null,
  };
}

function alert(severity: string, name = 'example-package') {
  return {
    security_vulnerability: { severity },
    dependency: { package: { name }, manifest_path: 'package.json' },
    security_advisory: { ghsa_id: 'GHSA-example', summary: 'Example advisory' },
    html_url: 'https://github.com/eigenpal/docx-editor/security/dependabot/1',
  };
}

test('weekly digest posts a heartbeat when there are no open alerts', () => {
  const { payload, output } = buildPayload('weekly', []);
  expect(output).toContain('should_post=true');
  expect(payload.text).toContain('0 open alert(s)');
  expect(payload.blocks[2].text.text).toContain('Nothing open');
  expect(payload.blocks.at(-1).elements[0].text).toContain('Full list on GitHub');
});

test('daily digest stays silent when no alert is high or critical', () => {
  const { payload, output } = buildPayload('daily', [alert('low'), alert('medium')]);
  expect(output).toContain('should_post=false');
  expect(payload).toBeNull();
});

test('daily digest includes high and critical alerts without logging their contents', () => {
  const { payload, output, stdout } = buildPayload('daily', [
    alert('low', 'low-package'),
    alert('high', 'high-package'),
    alert('critical', 'critical-package'),
  ]);
  expect(output).toContain('should_post=true');
  expect(payload.text).toContain('2 open high/critical');
  const text = JSON.stringify(payload);
  expect(text).toContain('high-package');
  expect(text).toContain('critical-package');
  expect(text).not.toContain('low-package');
  expect(stdout).not.toContain('package');
  expect(stdout).not.toContain('Example advisory');
});

test('weekly digest bounds blocks and escapes advisory text', () => {
  const alerts = Array.from({ length: 25 }, () => ({
    ...alert('high', '<unsafe>&`package'),
    security_advisory: { summary: '<unsafe>&`'.repeat(100) },
  }));
  const { payload } = buildPayload('weekly', alerts);
  const text = JSON.stringify(payload);
  expect(text).toContain('&lt;unsafe&gt;&amp;');
  expect(text).not.toContain('<unsafe>');
  expect(text).toContain('5 more');
  for (const block of payload.blocks) {
    if (block.type === 'section') expect(block.text.text.length).toBeLessThanOrEqual(3000);
    if (block.type === 'header') expect(block.text.text.length).toBeLessThanOrEqual(150);
  }
});

test('weekly digest tolerates missing and malformed advisory fields', () => {
  const { payload } = buildPayload('weekly', [
    null,
    {},
    { dependency: { package: { name: {} } }, security_vulnerability: 'invalid' },
  ]);
  expect(payload.text).toContain('3 open alert(s)');
  expect(JSON.stringify(payload)).toContain('3 other');
});
