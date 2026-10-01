// Helpers shared by the declaration builds: scripts/build-core-declarations.mjs for core and
// scripts/build-declarations.mjs for every tsup package.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

/** `@scope/name/sub` → `@scope/name`, `name/sub` → `name`. */
export function packageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * The emitted declaration files an import of `target` can mean, most specific first. An
 * extension keeps its module kind: `.mts` and `.mjs` map to `.d.mts`, `.cts` and `.cjs`
 * to `.d.cts`. A path without one can name a file or a directory index.
 */
export function declarationCandidates(target) {
  const match = /(?:\.d)?\.(m|c)?(?:ts|tsx|js|jsx)$/.exec(target);
  if (!match) return [`${target}.d.ts`, join(target, 'index.d.ts')];
  return [`${target.slice(0, match.index)}.d.${match[1] ?? ''}ts`];
}

/** `paths` with every target made absolute, so a tsconfig in another directory can use them. */
export function absolutePaths(paths, base) {
  return Object.fromEntries(
    Object.entries(paths).map(([specifier, targets]) => [
      specifier,
      targets.map((target) => (isAbsolute(target) ? target : resolve(base, target))),
    ])
  );
}

/**
 * Every `node_modules/@types` from `dir` up to the filesystem root: TypeScript's default
 * `typeRoots` for a tsconfig in `dir`.
 */
export function defaultTypeRoots(dir) {
  const roots = [];
  for (let current = resolve(dir); ; current = dirname(current)) {
    const candidate = join(current, 'node_modules', '@types');
    if (existsSync(candidate)) roots.push(candidate);
    if (dirname(current) === current) return roots;
  }
}

/**
 * The compiler options every declaration emit shares. TypeScript 7 runs them from a
 * generated tsconfig in a temporary directory that extends the package's own, so the type
 * roots are pinned to the package: from the temporary directory, `"types": ["bun"]` would
 * not resolve.
 */
export function emitOptions(packageDir, rootDir, outDir) {
  return {
    typeRoots: defaultTypeRoots(packageDir),
    noEmit: false,
    declaration: true,
    emitDeclarationOnly: true,
    declarationMap: false,
    // A type error anywhere in the program fails the build, not only an error the
    // declaration emitter itself reports.
    noEmitOnError: true,
    rootDir,
    outDir,
    incremental: false,
    composite: false,
  };
}

/** The TypeScript 7 compiler a package installs as `typescript7`. */
export function typescript7Compiler(packageDir) {
  const manifest = createRequire(join(packageDir, 'package.json')).resolve(
    'typescript7/package.json'
  );
  return join(dirname(manifest), 'bin', 'tsc');
}

/** Run TypeScript 7 on a tsconfig, and throw with its diagnostics when it fails. */
export function runTypeScript7(packageDir, tsconfigPath) {
  const result = spawnSync(
    process.execPath,
    [typescript7Compiler(packageDir), '-p', tsconfigPath, '--pretty', 'false'],
    { cwd: packageDir, encoding: 'utf8' }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Declaration emit failed for ${relative(process.cwd(), packageDir) || '.'}:\n` +
        `${result.stdout}${result.stderr}`
    );
  }
}
