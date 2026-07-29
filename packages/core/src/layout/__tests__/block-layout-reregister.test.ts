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
} from '../block-layout.ts';

const SOURCE = readFileSync(
  fileURLToPath(new URL('../block-layout.ts', import.meta.url)),
  'utf8'
);
const INDEX = readFileSync(fileURLToPath(new URL('../index.ts', import.meta.url)), 'utf8');

/**
 * Names of every exported registrar, derived from the source rather than hardcoded.
 *
 * The character class includes `:` because a type-annotated const reads
 * `export const registerX: Registrar = (…) =>`. Without it that declaration matched nothing,
 * so it entered NEITHER list — signature never inspected, body never required to throw — and
 * the count assertions still passed because the three known registrars were untouched. Review
 * found it: the worst of the remaining shapes precisely because it failed silently instead of
 * loudly.
 *
 * TWO shapes are still not covered, and are accepted rather than overlooked:
 *
 *  - `replace` declared in a NAMED type (`options: PainterOptions = {}`) rather than inline.
 *    A textual guard cannot follow a type reference. Accepted: the shape that actually
 *    regressed twice was inline, and a reviewer sees `PainterOptions` in the diff.
 *  - A registrar in a DIFFERENT file that the index re-exports. `SOURCE` is this file only.
 *    Closing it means deriving the list from the index's export surface, since the index is
 *    what defines "public" — worth doing when a second registration module appears.
 */
function registrarNames(source: string): string[] {
  return [...source.matchAll(/export (?:function|const) (register\w+)\s*[<(=:]/g)].map(
    (m) => m[1]!
  );
}

/**
 * A registrar's OWN parameter list and body, anchored on its declaration.
 *
 * BOTH ends have to be anchored, and review caught each in turn. Slicing to the first
 * `): void` was unanchored at the END, so a registrar returning anything else ran into the
 * next function. Starting from `SOURCE.indexOf(name)` is unanchored at the START: the bare
 * name also appears in prose, and this file already carries `{@link registerBlockLayout}`
 * mentions, so a section comment naming a new registrar begins the slice in the comment and
 * ends it inside a DIFFERENT function's body — which throws, so a non-throwing public
 * registrar passed.
 */
function declarationOf(source: string, name: string): { signature: string; body: string } {
  const at = source.search(new RegExp(`export (?:function|const) ${name}\\s*[<(=]`));
  if (at === -1) throw new Error(`no declaration for ${name}`);
  const open = source.indexOf('(', at);
  // Guarded: a declaration matched via `<`, `=` or `:` with no `(` after it left `open` at
  // -1, and the loop below then scanned from index 0 and returned a slice of an unrelated
  // part of the file. Unreachable with any plausible declaration, and it is the last
  // asymmetry in a function that exists to be anchored at both ends.
  if (open === -1) throw new Error(`no parameter list for ${name}`);
  let depth = 0;
  let close = open;
  for (; close < source.length; close += 1) {
    if (source[close] === '(') depth += 1;
    else if (source[close] === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const end = source.indexOf('\n}', close);
  return {
    signature: source.slice(open, close),
    body: source.slice(close, end === -1 ? undefined : end),
  };
}

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
    // DERIVED, not hardcoded. Listing the three known registrars meant a FOURTH could restore
    // the public `replace` flag and never be inspected — the exact defect the parent commit
    // removed, re-introducible on a new registry with the suite green.
    const publicNames = registrarNames(SOURCE).filter((n) => !n.startsWith('registerBuiltIn'));
    expect(publicNames.length).toBeGreaterThanOrEqual(3);
    for (const name of publicNames) {
      expect(declarationOf(SOURCE, name).signature).not.toMatch(/replace/);
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
    const names = registrarNames(SOURCE);
    expect(names.length).toBeGreaterThanOrEqual(6);
    for (const name of names) {
      if (name.startsWith('registerBuiltIn')) {
        expect(INDEX).not.toContain(name);
        continue;
      }
      const { signature, body } = declarationOf(SOURCE, name);
      // A throw ALONE is not enough: a `replace`-gated throw satisfies the grep while still
      // handing out the opt-out. Both halves are required.
      expect(body).toMatch(/throw new Error/);
      expect(signature).not.toMatch(/replace/);
    }
  });
});
