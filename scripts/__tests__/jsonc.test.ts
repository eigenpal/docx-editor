import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonc } from '../lib/jsonc.mjs';

test('comments and trailing commas go, and strings keep what looks like either', () => {
  const text = `{
    // a line comment
    "glob": "packages/**/*.ts", /* a block comment */
    "message": "a, ] and // inside a string",
    "escaped": "quote \\" then /* not a comment */",
    "list": [1, 2,],
  }`;
  expect(parseJsonc(text)).toEqual({
    glob: 'packages/**/*.ts',
    message: 'a, ] and // inside a string',
    escaped: 'quote " then /* not a comment */',
    list: [1, 2],
  });
});

test('an unterminated block comment fails instead of eating the rest of the file', () => {
  expect(() => parseJsonc('{ /* open "a": 1 }')).toThrow('Unterminated block comment');
});

test('the lint configuration parses', () => {
  const config = parseJsonc(
    readFileSync(join(import.meta.dir, '..', '..', '.oxlintrc.json'), 'utf8')
  ) as { overrides: unknown[]; jsPlugins: string[] };
  expect(config.jsPlugins).toEqual(['./scripts/oxlint/docx-rules.mjs']);
  expect(config.overrides.length).toBeGreaterThan(20);
});
