import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  declarationExtensions,
  entryMap,
  jsonType,
  packageDocumentationOf,
  publishedDeclaration,
  typesCondition,
  withDeclarations,
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

test('a types condition is found at any depth, in condition order', () => {
  expect(typesCondition({ node: { import: { types: './a.d.ts' } }, types: './b.d.ts' })).toBe(
    './b.d.ts'
  );
  expect(typesCondition({ node: { import: { types: './a.d.ts' } } })).toBe('./a.d.ts');
  expect(typesCondition('./x.mjs')).toBeUndefined();
});

test('tsup --no-dts skips declarations, and other flags keep the previous onSuccess', () => {
  const configUrl = new URL('../../packages/fonts-cjk/tsup.config.ts', import.meta.url);
  const previous = async () => {};
  const config = { entry: ['src/index.ts'], declarations: { banner: '// x' }, onSuccess: previous };

  const skipped = withDeclarations(configUrl, config)({ dts: false });
  expect(skipped.dts).toBe(false);
  expect(skipped.onSuccess).toBe(previous);
  expect('declarations' in skipped).toBe(false);

  const [built] = withDeclarations(configUrl, [config])({ outDir: 'out' });
  expect(built!.dts).toBe(false);
  expect(built!.onSuccess).not.toBe(previous);
  expect('declarations' in built!).toBe(false);

  expect(() => withDeclarations(configUrl, { ...config, onSuccess: 'echo' })({})).toThrow(
    'needs `onSuccess` as a function'
  );
});

test('an entry keeps its package documentation, and only that comment', () => {
  const source = [
    '/* license */',
    '/** A helper, not the package. */',
    'const x = 1;',
    '/**',
    ' * The package.',
    ' *',
    ' * @packageDocumentation',
    ' */',
    'export { x };',
  ].join('\n');
  expect(packageDocumentationOf(source)).toBe(
    ['/**', ' * The package.', ' *', ' * @packageDocumentation', ' */'].join('\n')
  );
  expect(packageDocumentationOf('/** No tag. */\nexport {};')).toBeNull();
  expect(packageDocumentationOf('/** First. */\n/** @packageDocumentation */')).toBe(
    '/** @packageDocumentation */'
  );
  // Many unclosed comment openers are read once each.
  const started = performance.now();
  expect(packageDocumentationOf(`${'/**'.repeat(50_000)}@packageDocumentation`)).toBeNull();
  expect(performance.now() - started).toBeLessThan(1000);
});
