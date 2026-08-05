// Declarations for the one `.mjs` helper the SHIPPED lane's tests import.
//
// The compat corpus's build steps are plain Node modules on purpose — they run before any
// TypeScript exists. This one is different: `runtime/__tests__/runtime-boundaries.test.ts` and
// `runtime-declared-conformance.test.ts` compile projects with it, and those tests are inside the
// package's typecheck. Without a declaration the import is an implicit `any`, which under
// `noImplicitAny` is an error, and the fix must not be to stop checking the tests.

/**
 * Compile a `tsconfig.json` in-process and answer its diagnostics, one formatted string each.
 * An empty array means the project compiled clean.
 */
export function typecheckProject(tsconfigPath: string): string[];
