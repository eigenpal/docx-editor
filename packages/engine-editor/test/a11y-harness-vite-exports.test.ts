// Vite a11y-harness workspace export regression and lifecycle safety (task 5.3).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  A11Y_HARNESS_LAYOUT_EXPORT_PROBE,
  A11Y_HARNESS_OPTIMIZED_THIRD_PARTY,
  A11Y_HARNESS_WORKSPACE_PACKAGES,
} from '../scripts/a11y-harness-vite-policy.ts';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const lifecycleUrl = pathToFileURL(join(packageRoot, 'scripts/a11y-harness-lifecycle.mjs')).href;

describe('a11y harness vite workspace exports (task 5.3)', () => {
  test('vite config excludes workspace packages from optimizeDeps prebundle', () => {
    const configText = readFileSync(join(packageRoot, 'vite.config.ts'), 'utf8');
    expect(configText).toContain('exclude: [...A11Y_HARNESS_WORKSPACE_PACKAGES]');
    expect(configText).toContain('include: [...A11Y_HARNESS_OPTIMIZED_THIRD_PARTY]');
    expect(configText).not.toMatch(/optimizeDeps:\s*\{[^}]*include:[^}]*@docx-editor\.dev/);
    expect(A11Y_HARNESS_OPTIMIZED_THIRD_PARTY).toContain('fast-xml-parser');
    expect(A11Y_HARNESS_WORKSPACE_PACKAGES.length).toBeGreaterThan(0);
  });

  test('stopSpawnedHarnessServer never kills when spawned=false', async () => {
    const { stopSpawnedHarnessServer } = await import(lifecycleUrl);
    let killCalled = false;
    const fakeChild = {
      kill: () => {
        killCalled = true;
      },
      exitCode: null,
      signalCode: null,
    };
    const result = await stopSpawnedHarnessServer({ spawned: false, child: fakeChild, pid: 4242 });
    expect(result.action).toBe('skipped');
    expect(result.reason).toBe('not-spawned');
    expect(killCalled).toBe(false);
  });

  test('spawned harness server stops only its own child process', async () => {
    const { stopSpawnedHarnessServer } = await import(lifecycleUrl);
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], {
      stdio: 'ignore',
      detached: process.platform !== 'win32',
    });
    const handle = { spawned: true, child, pid: child.pid ?? null };

    try {
      expect(child.exitCode).toBeNull();
      expect(child.signalCode).toBeNull();
    } finally {
      const stopResult = await stopSpawnedHarnessServer(handle);
      expect(stopResult.action).toBe('stopped');
      expect(handle.child.exitCode !== null || handle.child.signalCode !== null).toBe(true);
    }
  });

  test('verify-a11y-harness-vite-exports probes fresh and cached dev graphs', async () => {
    const proc = Bun.spawn(['bun', 'scripts/verify-a11y-harness-vite-exports.mjs'], {
      cwd: packageRoot,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, A11Y_HARNESS_STARTUP_MS: '60000' },
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(`vite export regression failed (${exitCode})\n${stdout}\n${stderr}`);
    }
    expect(stdout).toContain(A11Y_HARNESS_LAYOUT_EXPORT_PROBE);
    expect(stdout).toContain('"phases": [\n    "fresh",\n    "cached"\n  ]');
    expect(stdout).toContain('"ok": true');
  }, 180_000);
});
