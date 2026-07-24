#!/usr/bin/env node
// Bounded Lighthouse accessibility gate with harness server lifecycle (task 4.7).

import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  HarnessTaskFailure,
  harnessBaseUrl,
  runWithOptionalSpawnedHarness,
} from './a11y-harness-lifecycle.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(packageRoot, 'test-results/lighthouse');
const jsonPath = join(outDir, 'a11y-harness-lighthouse.json');
const port = Number(process.env.A11Y_HARNESS_PORT ?? 5299);
const url = process.env.A11Y_HARNESS_URL ?? harnessBaseUrl(port);
const startupTimeoutMs = Number(process.env.A11Y_HARNESS_STARTUP_MS ?? 60_000);

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...options });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function main() {
  await mkdir(outDir, { recursive: true });

  let serverLog = '';

  try {
    await runWithOptionalSpawnedHarness(
      {
        url,
        cwd: packageRoot,
        port,
        startupTimeoutMs,
        onSpawnedLog: (chunk) => {
          serverLog += chunk;
        },
      },
      async () => {
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
          throw new HarnessTaskFailure(`lighthouse exited with code ${lighthouseCode}`, lighthouseCode);
        }

        const report = JSON.parse(await readFile(jsonPath, 'utf8'));
        const gateModule = await import(pathToFileURL(join(packageRoot, 'scripts/lighthouse-a11y-gate.ts')).href);
        const summary = gateModule.evaluateLighthouseGate(report, url);
        await writeFile(join(outDir, 'a11y-harness-lighthouse-summary.json'), JSON.stringify(summary, null, 2));
        console.log(JSON.stringify(summary, null, 2));

        const gateExitCode = gateModule.lighthouseGateExitCode(summary);
        if (gateExitCode !== 0) {
          throw new HarnessTaskFailure('lighthouse accessibility gate failed', gateExitCode);
        }
      },
    );
  } catch (error) {
    if (serverLog) console.error(serverLog);
    if (error instanceof HarnessTaskFailure) {
      console.error(error.message);
      process.exitCode = error.exitCode;
      return;
    }
    throw error;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
