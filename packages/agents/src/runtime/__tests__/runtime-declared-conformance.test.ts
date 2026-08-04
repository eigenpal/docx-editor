// The runtime against the declarations, and the generator against the runtime.
//
// Task 1 authored `compat/docxeditor/declarations.ts` by hand from the published Word API surface,
// deliberately without deriving it from any Microsoft package. This runtime has to be the thing
// those declarations describe — otherwise the compatibility story is two documents that happen to
// use the same words.
//
// The lifecycle half of that surface is small and exists today: `sync()`, a context on every proxy,
// `isNullObject`, and a `run` that returns the callback's value. The object model half (`document`,
// `Body`, `Paragraph`, …) is a later slice, and `__conformance__/declared-lifecycle.ts` says exactly
// which members are checked and which are still owed.
//
// Type-level assertions only mean something if a compiler reads them, and `bun test` does not
// typecheck. So this compiles them — and compiles a deliberately wrong copy to prove the compiling
// is doing work.

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { typecheckProject } from '../../../scripts/lib/typecheck-compat.mjs';

const CONFORMANCE = join(import.meta.dir, '..', '__conformance__');
const GENERATOR = join(import.meta.dir, '..', '..', '..', 'scripts', 'generate-conformance.mjs');

describe('the runtime satisfies the authored declarations', () => {
  test('the assertions compile against the declarations, with zero diagnostics', () => {
    expect(existsSync(join(CONFORMANCE, 'tsconfig.json'))).toBe(true);
    expect(typecheckProject(join(CONFORMANCE, 'tsconfig.json'))).toEqual([]);
  });

  test('and a wrong assertion does not compile, so the check above is doing work', () => {
    const diagnostics = typecheckProject(join(CONFORMANCE, '__negative__', 'tsconfig.json'));
    // Failing is not enough: it has to fail ON the false assertion. A missing file or a broken
    // tsconfig also produces diagnostics, and either would make this control worthless.
    expect(diagnostics.some((line) => line.includes('mismatch.ts'))).toBe(true);
  });

  test('the assertions name what the lifecycle owes the object-model slice', () => {
    // A conformance file that quietly checks three easy members and calls it done is worse than
    // none. This one has to say what it is not checking yet.
    const source = readFileSync(join(CONFORMANCE, 'declared-lifecycle.ts'), 'utf8');
    expect(source).toContain('document');
    expect(source).toContain('Paragraph');
  });
});

describe('the conformance generator', () => {
  const source = readFileSync(GENERATOR, 'utf8');

  test('writes only into the generated directory', () => {
    // Requirement, not habit: a generator that could write a production declaration would make the
    // independently authored surface derived output, which is the whole thing being avoided.
    const writes = [...source.matchAll(/writeFileSync\(\s*([^,]+),/g)].map((match) => match[1]);
    expect(writes.length).toBeGreaterThan(0);
    for (const target of writes) expect(target).toContain('generatedDir');
  });

  test('never names the runtime, the package source, or the authored declarations as an output', () => {
    expect(source).not.toMatch(/writeFileSync\([^)]*src/);
    expect(source).not.toMatch(/writeFileSync\([^)]*declarations/);
  });

  test('the runtime does not import generated conformance output', () => {
    // The dependency runs one way: declarations describe the runtime, generated assertions compare
    // declarations to the reference. Nothing shipped may depend on generated files.
    const runtimeSources = [
      'index.ts',
      'browser-entry.ts',
      'public.ts',
      'request-context.ts',
      'client-object.ts',
    ];
    for (const name of runtimeSources) {
      const text = readFileSync(join(import.meta.dir, '..', name), 'utf8');
      expect(text).not.toContain('compat/');
      expect(text).not.toContain('generated');
    }
  });
});
