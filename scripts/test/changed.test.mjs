import { expect, test } from 'bun:test';
import { selectTests } from './changed.mjs';

// A small graph: core/a.ts <- core/b.ts <- react/view.tsx <- react/view.test.tsx, plus an
// unrelated vue test and a fixture that one test reads by name.
const files = [
  'packages/core/src/a.ts',
  'packages/core/src/b.ts',
  'packages/core/src/__tests__/a.test.ts',
  'packages/react/src/view.tsx',
  'packages/react/test/view.test.tsx',
  'packages/react/test/subpath.test.tsx',
  'packages/vue/test/other.test.ts',
  'scripts/collaboration/policy.test.ts',
  'e2e/editor.spec.ts',
];
const reverse = new Map([
  [
    'packages/core/src/a.ts',
    new Set(['packages/core/src/b.ts', 'packages/core/src/__tests__/a.test.ts']),
  ],
  ['packages/core/src/b.ts', new Set(['packages/react/src/view.tsx'])],
  [
    'packages/react/src/view.tsx',
    new Set(['packages/react/test/view.test.tsx', 'e2e/editor.spec.ts']),
  ],
  // An import the resolver could only map to the package as a whole.
  ['package:packages/core', new Set(['packages/react/test/subpath.test.tsx'])],
]);
const text = {
  'packages/vue/test/other.test.ts': "readFileSync('fixtures/table.docx')",
  'scripts/collaboration/policy.test.ts': "join('.collaboration/changes')",
};
const read = (file) => text[file] ?? '';

test('a source change selects the tests that import it through any chain', () => {
  expect(selectTests(['packages/core/src/a.ts'], files, reverse, read)).toEqual({
    all: false,
    tests: [
      'packages/core/src/__tests__/a.test.ts',
      'packages/react/test/subpath.test.tsx',
      'packages/react/test/view.test.tsx',
    ],
  });
});

test('a data file selects whoever names it, by file name or by directory', () => {
  expect(
    selectTests(['packages/vue/test/fixtures/table.docx'], files, reverse, read).tests
  ).toEqual(['packages/vue/test/other.test.ts']);
  expect(
    selectTests(['.collaboration/changes/new-decision.json'], files, reverse, read).tests
  ).toEqual(['scripts/collaboration/policy.test.ts']);
});

test('changes the graph cannot follow run the whole suite', () => {
  for (const file of [
    'bun.lock',
    'package.json',
    'packages/core/package.json',
    'tsconfig.json',
    'scripts/test/run-parallel.mjs',
  ]) {
    expect(selectTests([file], files, reverse, read).all).toBe(true);
  }
  expect(selectTests(['packages/core/src/unnamed.bin'], files, reverse, read).all).toBe(true);
});

test('documentation and CI changes select nothing', () => {
  expect(
    selectTests(
      ['docs/guide.mdx', '.github/workflows/ci.yml', '.changeset/x.md'],
      files,
      reverse,
      read
    )
  ).toEqual({
    all: false,
    tests: [],
  });
});
