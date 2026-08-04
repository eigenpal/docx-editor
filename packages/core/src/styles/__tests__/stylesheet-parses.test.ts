// The shipped stylesheet must PARSE.
//
// This exists because a merge once spliced one rule's body into another's, leaving a block
// unclosed. Every gate stayed green — typecheck, the whole suite, and `check:adapter-css-thin`
// all pass on a stylesheet that no CSS parser will accept — and the failure only surfaced when
// the demo app was built, which nothing in CI did. The app build is now a CI step; this is the
// same guard in milliseconds, so a broken stylesheet fails the suite rather than the deploy.
//
// Both adapters `@import` this one file, so a parse error here breaks every consumer.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';

const STYLESHEETS = [
  'packages/core/src/styles/editor.css',
  'packages/react/src/styles/editor.css',
  'packages/vue/src/styles/editor.css',
];

const repositoryRoot = resolve(import.meta.dir, '../../../../..');

describe('the shipped stylesheets parse', () => {
  for (const relative of STYLESHEETS) {
    test(`${relative} is valid CSS`, () => {
      const path = resolve(repositoryRoot, relative);
      const css = readFileSync(path, 'utf8');
      // `postcss.parse` throws a `CssSyntaxError` naming the line — the same error the app
      // build reports, without paying for the build.
      expect(() => postcss.parse(css, { from: path })).not.toThrow();
    });
  }

  test('the core stylesheet declares the review and navigation rules it is meant to', () => {
    // A parse check alone would pass on a file that lost half its rules to a bad merge, which
    // is the other half of what went wrong. These are the two blocks that collided.
    const css = readFileSync(resolve(repositoryRoot, STYLESHEETS[0]!), 'utf8');
    const root = postcss.parse(css);
    const selectors = new Set<string>();
    root.walkRules((rule) => {
      selectors.add(rule.selector);
    });
    for (const selector of [
      '.docx-review__marker',
      '.docx-review__marker:hover',
      '.ep-root .docx-nav__stepper',
    ]) {
      expect(selectors.has(selector), selector).toBe(true);
    }
  });
});
