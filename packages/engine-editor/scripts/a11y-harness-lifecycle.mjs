#!/usr/bin/env node
// Spawn/stop helpers for the a11y harness dev server (task 4.7 / 5.3).
// Never inspects or kills processes by port — only children created here.

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const DEFAULT_PORT = Number(process.env.A11Y_HARNESS_PORT ?? 5299);
const DEFAULT_RELEASE_WAIT_MS = Number(process.env.A11Y_HARNESS_RELEASE_MS ?? 10_000);

/** Typed task failure: exit only after spawned-harness teardown completes. */
export class HarnessTaskFailure extends Error {
  constructor(message, exitCode) {
    super(message);
    this.name = 'HarnessTaskFailure';
    this.exitCode = exitCode;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function harnessBaseUrl(port = DEFAULT_PORT) {
  return `http://127.0.0.1:${port}/`;
}

export async function waitForHarness(targetUrl, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(targetUrl, { redirect: 'follow' });
      if (response.ok) return;
    } catch {
      // retry until timeout
    }
    await sleep(200);
  }
  throw new Error(`harness server did not start: ${targetUrl}`);
}

/** Poll until the harness URL is unreachable (connection refused / fetch failure). Read-only. */
export async function waitForHarnessUnavailable(targetUrl, timeoutMs = DEFAULT_RELEASE_WAIT_MS) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(targetUrl, { redirect: 'follow' });
      if (!response.ok) return;
    } catch {
      return;
    }
    await sleep(50);
  }
  throw new Error(`harness server still reachable after stop: ${targetUrl}`);
}

function resolveHarnessBaseUrl(handle) {
  if (handle.baseUrl) return handle.baseUrl;
  if (handle.port !== undefined && handle.port !== null && handle.port !== 0) {
    return harnessBaseUrl(handle.port);
  }
  return null;
}

export function spawnHarnessDevServer({ cwd, port = DEFAULT_PORT }) {
  const viteCli = join(cwd, 'node_modules/vite/bin/vite.js');
  // `--strictPort` only when a SPECIFIC port was asked for. Port 0 means "any free port",
  // which strict mode would contradict; the ready URL is read back from vite's log either
  // way, so an ephemeral port costs nothing and cannot collide.
  const portArgs =
    port === 0 ? ['--port', '0'] : ['--port', String(port), '--strictPort'];
  const child = spawn(process.execPath, [viteCli, ...portArgs, '--host', '127.0.0.1'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, A11Y_HARNESS_PORT: String(port) },
    detached: process.platform !== 'win32',
  });

  const ready = waitForHarnessReadyFromLogs(child, port === 0 ? undefined : harnessBaseUrl(port));

  return {
    spawned: true,
    child,
    pid: child.pid ?? null,
    port,
    baseUrl: port === 0 ? null : harnessBaseUrl(port),
    ready,
  };
}

function waitForHarnessReadyFromLogs(child, fallbackUrl) {
  return new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => {
      cleanup();
      if (fallbackUrl) {
        resolve(fallbackUrl);
        return;
      }
      reject(new Error('harness server did not log a ready URL'));
    }, 60_000);

    const onData = (chunk) => {
      log += chunk.toString();
      const match = log.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+\/)/);
      if (!match) return;
      cleanup();
      resolve(match[1]);
    };

    const onExit = (code) => {
      cleanup();
      // Include what the child actually printed. Without it this failure read only as
      // "exited before ready (signal)", which is true of every startup failure and points
      // at nothing — the real cause here was an orphaned harness server from an earlier
      // crashed run still holding the port, and vite had said exactly that on stderr.
      const output = log.trim();
      reject(
        new Error(
          `harness child exited before ready (${code ?? 'signal'})` +
            (output ? `\n${output}` : '\n(child produced no output)')
        )
      );
    };

    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      child.stderr?.off('data', onData);
      child.off('exit', onExit);
    };

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', onExit);
  });
}

