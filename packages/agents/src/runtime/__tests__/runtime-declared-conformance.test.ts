// The runtime against the declarations, and the generator against the runtime.
//
// Task 1 authored `compat/docxeditor/declarations.ts` by hand from the published Word API surface,
// deliberately without deriving it from any Microsoft package. This runtime has to be the thing
// those declarations describe — otherwise the compatibility story is two documents that happen to
// use the same words.
//
// Two halves are checked now. The lifecycle — `sync()`, a context on every proxy, `isNullObject`,
// and a `run` that returns the callback's value — and the object model's call shapes: every member
// `Document`, `Body`, `Range`, `Paragraph` and the collections implement, compared against the
// declared parameter tuples so a consumer's own call sites compile against either.
// `__conformance__/declared-lifecycle.ts` says exactly what is compared, what is compared only by
// argument list, and which declared members are still owed by the formatting and content-control
// slices.
//
// Type-level assertions only mean something if a compiler reads them, and `bun test` does not
// typecheck. So this compiles them — and compiles a deliberately wrong copy to prove the compiling
// is doing work.

import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { typecheckProject } from '../../../scripts/lib/typecheck-compat.mjs';

const CONFORMANCE = join(import.meta.dir, '..', '__conformance__');

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
});
