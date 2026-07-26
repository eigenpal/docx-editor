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

/**
 * The stylesheet up to the first dark-mode block.
 *
 * NOT a general "default theme" slice, and the difference matters. Review pointed out that
 * the whole-file check below cannot catch the original defect — `--doc-caret` declared only
 * inside `.ep-root.dark` — and suggested applying this slice to it. That does not work on
 * this stylesheet: plenty of ordinary default-theme declarations sit AFTER the dark block
 * (`--doc-page-gap: 24px` at ~1387, `--doc-page-bg`), so the slice reports them missing.
 * Verified by trying it: two false positives immediately.
 *
 * Catching the class properly needs scope-aware parsing — resolving which declarations are
 * reachable without a dark selector — not a positional cut. Until then the general check
 * stays whole-file (it catches a token that is declared NOWHERE, which is a real class) and
 * the dark-only class is covered per token, explicitly, below. That is a narrower guarantee
 * than the file header implies, so it is stated here rather than left to be discovered.
 */
const DARK_BLOCK = /\.ep-root\.dark|\[data-theme=['"]dark['"]\]|prefers-color-scheme:\s*dark/;

function defaultThemeSource(source: string): string {
  const darkAt = source.search(DARK_BLOCK);
  return darkAt === -1 ? source : source.slice(0, darkAt);
}

describe('editor stylesheet custom properties', () => {
  test('every consumed --doc-* token is declared somewhere, or always has a fallback', () => {
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
