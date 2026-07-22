import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const migrationDir = join(repoRoot, 'packages/core/spike/migration');

type InventoryDestination = {
  change: 'engine-core-spike' | 'document-engine';
  area: string;
};

type InventoryIntent = {
  kind: 'observable' | 'implementation-only';
  summary: string;
};

type PlaywrightTombstone = {
  source: string;
  status: 'behavior-tombstone' | 'implementation-only-tombstone';
  coupling: {
    category:
      | 'behavioral-migration-candidate'
      | 'legacy-ui-or-debug-coupled'
      | 'legacy-geometry'
      | 'legacy-visual'
      | 'legacy-header-footer'
      | 'legacy-performance';
    reason: string;
  };
  intent: InventoryIntent;
  destination: InventoryDestination;
  retainedFixtureRefs: string[];
};

type PlaywrightInventory = {
  version: string;
  description: string;
  crossAdapterLifecycleScenario: {
    id: string;
    source: string;
    adapters: string[];
    status: string;
    note: string;
    destination: InventoryDestination;
  };
  helpersRequiringMigration: string[];
  tombstones: PlaywrightTombstone[];
};

type PackageInventoryGroup = {
  status:
    | 'durable-behavior-tombstone'
    | 'implementation-only-tombstone'
    | 'engine-neutral-retained';
  coupling: {
    category:
      | 'legacy-adapter-binding'
      | 'legacy-headless-core-surface'
      | 'legacy-bridge-surface'
      | 'engine-neutral';
    reason: string;
  };
  intent: InventoryIntent;
  destination: InventoryDestination;
  retainedFixtureRefs: string[];
  sources: string[];
};

type PackageInventory = {
  version: string;
  description: string;
  legacyCoreCoupled: {
    durableBehavior: PackageInventoryGroup[];
    implementationOnly: PackageInventoryGroup[];
  };
  engineNeutralRetained: PackageInventoryGroup[];
};

function loadJson<T>(fileName: string): T {
  return JSON.parse(readFileSync(join(migrationDir, fileName), 'utf8')) as T;
}

function flattenSources(groups: Array<{ sources: string[] }>): string[] {
  return groups.flatMap((group) => group.sources);
}

