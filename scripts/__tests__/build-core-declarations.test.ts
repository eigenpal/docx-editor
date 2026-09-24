import { expect, test } from 'bun:test';
import { packageName, publishedEntries } from '../build-core-declarations.mjs';

const paths = {
  '@docx-editor.dev/core': ['./src/index.ts'],
  '@docx-editor.dev/core/store': ['./src/store/index.ts'],
};

test('each export with a top-level types condition becomes one declaration entry', () => {
  const entries = publishedEntries(
    {
      exports: {
        '.': { types: './dist/index.d.ts', import: './dist/index.mjs' },
        './store': { types: './dist/store.d.ts', import: './dist/store.mjs' },
        './editor.css': './dist/editor.css',
        './package.json': './package.json',
      },
    },
    paths
  );
  expect(entries.map(({ specifier, name }) => [specifier, name])).toEqual([
    ['@docx-editor.dev/core', 'index'],
    ['@docx-editor.dev/core/store', 'store'],
  ]);
  expect(entries[1]!.source.endsWith('/packages/core/src/store/index.ts')).toBe(true);
});

test('a subpath without a source path or with nested types fails instead of shipping no types', () => {
  expect(() =>
    publishedEntries({ exports: { './layout': { types: './dist/layout.d.ts' } } }, paths)
  ).toThrow('has no path for its source');
  expect(() =>
    publishedEntries(
      { exports: { './store': { import: { types: './dist/store.d.ts', default: './x.mjs' } } } },
      paths
    )
  ).toThrow('nests its types condition');
});

test('a bare import is checked against the package that owns it', () => {
  expect(packageName('prosemirror-model')).toBe('prosemirror-model');
  expect(packageName('fflate/browser')).toBe('fflate');
  expect(packageName('@docx-editor.dev/i18n/locales')).toBe('@docx-editor.dev/i18n');
});
