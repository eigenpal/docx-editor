// Layout authority guards (task 7.6).
//
// The rule the architecture rests on: LAYOUT publishes geometry and OUTPUT paints it. If
// output could measure, the DOM would become a second source of geometry, the two would
// drift, and the caret would land where no glyph is. An import graph cannot express that —
// `getBoundingClientRect` needs no import — so this checks for the calls themselves.
//
// Equally, layout must not read the DOM: it is the lane that has to run headless, and a
// single `document.` reference would make it browser-only without anything failing.

import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existingLanePath } from './lane-paths.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGES = join(HERE, '..', '..');
const REPO = join(PACKAGES, '..');

function collectSources(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(root, entry);
    if (statSync(full).isDirectory()) out.push(...collectSources(full));
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/** Comments explain these rules by naming the very calls they forbid. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** Ways to ask the browser how big something is. */
const REMEASUREMENT: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /\bgetBoundingClientRect\b/, why: 'element geometry read back from the DOM' },
  { pattern: /\bgetClientRects\b/, why: 'element geometry read back from the DOM' },
  { pattern: /\boffset(Width|Height|Top|Left)\b/, why: 'layout read back from the DOM' },
  { pattern: /\bclient(Width|Height)\b/, why: 'layout read back from the DOM' },
  { pattern: /\bscroll(Width|Height)\b/, why: 'layout read back from the DOM' },
  { pattern: /\bgetComputedStyle\b/, why: 'resolved style read back from the DOM' },
  { pattern: /\bmeasureText\b/, why: 'canvas text metrics' },
  { pattern: /\bcaretRangeFromPoint\b|\bcaretPositionFromPoint\b/, why: 'DOM hit testing' },
];

/** Ways to build DOM from a string. */
const HTML_FROM_STRING: readonly RegExp[] = [
  /\binnerHTML\b/,
  /\bouterHTML\b/,
  /\binsertAdjacentHTML\b/,
  /document\s*\.\s*write\b/,
];

function findAll(source: string, patterns: readonly { pattern: RegExp; why: string }[]): string[] {
  const code = stripComments(source);
  const found: string[] = [];
  for (const entry of patterns) if (entry.pattern.test(code)) found.push(entry.why);
  return [...new Set(found)];
}

describe('semantic layout is the only geometry authority (task 7.6)', () => {
  test('the semantic painter never measures anything back', () => {
    const file = existingLanePath('engine-output/src/semantic-paint.ts');
    const offenders = findAll(readFileSync(file, 'utf8'), REMEASUREMENT);
    expect(offenders).toEqual([]);
  });

  test('the semantic layout and interaction lanes never read the DOM', () => {
    // They must run headless: that is what makes layout testable without a browser and
    // interaction answerable on a server.
    const files = [
      'engine-layout/src/semantic-layout.ts',
      'engine-layout/src/semantic-records.ts',
      'engine-layout/src/semantic-interaction.ts',
      'engine-layout/src/run-style.ts',
    ];
    for (const relativePath of files) {
      const code = stripComments(readFileSync(existingLanePath(relativePath), 'utf8'));
      expect({ [relativePath]: /\bdocument\s*\.|window\s*\.|\bHTMLElement\b/.test(code) }).toEqual({
        [relativePath]: false,
      });
      expect({ [relativePath]: findAll(code, REMEASUREMENT) }).toEqual({ [relativePath]: [] });
    }
  });

  test('no output module builds DOM from an HTML string', () => {
    const offenders: string[] = [];
    for (const file of collectSources(existingLanePath('engine-output/src'))) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const pattern of HTML_FROM_STRING) {
        if (pattern.test(code)) offenders.push(`${relative(REPO, file)}: ${pattern.source}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the canonical model lane never reads the DOM either', () => {
    // Store and save must be usable headless and must not acquire a browser dependency by
    // accident; `engine-core` has no DOM lib, but a bare `document.` would still compile in
    // a file that declared its own.
    const offenders: string[] = [];
    for (const file of collectSources(existingLanePath('engine-core/src'))) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (/\bdocument\s*\.\s*(createElement|querySelector|body)\b/.test(code)) {
        offenders.push(relative(REPO, file));
      }
      if (findAll(code, REMEASUREMENT).length > 0) offenders.push(relative(REPO, file));
    }
    expect(offenders).toEqual([]);
  });

  test('the guard detects a violation, so it cannot pass by scanning nothing', () => {
    expect(findAll('const r = el.getBoundingClientRect();', REMEASUREMENT)).toEqual([
      'element geometry read back from the DOM',
    ]);
    expect(findAll('const w = node.offsetWidth;', REMEASUREMENT)).toEqual([
      'layout read back from the DOM',
    ]);
    // A comment naming the call is not a violation.
    expect(findAll('// never call getBoundingClientRect here\nconst x = 1;', REMEASUREMENT)).toEqual(
      []
    );
    // And the corpus is real.
    expect(collectSources(existingLanePath('engine-output/src')).length).toBeGreaterThan(3);
  });

  test('the ADAPTER lane may still measure, so the guard is not vacuous', () => {
    // React and Vue legitimately read viewport geometry for scrolling and overlays. If they
    // were clean too, these tests would pass because measurement had been removed
    // everywhere rather than confined to where it belongs.
    const adapters = [
      ...collectSources(existingLanePath('react/src')),
      ...collectSources(existingLanePath('engine-editor/src')),
    ];
    const measuring = adapters.filter(
      (file) => findAll(readFileSync(file, 'utf8'), REMEASUREMENT).length > 0
    );
    expect(measuring.length).toBeGreaterThan(0);
  });
});
