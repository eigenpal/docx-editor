// The caret must be ON the instant it moves (interactive-paginated-editing).
//
// `.ep-one-surface__caret` runs a free-running 1.06s blink that is fully transparent for
// half its period. Nothing resets it, so a click landing in the OFF half painted nothing for
// up to ~530 ms — indistinguishable from a broken caret, and the reference deployment shows
// the caret immediately on every click.
//
// Both adapters fix it the same way, by KEYING the caret element on its position so the
// element is replaced when the caret moves and the animation restarts from 0%. This asserts
// the keys exist and agree, because the two adapters must not diverge here and a missing key
// is invisible to every other test.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const REACT = read('../../react/src/paintDisplay.tsx');
const VUE = read('../../vue/src/paintDisplay.ts');
const CSS = read('../../core/src/styles/editor.css');

describe('caret blink restarts when the caret moves', () => {
  test('the blink really does have a fully transparent phase', () => {
    // If this stops being true the keying below is unnecessary rather than load-bearing.
    const keyframes = /@keyframes\s+ep-caret-blink\s*\{([^}]*\}[^}]*)\}/.exec(CSS);
    expect(keyframes).not.toBeNull();
    expect(keyframes![1]).toMatch(/opacity:\s*0/);
  });

  test('React keys the caret on its position', () => {
    const block = /className=\{`ep-one-surface__caret[\s\S]{0,400}?\/>/.exec(REACT);
    expect(REACT).toMatch(/key=\{`caret\.\$\{caret\.pageIndex\}\.\$\{caret\.rect\.x\}\.\$\{caret\.rect\.y\}`\}/);
    expect(block).not.toBeNull();
  });

  test('Vue keys the caret on its position, identically', () => {
    expect(VUE).toMatch(/key: `caret\.\$\{caret\.pageIndex\}\.\$\{caret\.rect\.x\}\.\$\{caret\.rect\.y\}`/);
  });

  test('both adapters use the SAME key expression', () => {
    const shape = /caret\.\$\{caret\.pageIndex\}\.\$\{caret\.rect\.x\}\.\$\{caret\.rect\.y\}/;
    expect(shape.test(REACT)).toBe(true);
    expect(shape.test(VUE)).toBe(true);
  });
});