const runtimeImportPatterns = [
  /\bimport\s+(?!type\b)(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bexport\s+(?!type\b)[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function runtimeImportSpecifiers(text: string): string[] {
  const source = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  const specifiers = new Set<string>();
  for (const pattern of runtimeImportPatterns) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

function resolveLocalRuntimeImport(importer: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = join(dirname(importer), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.vue`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
    join(base, 'index.js'),
    join(base, 'index.jsx'),
  ];
  return (
    candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null
  );
}

function localRuntimeImportClosure(source: string, maxModules = 128): string[] {
  const pending = [join(repoRoot, source)];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    expect(visited.size).toBeLessThanOrEqual(maxModules);
    const text = readFileSync(current, 'utf8');
    for (const specifier of runtimeImportSpecifiers(text)) {
      const resolved = resolveLocalRuntimeImport(current, specifier);
      if (specifier.startsWith('.')) expect(resolved).not.toBeNull();
      if (resolved && !visited.has(resolved)) pending.push(resolved);
    }
  }
  return [...visited];
}

function assertDestination(destination: InventoryDestination): void {
  expect(
    destination.change === 'engine-core-spike' || destination.change === 'document-engine'
  ).toBe(true);
  expect(destination.area).toMatch(/^[a-z0-9-]+(?:\/[a-z0-9-]+)+$/);
}

function assertFixtureRefsExist(refs: string[]): void {
  for (const ref of refs) {
    expect(ref).toMatch(/^[A-Za-z0-9_./-]+$/);
    expect(existsSync(join(repoRoot, ref))).toBe(true);
  }
}

describe('playwright migration inventory', () => {
  const inventory = loadJson<PlaywrightInventory>('playwright-inventory.v1.json');

  test('tombstones concrete e2e paths without overlap', () => {
    const paths = inventory.tombstones.map((tombstone) => tombstone.source);
    const unique = new Set(paths);
    expect(unique.size).toBe(paths.length);
    expect(paths).toHaveLength(152);
    expect(paths.every((p) => p.startsWith('e2e/'))).toBe(true);
  });

  test('frozen cross-adapter lifecycle scenario references vocabulary oracle', () => {
    expect(inventory.crossAdapterLifecycleScenario.id).toBe('lifecycle-bold-roundtrip-v1');
    expect(inventory.crossAdapterLifecycleScenario.status).toBe('frozen-not-wired');
    expect(inventory.crossAdapterLifecycleScenario.adapters).toEqual(['react', 'vue']);
    assertDestination(inventory.crossAdapterLifecycleScenario.destination);
  });

  test('every suite is a complete direct tombstone record', () => {
    for (const tombstone of inventory.tombstones) {
      expect(
        tombstone.status === 'behavior-tombstone' ||
          tombstone.status === 'implementation-only-tombstone'
      ).toBe(true);
      expect(tombstone.source).toMatch(/^e2e\/.+\.spec\.ts$/);
      expect(tombstone.coupling.reason.length).toBeGreaterThan(0);
      expect(tombstone.intent.summary.length).toBeGreaterThan(0);
      if (tombstone.status === 'implementation-only-tombstone') {
        expect(tombstone.intent.kind).toBe('implementation-only');
      } else {
        expect(tombstone.intent.kind).toBe('observable');
      }
      assertDestination(tombstone.destination);
      assertFixtureRefsExist(tombstone.retainedFixtureRefs);
    }
  });

  test('inventory no longer depends on legacy e2e sources remaining on disk', () => {
    const listed = new Set(inventory.tombstones.map((tombstone) => tombstone.source));
    expect(listed.has('e2e/tests/text-editing.spec.ts')).toBe(true);
    expect(listed.has('e2e/tests/visual-regression.spec.ts')).toBe(true);
    expect(listed.has('e2e/tests/hf-body-focus-handoff.spec.ts')).toBe(true);
    expect(listed.has('e2e/editor.spec.ts')).toBe(true);
    expect(listed.has('e2e/visual.spec.ts')).toBe(true);
  });

  test('per-suite records supersede redundant legacy classification structures', () => {
    expect('suites' in inventory).toBe(false);
    expect('tombstoneGroups' in inventory).toBe(false);
    expect('behavioralCandidateCoupling' in inventory).toBe(false);
    expect('classificationRules' in inventory).toBe(false);
  });

  test('no current suite is falsely classified as engine-neutral', () => {
    const candidateSources = inventory.tombstones
      .filter((tombstone) => tombstone.coupling.category === 'behavioral-migration-candidate')
      .map((tombstone) => tombstone.source);
    expect(candidateSources).toEqual([
      'e2e/tests/text-editing.spec.ts',
      'e2e/tests/formatting.spec.ts',
      'e2e/tests/formatting-persistence.spec.ts',
      'e2e/tests/scenario-driven.spec.ts',
      'e2e/tests/parity/smoke/type-characters.spec.ts',
      'e2e/tests/parity/smoke/toggle-bold.spec.ts',
      'e2e/tests/parity/smoke/save-roundtrip.spec.ts',
    ]);
  });
});

describe('package test migration inventory', () => {
  const inventory = loadJson<PackageInventory>('package-test-inventory.v1.json');
  const legacyGroups = [
    ...inventory.legacyCoreCoupled.durableBehavior,
    ...inventory.legacyCoreCoupled.implementationOnly,
  ];
  const allGroups = [...legacyGroups, ...inventory.engineNeutralRetained];

  test('covers every classified package test without overlap', () => {
    const legacyPaths = flattenSources(legacyGroups);
    const retainedPaths = flattenSources(inventory.engineNeutralRetained);
    const paths = [...legacyPaths, ...retainedPaths];
    const unique = new Set(paths);
    expect(unique.size).toBe(paths.length);
    expect(legacyPaths).toHaveLength(31);
    expect(retainedPaths).toHaveLength(10);
    expect(paths).toHaveLength(41);
    expect(paths.every((p) => p.startsWith('packages/'))).toBe(true);
    expect(retainedPaths.filter((p) => p.startsWith('packages/agents/'))).toEqual([
      'packages/agents/src/__tests__/mcp-protocol.test.ts',
    ]);
  });

  test('package inventory structure and semantics are valid', () => {
    for (const group of inventory.legacyCoreCoupled.durableBehavior) {
      expect(group.status).toBe('durable-behavior-tombstone');
      expect(group.intent.kind).toBe('observable');
      expect(
        group.coupling.category === 'legacy-adapter-binding' ||
          group.coupling.category === 'legacy-headless-core-surface' ||
          group.coupling.category === 'legacy-bridge-surface'
      ).toBe(true);
      assertDestination(group.destination);
      assertFixtureRefsExist(group.retainedFixtureRefs);
    }

    for (const group of inventory.legacyCoreCoupled.implementationOnly) {
      expect(group.status).toBe('implementation-only-tombstone');
      expect(group.intent.kind).toBe('implementation-only');
      assertDestination(group.destination);
      assertFixtureRefsExist(group.retainedFixtureRefs);
    }

    for (const group of inventory.engineNeutralRetained) {
      expect(group.status).toBe('engine-neutral-retained');
      expect(group.coupling.category).toBe('engine-neutral');
      expect(group.intent.kind).toBe('observable');
      assertDestination(group.destination);
      assertFixtureRefsExist(group.retainedFixtureRefs);
    }
  });

  test('engine-neutral retained runtime import closures avoid legacy coupling signals', () => {
    const legacyBareRuntimeImports = [/^@docx-editor\.dev\/core(?:\/|$)/, /^prosemirror-/];
    const legacyClosureSignals = [
      /docx-editor-(?:react|vue):painted-pages-ready/,
      /painter:painted/,
      /\bDocumentAgent\b/,
      /\bEditorBridge\b/,
      /\bPagedEditorRef\b/,
      /\bEditorView\b/,
      /\buseDocxEditor\b/,
      /\bgetEditorRef\b/,
      /\bDocxReviewer\b/,
    ];

    for (const source of flattenSources(inventory.engineNeutralRetained)) {
      for (const file of localRuntimeImportClosure(source)) {
        const text = readFileSync(file, 'utf8');
        for (const specifier of runtimeImportSpecifiers(text).filter(
          (value) => !value.startsWith('.')
        )) {
          for (const signal of legacyBareRuntimeImports) {
            expect(signal.test(specifier)).toBe(false);
          }
        }
        for (const signal of legacyClosureSignals) {
          expect(signal.test(text)).toBe(false);
        }
      }
    }
  });

  test('legacy sources are absent and retained sources remain on disk', () => {
    for (const source of flattenSources(legacyGroups)) {
      expect(existsSync(join(repoRoot, source))).toBe(false);
    }
    for (const source of flattenSources(inventory.engineNeutralRetained)) {
      expect(existsSync(join(repoRoot, source))).toBe(true);
    }
  });
});