async function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('spawned harness child did not exit')), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(undefined);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function stopSpawnedHarnessServer(handle, deps = {}) {
  if (!handle?.spawned) {
    return { action: 'skipped', reason: 'not-spawned' };
  }
  const child = handle.child;
  if (!child) {
    return { action: 'skipped', reason: 'missing-child' };
  }

  const waitUnavailable = deps.waitForUnavailable ?? waitForHarnessUnavailable;
  const releaseTimeoutMs = deps.releaseTimeoutMs ?? DEFAULT_RELEASE_WAIT_MS;
  const baseUrl = resolveHarnessBaseUrl(handle);

  if (child.exitCode !== null || child.signalCode !== null) {
    if (baseUrl) {
      await waitUnavailable(baseUrl, releaseTimeoutMs);
    }
    return { action: 'already-stopped', pid: handle.pid, exitCode: child.exitCode, signalCode: child.signalCode };
  }

  if (process.platform !== 'win32' && handle.pid) {
    try {
      process.kill(-handle.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  } else {
    child.kill('SIGTERM');
  }

  try {
    await waitForChildExit(child, 5_000);
  } catch {
    if (process.platform !== 'win32' && handle.pid) {
      try {
        process.kill(-handle.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    } else {
      child.kill('SIGKILL');
    }
    await waitForChildExit(child, 2_000).catch(() => undefined);
  }

  if (baseUrl) {
    await waitUnavailable(baseUrl, releaseTimeoutMs);
  }

  return {
    action: 'stopped',
    pid: handle.pid,
    exitCode: child.exitCode,
    signalCode: child.signalCode,
  };
}

/**
 * Signal handlers for an in-flight spawned harness child only.
 * Never touches pre-existing servers (getHandle() null or spawned=false).
 * On Windows, child-only SIGTERM applies (no detached process-group kill).
 */
export function createSpawnedHarnessSignalHandlers(getHandle, deps = {}) {
  const stop = deps.stop ?? stopSpawnedHarnessServer;
  const exit = deps.exit ?? ((code) => process.exit(code));
  let installed = false;
  let handlingSignal = false;
  /** @type {(() => void) | undefined} */
  let onSigint;
  /** @type {(() => void) | undefined} */
  let onSigterm;

  const handleSignal = async (signal) => {
    if (!installed || handlingSignal) return;
    handlingSignal = true;
    installed = false;

    const serverHandle = getHandle();
    if (serverHandle?.spawned) {
      await stop(serverHandle);
    }
    exit(signal === 'SIGINT' ? 130 : 143);
  };

  return {
    install() {
      if (installed) return;
      onSigint = () => {
        void handleSignal('SIGINT');
      };
      onSigterm = () => {
        void handleSignal('SIGTERM');
      };
      process.on('SIGINT', onSigint);
      process.on('SIGTERM', onSigterm);
      installed = true;
    },
    remove() {
      if (!installed) return;
      if (onSigint) process.removeListener('SIGINT', onSigint);
      if (onSigterm) process.removeListener('SIGTERM', onSigterm);
      installed = false;
    },
    handleSignal,
  };
}

export async function runWithOptionalSpawnedHarness(
  {
    url,
    cwd,
    port = DEFAULT_PORT,
    probeTimeoutMs = 2_000,
    startupTimeoutMs = 60_000,
    spawnHarness = spawnHarnessDevServer,
    waitFor = waitForHarness,
    stop = stopSpawnedHarnessServer,
    onSpawnedLog,
  },
  task,
) {
  let serverHandle = null;
  const signals = createSpawnedHarnessSignalHandlers(() => serverHandle, { stop });

  try {
    try {
      await waitFor(url, probeTimeoutMs);
    } catch {
      serverHandle = spawnHarness({ cwd, port });
      if (onSpawnedLog && serverHandle.child) {
        serverHandle.child.stdout?.on('data', (chunk) => onSpawnedLog(chunk.toString()));
        serverHandle.child.stderr?.on('data', (chunk) => onSpawnedLog(chunk.toString()));
      }
      signals.install();
      await waitFor(url, startupTimeoutMs);
    }

    return await task();
  } finally {
    signals.remove();
    if (serverHandle) {
      await stop(serverHandle);
    }
  }
}

export async function probeHarnessSemanticIndexTransform({
  baseUrl,
  packageRoot,
  probe,
  layoutPackageRoot,
}) {
  // The editor lane moved to `packages/core/src/editor` (task 10.3); only the browser
  // harness still lives under this package. Prefer the lane, fall back to the old location
  // so the probe keeps working either side of the move.
  const laneSemanticIndex = join(packageRoot, '../core/src/editor/semantic-index.ts');
  const semanticIndexPath = existsSync(laneSemanticIndex)
    ? laneSemanticIndex
    : join(packageRoot, 'src/semantic-index.ts');
  const semanticIndexUrl = `${baseUrl}@fs/${semanticIndexPath}`;
  const semanticResponse = await fetch(semanticIndexUrl);
  if (!semanticResponse.ok) {
    throw new Error(`semantic-index transform failed (${semanticResponse.status}): ${await semanticResponse.text()}`);
  }
  const semanticBody = await semanticResponse.text();
  if (!semanticBody.includes(probe)) {
    throw new Error(`semantic-index transform missing ${probe}`);
  }
  if (semanticBody.includes('node_modules/.vite/deps/@docx-editor__dev_engine-layout')) {
    throw new Error('semantic-index imports stale prebundled engine-layout');
  }
  if (!semanticBody.includes('@docx-editor.dev/engine-layout')) {
    throw new Error('semantic-index does not import workspace engine-layout source');
  }

  const layoutRoot =
    layoutPackageRoot ?? join(packageRoot, 'node_modules/@docx-editor.dev/engine-layout');
  const layoutIndexUrl = `${baseUrl}@fs/${join(layoutRoot, 'src/index.ts')}`;
  const layoutResponse = await fetch(layoutIndexUrl);
  if (!layoutResponse.ok) {
    throw new Error(`engine-layout transform failed (${layoutResponse.status}): ${await layoutResponse.text()}`);
  }
  const layoutBody = await layoutResponse.text();
  // Task 10.3 moved the layout lane into the core package, leaving `engine-layout` as a
  // pure re-export alias. So the symbol is no longer IN this module; what this module must
  // prove is that the alias resolves to workspace source rather than a prebundled copy.
  // The symbol itself is then checked where it now lives.
  // Vite rewrites bare specifiers to resolved paths, so match the lane's location rather
  // than the specifier the source was written with.
  const aliased =
    layoutBody.includes('@docx-editor.dev/core-contract/layout') ||
    layoutBody.includes('core/src/layout');
  if (!aliased && !layoutBody.includes(probe)) {
    throw new Error(`engine-layout transform missing export ${probe}`);
  }
  if (aliased) {
    // The node_modules entries are symlinks named by PACKAGE, and the core package's name
    // is `core-contract` even though its directory is `core`.
    const laneUrl = `${baseUrl}@fs/${join(layoutRoot, '../core-contract/src/layout/index.ts')}`;
    const laneResponse = await fetch(laneUrl);
    if (!laneResponse.ok) {
      throw new Error(`layout lane transform failed (${laneResponse.status}): ${await laneResponse.text()}`);
    }
    if (!(await laneResponse.text()).includes(probe)) {
      throw new Error(`layout lane transform missing export ${probe}`);
    }
  }
  if (layoutBody.includes('node_modules/.vite/deps/@docx-editor__dev_engine-layout')) {
    throw new Error('engine-layout imports stale prebundled self-reference');
  }

  return { semanticIndexUrl, layoutIndexUrl, probe };
}

export async function assertNoWorkspaceLayoutPrebundle(depsDir, pathExists, readdir) {
  if (!(await pathExists(depsDir))) return;
  const deps = await readdir(depsDir);
  const staleLayoutDep = deps.find((name) => name.startsWith('@docx-editor__dev_engine-layout'));
  if (staleLayoutDep) {
    throw new Error(`workspace engine-layout was prebundled: ${staleLayoutDep}`);
  }
}
