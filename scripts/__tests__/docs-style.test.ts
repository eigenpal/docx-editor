import { expect, test } from 'bun:test';
import { checkDocsStyle, checkPackageReadme, proseLines } from '../lib/docs-style.mjs';

test('checks prose across line breaks and keeps source line numbers', () => {
  expect(checkDocsStyle('# Guide\n\nIt works out of\nthe box.\n[Click here](guide.md).')).toEqual([
    { line: 3, message: 'Use a direct, timeless description. Found: out of\nthe box' },
    { line: 5, message: 'Use descriptive link text. Found: [Click here]' },
  ]);
});

test('excludes code, frontmatter, comments, and link destinations', () => {
  const source = [
    '---',
    'title: currently',
    '---',
    '~~~ts',
    'const currently = true;',
    '~~~',
    '````md',
    '```ts',
    'simply()',
    '```',
    '````',
    '<!-- easily',
    'currently -->',
    'Call `simply()` or `` `currently` ``.',
    '[Current state](https://example.com/currently)',
  ].join('\n');
  expect(checkDocsStyle(source)).toEqual([]);
});

test('requires descriptive image text while preserving useful prose', () => {
  expect(checkDocsStyle('![Editor](editor.png)\nRead [Setup](setup.md).')).toEqual([]);
  expect(checkDocsStyle('![](editor.png)')).toHaveLength(1);
  expect(checkDocsStyle('Simply open the editor.')).toHaveLength(1);
});

test('requires a purpose paragraph and exact public package installation', () => {
  const manifest = { name: '@docx-editor.dev/sample' };
  const readme =
    '# Sample\n\nConvert documents.\n\n```sh\nnpm install @docx-editor.dev/sample\n```';
  expect(checkPackageReadme(readme, manifest)).toEqual([]);
  expect(checkPackageReadme(readme.replace('sample\n', 'sample-extra\n'), manifest)).toContain(
    'Add an installation command for the package.'
  );
  expect(checkPackageReadme('# Sample\n\n## Setup', manifest)).toContain(
    'Add a purpose paragraph after the title.'
  );
});

test('private packages need documentation but no public installation command', () => {
  expect(
    checkPackageReadme('# @docx-editor.dev/nuxt\n\nUse this workspace module.', {
      name: '@docx-editor.dev/nuxt',
      private: true,
    })
  ).toEqual([]);
});

test('tag removal preserves word boundaries and removes incomplete markup', () => {
  expect(checkDocsStyle('Text<Badge/>currently works.')).toHaveLength(1);
  expect(proseLines('<script <Badge/>currently>')).toEqual([' currently ']);
  expect(proseLines('<script')).toEqual([' script']);
});
