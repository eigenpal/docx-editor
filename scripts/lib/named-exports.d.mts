// Declarations for the export parser shared by the parity and public-docs-surface scripts.
//
// The scripts are plain Node modules — they run as `node scripts/*.mjs` with no build step — but a
// TypeScript importer inside a package typecheck would get an implicit `any` without a declaration,
// and the fix must not be to write a second parser in TypeScript that can disagree with this one.

/**
 * Top-level named exports of a TypeScript source file, following relative `export *` re-exports.
 *
 * A re-export this parser cannot resolve — a bare specifier, or a path that is not a `.ts`/`.tsx`
 * file — is reported as the symbolic name `<*from:SPECIFIER>` rather than being dropped, so a
 * caller comparing two surfaces sees the asymmetry instead of a false match.
 */
export function collectNamedExports(entryPath: string, visited?: Set<string>): Set<string>;
