#!/usr/bin/env node
// Bounded Lighthouse accessibility gate with harness server lifecycle (task 4.7).

import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(packageRoot, 'test-results/lighthouse');
const jsonPath = join(outDir, 'a11y-harness-lighthouse.json');
const port = Number(process.env.A11Y_HARNESS_PORT ?? 5299);
const url = process.env.A11Y_HARNESS_URL ?? `http://127.0.0.1:${port}/`;
const startupTimeoutMs = Number(process.env.A11Y_HARNESS_STARTUP_MS ?? 60_000);

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...options });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function waitForHarness(targetUrl, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(targetUrl, { redirect: 'follow' });
      if (response.ok) return;
    } catch {
      // retry until timeout
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`harness server did not start: ${targetUrl}`);
}

async function main() {
  await mkdir(outDir, { recursive: true });

  let server = null;
  let spawned = false;
  try {
    await waitForHarness(url, 2_000);
  } catch {
    spawned = true;
    server = spawn('bun', ['run', 'dev:a11y-harness'], {
      cwd: packageRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, A11Y_HARNESS_PORT: String(port) },
    });

    let serverLog = '';
    server.stdout?.on('data', (chunk) => {
      serverLog += chunk.toString();
    });
    server.stderr?.on('data', (chunk) => {
      serverLog += chunk.toString();
    });

    try {
      await waitForHarness(url, startupTimeoutMs);
    } catch (error) {
      console.error(serverLog);
      throw error;
    }
  }

  const stopServer = () => {
    if (spawned && server && !server.killed) server.kill('SIGTERM');
  };
  process.on('exit', stopServer);
  process.on('SIGINT', () => {
    stopServer();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    stopServer();
    process.exit(143);
  });

  try {
    const lighthouseCode = await run('bunx', [
      'lighthouse',
      url,
      '--quiet',
      '--chrome-flags=--headless=new',
      '--only-categories=accessibility',
      '--output=json',
      `--output-path=${jsonPath}`,
    ]);
    if (lighthouseCode !== 0) {
      console.error(`lighthouse exited with code ${lighthouseCode}`);
      process.exit(lighthouseCode);
    }

    const report = JSON.parse(await readFile(jsonPath, 'utf8'));
    const gateModule = await import(pathToFileURL(join(packageRoot, 'scripts/lighthouse-a11y-gate.ts')).href);
    const summary = gateModule.evaluateLighthouseGate(report, url);
    await writeFile(join(outDir, 'a11y-harness-lighthouse-summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));

    const exitCode = gateModule.lighthouseGateExitCode(summary);
    if (exitCode !== 0) {
      console.error('lighthouse accessibility gate failed');
      process.exit(exitCode);
    }
  } finally {
    stopServer();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
