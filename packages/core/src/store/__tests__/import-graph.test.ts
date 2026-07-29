// Import-graph + package-authority enforcement for the production engine
// packages (document-engine task 1.4; strengthens the ADR-S9 no-spike rule that
// task 1.6 owns). Proves, mechanically, that:
//   - the semantic core is PM-free, DOM-free, Yjs-free, transport-neutral, PDF-free;
//   - every package only imports siblings allowed by the DAG (no sideways/upward edges);
//   - no production module imports packages/core/spike/**.
//
// The test scans real source, so a future violating import fails CI, not review.

import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PACKAGE_RULES,
  ALL_ENGINE_NAMES,
  SPIKE_IMPORT,
  type PackageRule,
} from './package-graph.ts';
import { PACKAGES_ROOT } from './lane-paths.ts';

const PACKAGES_DIR = PACKAGES_ROOT;

function packageDir(rule: PackageRule): string {
  return join(PACKAGES_DIR, rule.dir);
}

/** Recursively collect .ts/.tsx source files, skipping node_modules and test dirs. */
function collectSources(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'test') continue;
    const full = join(root, entry);
    if (statSync(full).isDirectory()) out.push(...collectSources(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Extract every static/dynamic import + re-export specifier from a source file. */
function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\bimport\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g, // import x from 'y'
    /\bimport\s*['"]([^'"]+)['"]/g, // import 'y'
    /\bexport\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g, // export ... from 'y'
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // import('y')
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // require('y') (should never appear; ESM-only)
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) specs.push(m[1]);
  }
  return specs;
}

/** Normalize a specifier to its package root (drops subpath for @scope/name/sub). */
function packageRoot(spec: string): string {
  if (spec.startsWith('.')) return spec; // relative — not a package
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const rulesByName = new Map(PACKAGE_RULES.map((r) => [r.name, r]));

describe('production engine package topology (task 1.4)', () => {
  test('every declared package exists with a conformant manifest', () => {
    for (const rule of PACKAGE_RULES) {
      const pkgPath = join(packageDir(rule), 'package.json');
      expect(existsSync(pkgPath)).toBe(true);
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      expect(pkg.name).toBe(rule.name);
      expect(pkg.type).toBe('module');
      expect(pkg.scripts?.typecheck).toBeTruthy();
    }
  });

  test('package.json internal deps stay within the allowed DAG', () => {
    for (const rule of PACKAGE_RULES) {
      const pkg = JSON.parse(readFileSync(join(packageDir(rule), 'package.json'), 'utf8'));
      const deps = Object.keys(pkg.dependencies ?? {});
      const internal = deps.filter((d) => ALL_ENGINE_NAMES.includes(d));
      for (const d of internal) {
        expect(rule.internalDeps).toContain(d);
      }
    }
  });

  test('engine-core package.json declares no forbidden runtime dependency', () => {
    const core = rulesByName.get('@docx-editor.dev/engine-core')!;
    const pkg = JSON.parse(readFileSync(join(packageDir(core), 'package.json'), 'utf8'));
    const runtimeDeps = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ];
    const forbidden = core.forbidden.map((f) => new RegExp(f));
    for (const dep of runtimeDeps) {
      for (const re of forbidden) {
        expect(re.test(dep)).toBe(false);
      }
    }
  });

  test('engine-core is DOM-free structurally (tsconfig omits the DOM lib)', () => {
    const core = rulesByName.get('@docx-editor.dev/engine-core')!;
    const tsconfig = JSON.parse(readFileSync(join(packageDir(core), 'tsconfig.json'), 'utf8'));
    const lib: string[] = tsconfig.compilerOptions?.lib ?? [];
    expect(lib.some((l) => /dom/i.test(l))).toBe(false);
  });

  test('tsconfig DOM lib inclusion matches the declared policy', () => {
    for (const rule of PACKAGE_RULES) {
      const tsconfig = JSON.parse(readFileSync(join(packageDir(rule), 'tsconfig.json'), 'utf8'));
      const lib: string[] = tsconfig.compilerOptions?.lib ?? [];
      const hasDom = lib.some((l) => /dom/i.test(l));
      expect(hasDom).toBe(rule.domAllowed);
    }
  });

  test('source imports respect forbidden patterns and the DAG', () => {
    for (const rule of PACKAGE_RULES) {
      const forbidden = rule.forbidden.map((f) => new RegExp(f));
      for (const file of collectSources(join(packageDir(rule), 'src'))) {
        const source = readFileSync(file, 'utf8');
        for (const spec of importSpecifiers(source)) {
          const root = packageRoot(spec);
          for (const re of forbidden) {
            if (re.test(root)) {
              throw new Error(`${rule.name}: forbidden import "${spec}" in ${file}`);
            }
          }
          // Sibling engine import must be an allowed DAG edge.
          if (ALL_ENGINE_NAMES.includes(root) && root !== rule.name) {
            if (!rule.internalDeps.includes(root)) {
              throw new Error(`${rule.name}: illegal layering import "${spec}" in ${file}`);
            }
          }
        }
      }
    }
  });

  test('no production module imports disposable spike code (ADR-S9)', () => {
    const spikeRe = new RegExp(SPIKE_IMPORT);
    for (const rule of PACKAGE_RULES) {
      for (const file of collectSources(join(packageDir(rule), 'src'))) {
        const source = readFileSync(file, 'utf8');
        for (const spec of importSpecifiers(source)) {
          expect(spikeRe.test(spec)).toBe(false);
        }
      }
    }
  });
});
