import { expect, test } from 'bun:test';
import {
  declarationCandidates,
  packageName,
  publishedEntries,
} from '../build-core-declarations.mjs';
import { siblingsOf } from '../check-built-siblings.mjs';
import { declarationCompilerOptions } from '../declaration-options.mjs';

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

test('an import keeps its module kind when it resolves to a declaration file', () => {
  expect(declarationCandidates('/o/foo.ts')).toEqual(['/o/foo.d.ts']);
  expect(declarationCandidates('/o/foo.js')).toEqual(['/o/foo.d.ts']);
  expect(declarationCandidates('/o/foo.mts')).toEqual(['/o/foo.d.mts']);
  expect(declarationCandidates('/o/foo.cjs')).toEqual(['/o/foo.d.cts']);
  expect(declarationCandidates('/o/foo')).toEqual(['/o/foo.d.ts', '/o/foo/index.d.ts']);
});

test('declaration builds drop sibling source paths and keep local aliases', () => {
  const react = declarationCompilerOptions(
    new URL('../../packages/react/tsup.config.ts', import.meta.url)
  );
  expect(Object.keys(react.paths)).toEqual(['@/*']);
  const pro = declarationCompilerOptions(
    new URL('../../packages/pro/tsup.config.ts', import.meta.url),
    { jsx: 'preserve' }
  );
  // pro keeps its test-only editor-api path; it reads core, react, and vue from dist.
  expect(pro).toEqual({
    jsx: 'preserve',
    paths: { '@docx-editor.dev/editor-api': ['../editor-api/src/index.ts'] },
  });
  const editorApi = declarationCompilerOptions(
    new URL('../../packages/editor-api/tsup.config.ts', import.meta.url)
  );
  expect(
    Object.keys(editorApi.paths).every((key) => !key.startsWith('@docx-editor.dev/core'))
  ).toBe(true);
  expect(Object.keys(editorApi.paths)).toContain('@docx-editor.dev/editor-api');
});

test('a package checks every sibling it reads, including those behind core', () => {
  const siblings = (name: string) =>
    [...siblingsOf(new URL(`../../packages/${name}`, import.meta.url).pathname).keys()].sort();
  expect(siblings('editor-api')).toEqual(['@docx-editor.dev/core', '@docx-editor.dev/i18n']);
  expect(siblings('pro')).toEqual([
    '@docx-editor.dev/core',
    '@docx-editor.dev/i18n',
    '@docx-editor.dev/react',
    '@docx-editor.dev/vue',
  ]);
  expect(siblings('fonts')).toEqual([]);
});
