// The shipped stylesheet is minified, so scripts/core-css-assertions.mjs has to hold
// on a MINIFIED file. That put `normalizeSelector` on the critical path: it folds the
// rewrites cssnano performs so an assertion written in readable form still matches.
//
// A fold that is too STRICT fails the build loudly, so the build itself covers that
// direction. A fold that is too LOOSE fails nothing — it would quietly let a wrong
// file pass. Both directions are pinned here instead.
//
// The folds are pinned against what cssnano ACTUALLY emits, not against a reading of
// its docs, because the whole point of the function is to track a specific minifier.
import { describe, expect, test } from 'bun:test';
import postcss from 'postcss';
import cssnano from 'cssnano';
import { coreCssProblems, normalizeSelector } from '../core-css-assertions.mjs';

/** The exact minifier configuration scripts/build-core-styles.mjs ships with. */
const minify = (css: string): Promise<string> =>
  postcss([cssnano({ preset: ['default'] })])
    .process(css, { from: undefined })
    .then((result) => result.css);

/** A minimal file that satisfies every positive assertion. */
const VALID = [
  '.docx-editor .flex{display:flex}',
  ".docx-editor [contenteditable='true']{caret-color:transparent}",
  '.docx-editor{--doc-bg:#fff}',
].join('');

describe('normalizeSelector tracks what cssnano emits', () => {
  // Each of these is a selector cssnano rewrites. Folding them is the only reason an
  // assertion can be written in the readable form on the left.
  const rewritten = [
    '.a *.b',
    '.a *[data-x]',
    '.a *#id',
    '.a *:hover',
    '.a *::selection',
    '.a::after',
    '.a::before',
    '.a::first-line',
    '.a::first-letter',
    '.a  >  .b',
    ".a[data-x='y']",
  ];

  test.each(rewritten)('%s folds to the same shape cssnano emits', async (selector) => {
    const emitted = await minify(`${selector}{color:red}`);
    const [minified] = emitted.split('{');
    expect(normalizeSelector(selector)).toBe(normalizeSelector(minified));
  });

  // The other direction: a fold that swallowed too much would collapse selectors that
  // match DIFFERENT elements into one key, and a positive assertion would then pass
  // against a file that does not contain the rule it names.
  const distinct: ReadonlyArray<readonly [string, string]> = [
    ['.a .b', '.a>.b'],
    ['.a *', '.a'],
    ['.a[data-x*=y]', '.a[data-x=y]'],
    ['.a::selection', '.a ::selection'],
    ['.docx-editor .flex', '.docx-editor .flex-1'],
  ];

  test.each(distinct)('%s and %s stay distinct', (left, right) => {
    expect(normalizeSelector(left)).not.toBe(normalizeSelector(right));
  });

  test('a bare universal survives, because nothing implies it', () => {
    expect(normalizeSelector('.a *')).toBe('.a *');
  });
});

describe('coreCssProblems holds on the minified file', () => {
  test('accepts a valid file both pretty-printed and minified', async () => {
    expect(coreCssProblems(VALID)).toEqual([]);
    expect(coreCssProblems(await minify(VALID))).toEqual([]);
  });

  // Every rejection is asserted on the MINIFIED file. Checking only the readable form
  // would miss a fold that made the assertion vacuous against what actually ships.
  const bad: ReadonlyArray<readonly [string, string]> = [
    ['an empty file', ''],
    ['a raw @tailwind directive', `@tailwind utilities;${VALID}`],
    ['a bare type selector', `${VALID}a{color:red}`],
    ['a :root block', `${VALID}:root{--x:1}`],
    ['an unowned class', `${VALID}.btn{padding:0}`],
    ['an unanchored rule inside @media', `${VALID}@media (min-width:40px){.btn{padding:0}}`],
    ['a global @keyframes name', `${VALID}@keyframes enter{from{opacity:0}}`],
  ];

  test.each(bad)('rejects %s', async (_name, css) => {
    expect(coreCssProblems(await minify(css)).length).toBeGreaterThan(0);
  });

  // The positive half has to be able to fail, or an empty-but-clean file would pass.
  const missing: ReadonlyArray<readonly [string, string]> = [
    ['the scoped utilities', VALID.replace('.docx-editor .flex{display:flex}', '')],
    [
      'the [contenteditable] caret rule',
      VALID.replace(".docx-editor [contenteditable='true']{caret-color:transparent}", ''),
    ],
    ['the --doc-* tokens', VALID.replace('--doc-bg:#fff', 'color:red')],
  ];

  test.each(missing)('rejects a file missing %s', async (_name, css) => {
    expect(coreCssProblems(await minify(css)).length).toBeGreaterThan(0);
  });
});
