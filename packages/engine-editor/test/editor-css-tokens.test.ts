// Every `--doc-*` token a stylesheet CONSUMES must also be DEFINED (interactive-paginated-editing).
//
// `.ep-one-surface__caret { background: var(--doc-caret) }` shipped with `--doc-caret`
// declared only inside the dark-mode block, so in the default theme it resolved to nothing
// and the caret painted as a 1px transparent div: correctly positioned, visible, blinking,
// and completely invisible. A missing custom property fails silently — `var()` with no
// fallback yields the guaranteed-invalid value and the declaration is simply dropped — so
// nothing in the type system or the test suite could catch it.
//
// This pins the whole class: parse the stylesheet, collect what it defines and what it
// reads, and require the second to be a subset of the first.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CSS = readFileSync(
  fileURLToPath(new URL('../../core/src/styles/editor.css', import.meta.url)),
  'utf8',
);

/** Strip comments so a token named inside prose is not mistaken for a declaration. */
const withoutComments = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

function declaredTokens(source: string): Set<string> {
  return new Set([...source.matchAll(/(--doc-[\w-]+)\s*:/g)].map((m) => m[1]!));
}

function consumedTokens(source: string): Map<string, boolean> {
  // value -> whether every use of it supplies a fallback.
  const out = new Map<string, boolean>();
  for (const match of source.matchAll(/var\(\s*(--doc-[\w-]+)\s*(,)?/g)) {
    const name = match[1]!;
    const hasFallback = match[2] === ',';
    out.set(name, (out.get(name) ?? true) && hasFallback);
  }
  return out;
}

describe('editor stylesheet custom properties', () => {
  test('every consumed --doc-* token is declared, or always has a fallback', () => {
    const declared = declaredTokens(withoutComments);
    const consumed = consumedTokens(withoutComments);
    const missing = [...consumed.entries()]
      .filter(([name, alwaysHasFallback]) => !declared.has(name) && !alwaysHasFallback)
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  test('--doc-caret is declared for the DEFAULT theme, not only for dark', () => {
    // The specific regression: declared once, inside the dark block.
    const darkBlockStart = withoutComments.search(/\.ep-root\.dark|\[data-theme=['"]dark['"]\]|prefers-color-scheme:\s*dark/);
    const beforeDark = darkBlockStart === -1 ? withoutComments : withoutComments.slice(0, darkBlockStart);
    expect(declaredTokens(beforeDark).has('--doc-caret')).toBe(true);
  });

  test('the caret rule paints a colour rather than relying on a default', () => {
    const rule = /\.ep-one-surface__caret\s*\{([^}]*)\}/.exec(withoutComments);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/background:\s*var\(--doc-caret/);
    expect(rule![1]).toMatch(/width:\s*1px/);
  });
});
