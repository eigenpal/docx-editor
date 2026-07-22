import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import inventory from '../migration/playwright-inventory.v1.json';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function allInventoryPaths(): string[] {
  return Object.values(inventory.suites).flat();
}

describe('playwright migration inventory', () => {
  test('classifies concrete e2e paths without overlap', () => {
    const paths = allInventoryPaths();
    const unique = new Set(paths);
    expect(unique.size).toBe(paths.length);
    expect(paths.every((p) => p.startsWith('e2e/'))).toBe(true);
  });

  test('frozen cross-adapter lifecycle scenario references vocabulary oracle', () => {
    expect(inventory.crossAdapterLifecycleScenario.id).toBe('lifecycle-bold-roundtrip-v1');
    expect(inventory.crossAdapterLifecycleScenario.status).toBe('frozen-not-wired');
    expect(inventory.crossAdapterLifecycleScenario.adapters).toEqual(['react', 'vue']);
  });

  test('inventory covers listed spec files on disk', () => {
    const listed = new Set(allInventoryPaths());
    const onDisk: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.spec.ts')) onDisk.push(full.replace(/\\/g, '/'));
      }
    };
    walk(join(repoRoot, 'e2e/tests'));
    const relative = onDisk.map((p) => p.slice(p.indexOf('e2e/')));
    const missing = relative.filter((p) => !listed.has(p));
    expect(missing).toEqual([]);
    expect(listed.size).toBeGreaterThan(140);
  });

  test('no current suite is falsely classified as engine-neutral', () => {
    expect(inventory.suites['engine-neutral-now']).toEqual([]);
    expect(inventory.suites['behavioral-migration-candidate']).toEqual([
      'e2e/tests/text-editing.spec.ts',
      'e2e/tests/formatting.spec.ts',
      'e2e/tests/formatting-persistence.spec.ts',
      'e2e/tests/scenario-driven.spec.ts',
      'e2e/tests/parity/smoke/type-characters.spec.ts',
      'e2e/tests/parity/smoke/toggle-bold.spec.ts',
      'e2e/tests/parity/smoke/save-roundtrip.spec.ts',
    ]);
    expect(inventory.suites['legacy-ui-or-debug-coupled']).not.toContain(
      'e2e/tests/text-editing.spec.ts'
    );
    expect(Object.keys(inventory.behavioralCandidateCoupling).sort()).toEqual(
      [...inventory.suites['behavioral-migration-candidate']].sort()
    );
  });
});
