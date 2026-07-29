// Milestone gate for spike disposability (document-engine task 1.6; enforces
// ADR-S9). The spike is reproducible evidence, never a source of shipping code:
//   - no production engine package imports packages/core/spike/**;
//   - the spike does not import any production engine package (independence);
//   - the declaration-only core package excludes spike from its exports/project;
//   - the spike-to-production decision record is Accepted.

import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGE_RULES } from './package-graph.ts';
import { PACKAGES_ROOT } from './lane-paths.ts';

const PACKAGES_DIR = PACKAGES_ROOT;
const REPO = join(PACKAGES_DIR, '..');
const SPIKE_DIR = join(PACKAGES_DIR, 'core', 'spike');

function collectSources(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(root, entry);
    if (statSync(full).isDirectory()) out.push(...collectSources(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\bimport\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bexport\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) specs.push(m[1]);
  }
  return specs;
}

const ENGINE_NAMES = PACKAGE_RULES.map((r) => r.name);
const spikeRe = /(^|\/)spike(\/|$)|packages\/core\/spike/;

describe('spike disposability milestone gate (task 1.6)', () => {
  test('no production engine package imports spike modules', () => {
    for (const rule of PACKAGE_RULES) {
      for (const file of collectSources(join(PACKAGES_DIR, rule.dir, 'src'))) {
        for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
          expect(spikeRe.test(spec)).toBe(false);
        }
      }
    }
  });

  test('spike does not import any production engine package (independence)', () => {
    for (const file of collectSources(join(SPIKE_DIR, 'src')).concat(
      collectSources(join(SPIKE_DIR, 'tests')),
    )) {
      for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
        const root = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec;
        expect(ENGINE_NAMES.includes(root)).toBe(false);
      }
    }
  });

  test('declaration-only core package excludes spike from exports and project', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGES_DIR, 'core', 'package.json'), 'utf8'));
    const exportPaths = JSON.stringify(pkg.exports ?? {});
    expect(/spike/.test(exportPaths)).toBe(false);

    const tsconfig = JSON.parse(readFileSync(join(PACKAGES_DIR, 'core', 'tsconfig.json'), 'utf8'));
    const include: string[] = tsconfig.include ?? [];
    expect(include.some((i) => /spike/.test(i))).toBe(false);
  });

  // REPLACES an assertion that `openspec/changes/document-engine/spike-architecture-decision.md`
  // was still marked Accepted. That change was removed as superseded by this proposal's own
  // task 1.1, so the guard read a deleted file and had been failing ever since — it was one of
  // the recorded baseline failures, and it could never pass again as written.
  //
  // The invariant it existed to protect is that the spike is disposable evidence authorised by
  // a live decision, not by a document nobody maintains. That authority is now the single
  // active change, so the guard checks THAT: a second active change, or a rename of this one,
  // means the spike's disposability is no longer covered by anything and must be re-decided.
  test('spike disposability is covered by exactly one active change', () => {
    const changesDir = join(REPO, 'openspec', 'changes');
    const active = readdirSync(changesDir).filter(
      (entry) => entry !== 'archive' && statSync(join(changesDir, entry)).isDirectory(),
    );
    expect(active).toEqual(['typed-ooxml-paragraph-editor']);
  });
});
