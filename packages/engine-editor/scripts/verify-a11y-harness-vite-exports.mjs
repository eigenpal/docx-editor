#!/usr/bin/env node
// Regression: a11y harness Vite graph loads current workspace exports (task 5.3).

import { spawn } from 'node:child_process';
import { access, readdir, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertNoWorkspaceLayoutPrebundle,
  probeHarnessSemanticIndexTransform,
  spawnHarnessDevServer,
  stopSpawnedHarnessServer,
  waitForHarness,
} from './a11y-harness-lifecycle.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(packageRoot, 'node_modules/.vite');
const depsDir = join(cacheDir, 'deps');
const port = Number(process.env.A11Y_HARNESS_PORT ?? 5299);
const startupTimeoutMs = Number(process.env.A11Y_HARNESS_STARTUP_MS ?? 60_000);

async function loadPolicy() {
  const mod = await import(pathToFileURL(join(packageRoot, 'scripts/a11y-harness-vite-policy.ts')).href);
  return mod;
}

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...options });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function probeDevGraph({ policy, clearCache, phase }) {
  if (clearCache) {
    await rm(cacheDir, { recursive: true, force: true });
  }

  const serverHandle = spawnHarnessDevServer({ cwd: packageRoot, port });
  let serverLog = '';
  serverHandle.child.stdout?.on('data', (chunk) => {
    serverLog += chunk.toString();
  });
  serverHandle.child.stderr?.on('data', (chunk) => {
    serverLog += chunk.toString();
  });

  try {
    const baseUrl = serverHandle.baseUrl ?? (await serverHandle.ready);
    await waitForHarness(baseUrl, startupTimeoutMs);
    const probe = await probeHarnessSemanticIndexTransform({
      baseUrl,
      packageRoot,
      probe: policy.A11Y_HARNESS_LAYOUT_EXPORT_PROBE,
    });
    await assertNoWorkspaceLayoutPrebundle(depsDir, pathExists, readdir);
    return { phase, clearCache, probe };
  } catch (error) {
    console.error(serverLog);
    throw error;
  } finally {
    await stopSpawnedHarnessServer(serverHandle);
  }
}

async function assertProductionBuild() {
  const code = await run('bunx', ['vite', 'build'], { cwd: packageRoot });
  if (code !== 0) {
    throw new Error(`vite build failed with exit code ${code}`);
  }
}

async function main() {
  const policy = await loadPolicy();
  const fresh = await probeDevGraph({ policy, clearCache: true, phase: 'fresh' });
  const cached = await probeDevGraph({ policy, clearCache: false, phase: 'cached' });
  await assertProductionBuild();
  console.log(
    JSON.stringify(
      {
        ok: true,
        probe: policy.A11Y_HARNESS_LAYOUT_EXPORT_PROBE,
        workspacePackagesExcluded: policy.A11Y_HARNESS_WORKSPACE_PACKAGES.length,
        phases: [fresh.phase, cached.phase],
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
