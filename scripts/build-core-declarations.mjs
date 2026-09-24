// Emits packages/core/dist/**/*.d.ts: one declaration file per published subpath, with the
// declarations those subpaths share split into chunks.
//
// Two steps, because the one-step bundler cost four times the memory. tsup's `dts: true`
// hands TypeScript sources to rollup-plugin-dts, which keeps the whole program alive while
// it emits and re-parses every module through rollup. For core that peaked at 4.7 GiB of
// heap, above Node's default limit, so every caller had to know to raise the heap, and the
// one that did not (the documentation sync) failed the 2.22.0 release. Here TypeScript
// emits the declarations once (about 1.1 GiB), and rollup-plugin-dts then bundles `.d.ts`
// files only, which needs no TypeScript program at all.
//
// The subpath list is not written down again here. It comes from the two tables
// subpath-tables.test.ts already holds in step with the tsup entries: `exports` in
// package.json says which declaration file each subpath ships, and `paths` in tsconfig.json
// says which source file that subpath compiles from.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rollup } from 'rollup';
import dts from 'rollup-plugin-dts';
import ts from 'typescript';

const core = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'core');
const src = join(core, 'src');
const dist = join(core, 'dist');
const PACKAGE = '@docx-editor.dev/core';

/** Every published subpath: its rollup entry name and its source file. */
function publishedEntries() {
  const manifest = JSON.parse(readFileSync(join(core, 'package.json'), 'utf8'));
  const tsconfig = JSON.parse(readFileSync(join(core, 'tsconfig.json'), 'utf8'));
  const paths = tsconfig.compilerOptions.paths;
  const entries = [];
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    const types = typeof target === 'object' && target !== null ? target.types : undefined;
    if (typeof types !== 'string') continue;
    const specifier = subpath === '.' ? PACKAGE : `${PACKAGE}${subpath.slice(1)}`;
    const source = paths[specifier]?.[0];
    if (!source) {
      throw new Error(`${specifier} ships ${types} but tsconfig.json has no path for its source.`);
    }
    const name = types.replace(/^\.\/dist\//, '').replace(/\.d\.ts$/, '');
    entries.push({ specifier, name, source: resolve(core, source) });
  }
  if (entries.length === 0) throw new Error('package.json exports name no declaration files.');
  return entries;
}

/** Emit declarations for everything the entries reach, into `outDir`. */
function emitDeclarations(entries, outDir) {
  const configPath = join(core, 'tsconfig.json');
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
  if (error) throw new Error(ts.formatDiagnostic(error, formatHost));
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, core);
  const options = {
    ...parsed.options,
    noEmit: false,
    declaration: true,
    emitDeclarationOnly: true,
    declarationMap: false,
    // As tsup did: a type error anywhere in the program fails the build, not only an
    // error the declaration emitter itself reports.
    noEmitOnError: true,
    rootDir: src,
    outDir,
  };
  // Rooted at the entries, not at tsconfig's `include`: test files and anything no subpath
  // reaches stay out of the program.
  const program = ts.createProgram(
    entries.map((entry) => entry.source),
    options
  );
  const { diagnostics, emitSkipped } = program.emit(undefined, undefined, undefined, true);
  const errors = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (emitSkipped || errors.length > 0) {
    throw new Error(`Declaration emit failed:\n${ts.formatDiagnostics(errors, formatHost)}`);
  }
}

const formatHost = {
  getCanonicalFileName: (fileName) => fileName,
  getCurrentDirectory: () => core,
  getNewLine: () => '\n',
};

/** The emitted declaration file for a source file. */
function declarationFor(outDir, sourceFile) {
  return join(outDir, relative(src, sourceFile)).replace(/\.tsx?$/, '.d.ts');
}

/**
 * Resolve the imports inside the emitted declarations.
 *
 * TypeScript keeps each specifier as written, so relative imports still end in `.ts`, and
 * the engine's imports of its own subpaths (`@docx-editor.dev/core/store`) still name the
 * package. Both resolve to the emitted files, so they bundle like any other module. Every
 * other bare specifier is a dependency and stays an import.
 */
function declarationResolver(entries, outDir) {
  const selfImports = new Map(
    entries.map((entry) => [entry.specifier, declarationFor(outDir, entry.source)])
  );
  return {
    name: 'core-declaration-resolver',
    resolveId(source, importer) {
      const self = selfImports.get(source);
      if (self) return self;
      if (source.startsWith('.') && importer) {
        const base = resolve(dirname(importer), source).replace(/\.(d\.ts|ts|tsx|js)$/, '');
        for (const candidate of [`${base}.d.ts`, join(base, 'index.d.ts')]) {
          if (existsSync(candidate)) return candidate;
        }
        throw new Error(`Cannot resolve ${source} from ${relative(outDir, importer)}.`);
      }
      if (!isAbsolute(source)) return { id: source, external: true };
      return null;
    },
  };
}

async function bundleDeclarations(entries, outDir) {
  const bundle = await rollup({
    input: Object.fromEntries(
      entries.map((entry) => [entry.name, declarationFor(outDir, entry.source)])
    ),
    plugins: [declarationResolver(entries, outDir), dts()],
  });
  try {
    await bundle.write({
      dir: dist,
      format: 'es',
      entryFileNames: '[name].d.ts',
      // A chunk takes its name from its first module, `types-barrel.d.ts`, so drop the `.d`.
      chunkFileNames: (chunk) => `${chunk.name.replace(/\.d$/, '')}-[hash].d.ts`,
    });
  } finally {
    await bundle.close();
  }
}

const entries = publishedEntries();
const outDir = mkdtempSync(join(tmpdir(), 'docx-core-declarations-'));
try {
  emitDeclarations(entries, outDir);
  await bundleDeclarations(entries, outDir);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
