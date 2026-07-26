// Every block registry: public entry points reject duplicate ownership, built-in variants
// may replace, and the built-in variants are not reachable from the package index.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  registerBlockLayout,
  registerBlockDependencies,
  registerBlockSemanticRole,
  registerBuiltInBlockLayout,
  registerBuiltInBlockDependencies,
  registerBuiltInBlockSemanticRole,
} from '../src/block-layout.ts';

const SOURCE = readFileSync(
  fileURLToPath(new URL('../src/block-layout.ts', import.meta.url)),
  'utf8'
);
const INDEX = readFileSync(fileURLToPath(new URL('../src/index.ts', import.meta.url)), 'utf8');

const suffix = String(process.pid);

describe('public registrars reject duplicate ownership, unconditionally', () => {
  test('a second layout handler for the same kind throws', () => {
    const kind = `pub-layout-${suffix}`;
    registerBlockLayout(kind, () => {});
    expect(() => registerBlockLayout(kind, () => {})).toThrow(/duplicate block layout handler/);
  });

  test('a second dependency declaration for the same kind throws', () => {
    const kind = `pub-dep-${suffix}`;
    registerBlockDependencies(kind, () => []);
    expect(() => registerBlockDependencies(kind, () => [])).toThrow(/duplicate block dependency/);
  });

  test('a second semantic role for the same kind throws', () => {
    const kind = `pub-role-${suffix}`;
    registerBlockSemanticRole(kind, 'paragraph');
    expect(() => registerBlockSemanticRole(kind, 'paragraph')).toThrow(/duplicate semantic role/);
  });

  test('no public registrar accepts an opt-out argument', () => {
    // `replace` used to be a public boolean, so the invariant "two different capabilities must
    // not claim one kind" held only by convention: any caller could pass it. Review flagged
    // that, worst for dependencies — a replaced layout handler breaks visibly, a replaced
    // dependency extractor breaks resolved-cache invalidation and reads like a caching bug.
    for (const name of ['registerBlockLayout', 'registerBlockDependencies', 'registerBlockSemanticRole']) {
      const at = SOURCE.indexOf(`export function ${name}(`);
      expect(at).toBeGreaterThan(-1);
      const open = SOURCE.indexOf('(', at);
      let depth = 0;
      let close = open;
      for (; close < SOURCE.length; close += 1) {
        if (SOURCE[close] === '(') depth += 1;
        else if (SOURCE[close] === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      expect(SOURCE.slice(open, close)).not.toMatch(/replace/);
    }
  });
});

describe('built-in registrars allow re-registration but are not public', () => {
  test('each built-in variant replaces silently, which is what hot reload needs', () => {
    // The built-ins register at module scope, so a hot reload re-runs them. Throwing there
    // killed the reload and cascaded into "Failed to reload" for every importer.
    const kind = `builtin-${suffix}`;
    registerBuiltInBlockLayout(kind, () => {});
    expect(() => registerBuiltInBlockLayout(kind, () => {})).not.toThrow();
    registerBuiltInBlockDependencies(kind, () => []);
    expect(() => registerBuiltInBlockDependencies(kind, () => [])).not.toThrow();
    registerBuiltInBlockSemanticRole(kind, 'paragraph');
    expect(() => registerBuiltInBlockSemanticRole(kind, 'paragraph')).not.toThrow();
  });

  test('the built-in variants are NOT re-exported from the package index', () => {
    // This is what makes the escape hatch structural rather than documented: a third-party
    // capability importing the package cannot reach them.
    for (const name of [
      'registerBuiltInBlockLayout',
      'registerBuiltInBlockDependencies',
      'registerBuiltInBlockSemanticRole',
    ]) {
      expect(SOURCE).toContain(`export function ${name}(`);
      expect(INDEX).not.toContain(name);
    }
  });

  test('every register* in block-layout.ts is either throwing or a built-in variant', () => {
    // Guards against a FOURTH registry arriving with a public opt-out. Bounded by each
    // function's own parameter list via paren matching: an earlier version sliced to the
    // first `): void`, which is unanchored, so a registrar returning anything else ran the
    // slice into the next function and the guard passed.
    const names = [
      ...SOURCE.matchAll(/export (?:function|const) (register\w+)\s*[<(=]/g),
    ].map((m) => m[1]!);
    expect(names.length).toBeGreaterThanOrEqual(6);
    for (const name of names) {
      if (name.startsWith('registerBuiltIn')) {
        expect(INDEX).not.toContain(name);
        continue;
      }
      const at = SOURCE.indexOf(name);
      const body = SOURCE.slice(at, SOURCE.indexOf('\n}', at));
      expect(body).toMatch(/throw new Error/);
    }
  });
});
