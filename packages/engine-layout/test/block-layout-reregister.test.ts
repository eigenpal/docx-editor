// Built-in block layout handlers survive module re-evaluation (dev hot reload).
//
// `registerBlockLayout` threw on any duplicate, and the built-ins register at module scope,
// so every hot reload re-ran them, threw `duplicate block layout handler for kind 'sdt'`,
// and cascaded into "Failed to reload" for every importer — the dev server effectively
// stopped hot-reloading the editor.
//
// The guard still matters: two DIFFERENT capabilities claiming one kind is a real error.
// Only an explicit `replace` opts out, and only the built-ins use it.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  registerBlockLayout,
  registerBlockDependencies,
  registerBlockSemanticRole,
} from '../src/block-layout.ts';

describe('registerBlockLayout duplicate ownership', () => {
  test('a second handler for the same kind is rejected by default', () => {
    const kind = `test-kind-${Math.abs(Number(process.pid))}-a`;
    registerBlockLayout(kind, () => {});
    expect(() => registerBlockLayout(kind, () => {})).toThrow(/duplicate block layout handler/);
  });

  test('replace: true allows re-registration, which is what hot reload needs', () => {
    const kind = `test-kind-${Math.abs(Number(process.pid))}-b`;
    registerBlockLayout(kind, () => {});
    expect(() => registerBlockLayout(kind, () => {}, { replace: true })).not.toThrow();
  });

  // Deliberately NOT asserting on the real 'paragraph'/'table'/'sdt' kinds: replacing them
  // with a no-op would leave every later test in this process laying out nothing. The
  // property that matters is the option, proven above on a synthetic kind.
});

// EVERY registry in this module, not just the one that was reported.
//
// `registerBlockLayout` was fixed first; the hot-reload cascade then simply moved to
// `registerBlockDependencies`, and `registerBlockSemanticRole` had the same shape waiting
// behind it. All three run at module scope, so all three throw on re-evaluation.
//
// This enumerates them so a fourth registry added later fails here rather than in a dev
// server's console.
describe('every block registry tolerates module re-evaluation', () => {
  test('registerBlockDependencies rejects duplicates but accepts replace', () => {
    const kind = `dep-kind-${Math.abs(Number(process.pid))}`;
    registerBlockDependencies(kind, () => []);
    expect(() => registerBlockDependencies(kind, () => [])).toThrow(/duplicate block dependency/);
    expect(() => registerBlockDependencies(kind, () => [], { replace: true })).not.toThrow();
  });

  test('registerBlockSemanticRole rejects duplicates but accepts replace', () => {
    const kind = `role-kind-${Math.abs(Number(process.pid))}`;
    registerBlockSemanticRole(kind, 'paragraph');
    expect(() => registerBlockSemanticRole(kind, 'paragraph')).toThrow(/duplicate semantic role/);
    expect(() => registerBlockSemanticRole(kind, 'paragraph', { replace: true })).not.toThrow();
  });

  test('no registry in block-layout.ts throws on re-registration without opting out', () => {
    // Guard against a FOURTH registry appearing with the old shape. Every exported
    // `register*` must accept an options bag with `replace`.
    const source = readFileSync(
      fileURLToPath(new URL('../src/block-layout.ts', import.meta.url)),
      'utf8',
    );
    // Both `export function registerX(` and `export const registerX = (`, and generics.
    const registrars = [
      ...source.matchAll(/export (?:function|const) (register\w+)\s*[<(=]/g),
    ].map((m) => m[1]!);
    expect(registrars.length).toBeGreaterThanOrEqual(3);
    for (const name of registrars) {
      // Bounded by the registrar's OWN parameter list, by paren matching.
      //
      // Slicing to the first `): void` was unanchored: a registrar returning anything else
      // has no `): void`, so the slice ran past it into the NEXT function — which does
      // declare `replace?: boolean` — and the guard passed. Review demonstrated it with a
      // fourth registry returning an unregister handle: 5 pass, 0 fail, while the throw-on-
      // duplicate shape it exists to catch was sitting right there.
      const at = source.indexOf(`export function ${name}(`);
      const open = source.indexOf('(', at);
      let depth = 0;
      let close = open;
      for (; close < source.length; close += 1) {
        if (source[close] === '(') depth += 1;
        else if (source[close] === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const signature = source.slice(open, close);
      expect(signature).toMatch(/replace\?: boolean/);
    }
  });
});
