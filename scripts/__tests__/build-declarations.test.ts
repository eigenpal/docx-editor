import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  declarationExtensions,
  entryMap,
  jsonType,
  publishedDeclaration,
} from '../build-declarations.mjs';
import { defaultTypeRoots, typescript7Compiler } from '../lib/declaration-files.mjs';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function scratch() {
  // Real path: on macOS the temporary directory is a symlink, and module resolution follows it.
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'docx-declarations-test-')));
  directories.push(directory);
  return directory;
}

function write(path: string, value: unknown) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
}

test('declarations keep the extensions tsup wrote for each module kind', () => {
  expect(declarationExtensions({ type: 'module' })).toEqual(['.d.ts', '.d.cts']);
  expect(declarationExtensions({})).toEqual(['.d.ts', '.d.mts']);
});

test('an entry list names each entry after its source, as tsup does', () => {
  expect(entryMap(['src/index.ts', 'src/pt-BR.ts'])).toEqual({
    index: 'src/index.ts',
    'pt-BR': 'src/pt-BR.ts',
  });
  const named = { 'react/index': 'src/react/index.ts' };
  expect(entryMap(named)).toBe(named);
});

test('a JSON module declares the type TypeScript gives the import', () => {
  expect(
    jsonType({ name: 'Bold', size: 11, on: true, none: null, 'pt-BR': {}, list: [1, 'a', 2] })
  ).toBe(
    [
      '{',
      '    name: string;',
      '    size: number;',
      '    on: boolean;',
      '    none: null;',
      '    "pt-BR": {};',
      '    list: (number | string)[];',
      '}',
    ].join('\n')
  );
  expect(jsonType([])).toBe('never[]');
  // Array elements with different keys get the keys they lack as optional `undefined`.
  expect(jsonType([{ a: 1 }, { b: 'x' }])).toBe(
    '({\n    a: number;\n    b?: undefined;\n} | {\n    a?: undefined;\n    b: string;\n})[]'
  );
  expect(jsonType({ nested: { deep: 'x' } })).toBe(
    '{\n    nested: {\n        deep: string;\n    };\n}'
  );
});

test('an inlined package resolves to the declaration file its exports publish', () => {
  const root = scratch();
  const library = join(root, 'node_modules', '@scope', 'library');
  write(join(library, 'package.json'), {
    name: '@scope/library',
    exports: {
      '.': { types: './dist/index.d.ts', import: './dist/index.mjs' },
      './sub': { import: { types: './dist/sub.d.ts', default: './dist/sub.mjs' } },
      './missing': { types: './dist/missing.d.ts' },
      './plain': './dist/plain.mjs',
    },
  });
  write(join(library, 'dist', 'index.d.ts'), 'export {};');
  write(join(library, 'dist', 'sub.d.ts'), 'export {};');
  write(join(root, 'package.json'), { name: 'consumer' });

  expect(publishedDeclaration('@scope/library', root)).toBe(join(library, 'dist', 'index.d.ts'));
  expect(publishedDeclaration('@scope/library/sub', root)).toBe(join(library, 'dist', 'sub.d.ts'));
  expect(() => publishedDeclaration('@scope/library/missing', root)).toThrow('is not built');
  expect(() => publishedDeclaration('@scope/library/plain', root)).toThrow(
    'publishes no declaration file'
  );
});

test('type roots are every node_modules/@types from the package up', () => {
  const root = scratch();
  const packageDir = join(root, 'packages', 'core');
  mkdirSync(join(root, 'node_modules', '@types'), { recursive: true });
  mkdirSync(join(packageDir, 'node_modules', '@types'), { recursive: true });
  const roots = defaultTypeRoots(packageDir);
  expect(roots.slice(0, 2)).toEqual([
    join(packageDir, 'node_modules', '@types'),
    join(root, 'node_modules', '@types'),
  ]);
});

test('every package that builds declarations installs the TypeScript 7 compiler', () => {
  const repository = join(import.meta.dir, '..', '..');
  for (const name of [
    'core',
    'docx-to-markdown',
    'docx-to-pdf',
    'editor-api',
    'fonts',
    'fonts-cjk',
    'i18n',
    'pro',
    'react',
    'vue',
  ]) {
    expect(typescript7Compiler(join(repository, 'packages', name))).toEndWith('/bin/tsc');
  }
});
