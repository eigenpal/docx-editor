import { expect, test } from 'bun:test';
import { disablesMaxLines } from '../lib/max-lines-directives.mjs';

test('a file-level directive naming max-lines, or no rule, turns max-lines off', () => {
  for (const header of [
    '/* eslint-disable max-lines -- composition root */',
    '/* oxlint-disable max-lines */',
    '// eslint-disable max-lines',
    '// oxlint-disable no-console, max-lines -- a reason',
    '/* eslint-disable */',
    '// oxlint-disable',
  ]) {
    expect(disablesMaxLines(`${header}\nexport const a = 1;\n`)).toBe(true);
  }
});

test('a directive for other rules, or for one line, leaves max-lines on', () => {
  for (const header of [
    '/* eslint-disable no-console -- a command-line report */',
    '// oxlint-disable react-hooks/rules-of-hooks',
    '// eslint-disable-next-line max-lines',
    '/* eslint-disable-line max-lines */',
    '// a comment that mentions max-lines',
  ]) {
    expect(disablesMaxLines(`${header}\nexport const a = 1;\n`)).toBe(false);
  }
});
