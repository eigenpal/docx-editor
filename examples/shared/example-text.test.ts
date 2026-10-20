import { expect, test } from 'bun:test';
import { exampleText, type ExampleTextKey } from './example-text';

const examples: readonly [ExampleTextKey, Record<string, string | number>, string][] = [
  ['automationRecipes.running', { recipe: 'Inspect paragraphs' }, 'Running Inspect paragraphs.'],
  ['structuredAutomation.bookmarkSelected', { name: 'Terms' }, 'Selected bookmark Terms.'],
  ['commentAutomation.failed', { recipe: 'Add a reply' }, 'Add a reply failed.'],
  ['consumerApi.eventSelection', { current: 2, total: 9 }, 'Selection: page 2 of 9.'],
];

for (const [key, variables, expected] of examples) {
  test(`example-owned message resolves ${key}`, () => {
    expect(exampleText(key, variables)).toBe(expected);
  });
}

test('example-owned labels and license text resolve without a library catalog', () => {
  expect(exampleText('automationRecipes.inspect')).toBe('Inspect paragraphs');
  expect(exampleText('commentAutomation.license')).toBe(
    'Comment automation requires the EigenPal Pro License.'
  );
});

test('function messages keep numeric count handling', () => {
  expect(exampleText('documentRefresh.count', { count: 1 })).toBe('1 recent change');
  expect(exampleText('documentRefresh.count', { count: 2 })).toBe('2 recent changes');
});
