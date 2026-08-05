// Declarations for the export parser, which the parity scripts and one package test share.
//
// The scripts are plain Node modules — they run as `node scripts/*.mjs` with no build step — but
// `packages/agents/src/__tests__/export-completeness.test.ts` imports this one, and that test is
// inside a package typecheck. Without a declaration the import is an implicit `any`, and the fix
// must not be to write a second parser in TypeScript that can disagree with this one.

/**
 * Top-level named exports of a TypeScript source file, following relative `export *` re-exports.
 *
 * A re-export this parser cannot resolve — a bare specifier, or a path that is not a `.ts`/`.tsx`
 * file — is reported as the symbolic name `<*from:SPECIFIER>` rather than being dropped, so a
 * caller comparing two surfaces sees the asymmetry instead of a false match.
 */
export function collectNamedExports(entryPath: string, visited?: Set<string>): Set<string>;
