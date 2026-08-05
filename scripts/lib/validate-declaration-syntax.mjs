// Validate published `.d.ts` artifacts parse as strict ambient declarations.
// Function bodies inside `declare function` signatures must fail here.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Match declare-function bodies only (brace opens after the parameter list).
const IMPLEMENTATION_BODY =
  /export\s+declare\s+function\s+[\s\S]+?\)\s*(?::[\s\S]+?)?\s*\{[\s\S]*?(?:^\s+return\b|\n\s+const\b|\n\s+let\b|\n\s+if\s*\()/m;

function walkDtsFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      files.push(...walkDtsFiles(absolute));
      continue;
    }
    if (entry.endsWith('.d.ts') && !entry.endsWith('.rollup-temp.d.ts')) {
      files.push(absolute);
    }
  }
  return files;
}

/** Fast pre-check before invoking tsc. */
export function declarationHasImplementationBody(content) {
  return IMPLEMENTATION_BODY.test(content);
}

/**
 * @param {string} declarationPath absolute path to one `.d.ts` file
 * @returns {string[]} diagnostic messages; empty when valid
 */
export function validateDeclarationSyntax(declarationPath) {
  const content = readFileSync(declarationPath, 'utf8');
  if (declarationHasImplementationBody(content)) {
    return [`${declarationPath}: declare function contains an implementation body`];
  }

  const tempRoot = mkdtempSync(path.join(tmpdir(), 'docx-dts-syntax-'));
  const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
  writeFileSync(
    tsconfigPath,
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          skipLibCheck: false,
          noEmit: true,
          module: 'ESNext',
          moduleResolution: 'Bundler',
          target: 'ES2022',
          jsx: 'preserve',
        },
        files: [declarationPath],
      },
      null,
      2
    )}\n`
  );

  const result = spawnSync('bunx', ['tsc', '-p', tsconfigPath], {
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS ?? '--max-old-space-size=4096' },
  });
  const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.status === 0) return [];

  return combined
    .split('\n')
    .filter((line) => /error TS/.test(line))
    .map((line) => line.trim());
}

/**
 * @param {string} distDir absolute path to a package `dist/` folder
 * @returns {string[]} all diagnostics
 */
export function validateDeclarationTree(distDir) {
  const errors = [];
  for (const file of walkDtsFiles(distDir)) {
    const content = readFileSync(file, 'utf8');
    if (declarationHasImplementationBody(content)) {
      errors.push(
        `${path.relative(distDir, file)}: declare function contains an implementation body`
      );
    }
  }
  return errors;
}

/**
 * Resolve a relative import/export target within a declaration tree.
 *
 * @param {string} fromFile
 * @param {string} specifier
 * @returns {string | null}
 */
export function resolveDeclarationImport(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  /** @type {string[]} */
  const candidates = [base];

  // TypeScript ESM: `.js`/`.mjs`/`.cjs` specifiers in `.d.ts` map to declaration files.
  const jsMatch = specifier.match(/\.(m?js|cjs)$/);
  if (jsMatch) {
    const stem = base.slice(0, -jsMatch[0].length);
    candidates.push(
      `${stem}.d.ts`,
      `${stem}.d.mts`,
      path.join(stem, 'index.d.ts'),
      path.join(stem, 'index.d.mts')
    );
  }

  candidates.push(
    `${base}.d.ts`,
    `${base}.d.mts`,
    path.join(base, 'index.d.ts'),
    path.join(base, 'index.d.mts')
  );

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const IMPORT_EXPORT =
  /\b(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|[^'";]+?)\s+from\s+['"](\.[^'"]+)['"]|export\s+\*\s+from\s+['"](\.[^'"]+)['"]/g;

/**
 * @param {string} distDir
 * @returns {string[]} unresolved relative import paths
 */
export function findUnresolvedDeclarationImports(distDir) {
  const errors = [];
  for (const file of walkDtsFiles(distDir)) {
    const content = readFileSync(file, 'utf8');
    const codeOnly = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\*.*$/gm, '');
    for (const match of codeOnly.matchAll(IMPORT_EXPORT)) {
      const specifier = match[1] ?? match[2];
      if (!specifier?.startsWith('.')) continue;
      if (!resolveDeclarationImport(file, specifier)) {
        errors.push(`${path.relative(distDir, file)}: unresolved declaration import '${specifier}'`);
      }
    }
  }
  return errors;
}
