// What the runtime is allowed to depend on.
//
// Three claims, and each of them decays silently if nothing checks it:
//
// NEUTRAL — the lifecycle (queue, context, object paths, errors) runs where there is no browser,
// so a server can use it. One convenience import of the editor subpath and a headless consumer is
// bundling a paginated layout engine.
// PROTOCOL ONLY — the runtime talks to the engine through the public automation host and nothing
// else. An import of a store or tree module would make this a second document model, which is the
// exact thing core's automation lane exists to make unnecessary.
// NOTHING MICROSOFT — DocxEditor owns every type in its public surface. A dependency on upstream
// declarations would turn "compatible with" into "derived from", which is a licensing statement as
// much as a technical one.
//
// The checks are of three kinds because each catches what the others cannot: DECLARED (a tsconfig
// whose `lib` omits DOM, so a DOM reference fails to COMPILE), REACHED (the import graph, followed
// the way a bundler follows it), and WRITTEN (a scan for the sinks the repository audits).

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { typecheckProject } from '../../../scripts/lib/typecheck-compat.mjs';

const RUNTIME = join(import.meta.dir, '..');
const PACKAGE_SRC = join(RUNTIME, '..');
/** The object model: a sibling directory, the same shipped lane, the same rules. */
const MODEL = join(PACKAGE_SRC, 'model');
/** The package's two published entry points, which live at the root of `src`. */
const ENTRIES = [join(PACKAGE_SRC, 'index.ts'), join(PACKAGE_SRC, 'browser.ts')];
const LANE = [RUNTIME, MODEL];

/**
 * Every SHIPPED source file of the lane — the two entries and the examples included, tests and
 * the conformance assertions excluded. `__conformance__` reads `compat/` on purpose; it is
 * compiled, never bundled, and the test at the bottom of this file holds that line.
 */
function runtimeFiles(directories: readonly string[] = LANE): string[] {
  const out: string[] = directories === LANE ? [...ENTRIES] : [];
  for (const directory of directories) {
    for (const entry of readdirSync(directory)) {
      if (entry === '__tests__' || entry === '__conformance__' || entry === '__typings__') continue;
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) out.push(...runtimeFiles([path]));
      else if (entry.endsWith('.ts')) out.push(path);
    }
  }
  return out;
}

/**
 * The modules that must stay neutral: everything except the browser adapter and the entry that
 * publishes it. `src/index.ts` — the entry a server imports — is deliberately NOT on this list.
 */
const BROWSER_MODULES = new Set([join('runtime', 'browser.ts'), 'browser.ts']);

function isNeutral(file: string): boolean {
  return !BROWSER_MODULES.has(relative(PACKAGE_SRC, file));
}

const IMPORT = /(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s*['"]([^'"]+)['"]/g;

function specifiersOf(file: string): string[] {
  const found: string[] = [];
  for (const match of readFileSync(file, 'utf8').matchAll(IMPORT)) {
    if (match[1]) found.push(match[1]);
  }
  return found;
}

function bareSpecifiers(files: readonly string[]): string[] {
  const bare = new Set<string>();
  for (const file of files) {
    for (const specifier of specifiersOf(file)) {
      if (!specifier.startsWith('.')) bare.add(specifier);
    }
  }
  return [...bare].sort();
}

/** Source with comments removed, so prose about documents is not read as a DOM reference. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line.replace(/([^:])\/\/.*$/, '$1')))
    .join('\n');
}

/**
 * Comment-free and string-free source.
 *
 * The proxy paths this API reports back to callers are spelled `document.body.paragraphs`, because
 * that is what the caller wrote. Those labels are data. Scanning them for global references would
 * find one in every error message.
 */
function codeOnly(source: string): string {
  return (
    withoutComments(source)
      // Template literals keep their interpolations — `${document.title}` is code, not a label.
      .replace(/`(?:\\.|[^`\\])*`/g, (literal) =>
        [...literal.matchAll(/\$\{([^{}]*)\}/g)].map((match) => match[1]).join(';')
      )
      .replace(/'(?:\\.|[^'\\])*'/g, "''")
      .replace(/"(?:\\.|[^"\\])*"/g, '""')
  );
}

/** The tsconfigs are JSONC — they carry the reasoning for their own settings. */
function readProject(path: string): { compilerOptions?: { lib?: string[] }; include?: string[] } {
  return JSON.parse(withoutComments(readFileSync(path, 'utf8')));
}

describe('what the runtime imports', () => {
  const files = runtimeFiles();

  test('the scan found the lane, so the assertions below are about something', () => {
    expect(files.length).toBeGreaterThanOrEqual(12);
    const names = files.map((file) => relative(PACKAGE_SRC, file));
    expect(names).toContain('index.ts');
    expect(names).toContain('browser.ts');
    expect(names).toContain(join('runtime', 'request-context.ts'));
    expect(names).toContain(join('runtime', 'browser.ts'));
    expect(names).toContain(join('model', 'document.ts'));
  });

  test('the neutral modules import the automation protocol and nothing else', () => {
    expect(bareSpecifiers(files.filter(isNeutral))).toEqual([
      '@docx-editor.dev/core-contract/automation',
    ]);
  });

  test('exactly one module names the editor lane', () => {
    const reaching = files
      .filter((file) => specifiersOf(file).includes('@docx-editor.dev/core-contract/editor'))
      .map((file) => relative(PACKAGE_SRC, file));
    expect(reaching).toEqual([join('runtime', 'browser.ts')]);
  });

  test('the entry a server imports does not reach the editor lane, at any depth', () => {
    // Followed the way a bundler follows it: the root entry must not have `runtime/browser.ts`
    // anywhere beneath it, or the package root ships the painted engine.
    const seen = new Set<string>();
    const walk = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const specifier of specifiersOf(file)) {
        if (!specifier.startsWith('.')) continue;
        const target = resolve(dirname(file), specifier);
        if (existsSync(target)) walk(target);
      }
    };
    walk(join(PACKAGE_SRC, 'index.ts'));
    const reached = [...seen].map((file) => relative(PACKAGE_SRC, file));
    expect(reached).toContain(join('runtime', 'server.ts'));
    expect(reached).not.toContain(join('runtime', 'browser.ts'));
    expect(reached).not.toContain('browser.ts');
  });

  test('the browser entry reaches the browser adapter, so that check is not vacuous', () => {
    expect(specifiersOf(join(PACKAGE_SRC, 'browser.ts'))).toContain('./runtime/browser.ts');
  });

  test('no store, tree, layout or binding module is reachable, by any spelling', () => {
    const forbidden = ['/store', '/layout', '/binding', '/output', '/contracts', '/headless'];
    const hits = bareSpecifiers(files).filter((specifier) =>
      forbidden.some((fragment) => specifier.includes(fragment))
    );
    expect(hits).toEqual([]);
  });

  test('no relative import escapes the lane', () => {
    // The lane is the two entries, the runtime and the object model built on it. Nothing else is
    // left in this package, and an import that reached outside it would be reaching for something
    // the cutover deleted.
    const escapes: string[] = [];
    for (const file of files) {
      for (const specifier of specifiersOf(file)) {
        if (!specifier.startsWith('.')) continue;
        const target = resolve(dirname(file), specifier);
        if (!LANE.some((directory) => target.startsWith(directory))) {
          escapes.push(`${relative(PACKAGE_SRC, file)} -> ${specifier}`);
        }
      }
    }
    expect(escapes).toEqual([]);
  });

  test('no Microsoft package, and no upstream declaration bundle', () => {
    const microsoft = bareSpecifiers(files).filter((specifier) =>
      /office|microsoft|word-js/i.test(specifier)
    );
    expect(microsoft).toEqual([]);
  });

  test('no framework and no Node builtin anywhere in the runtime', () => {
    const specifiers = bareSpecifiers(files);
    expect(specifiers.filter((name) => name.startsWith('node:'))).toEqual([]);
    expect(
      specifiers.filter((name) =>
        ['react', 'react-dom', 'vue', 'jszip', 'docxtemplater', 'ai'].some(
          (forbidden) => name === forbidden || name.startsWith(`${forbidden}/`)
        )
      )
    ).toEqual([]);
  });

  test('the detection would FIRE on a graph that did contain those things', () => {
    // The control. Every assertion above passes, and a check that can only pass is
    // indistinguishable from one that cannot fail.
    const pretend = [
      'node:fs',
      'react',
      '@types/office-js',
      '@docx-editor.dev/core-contract/store',
    ];
    expect(pretend.filter((name) => name.startsWith('node:'))).toEqual(['node:fs']);
    expect(pretend.filter((name) => /office|microsoft/i.test(name))).toEqual(['@types/office-js']);
    expect(pretend.filter((name) => name.includes('/store'))).toEqual([
      '@docx-editor.dev/core-contract/store',
    ]);
  });
});

describe('what the neutral modules may mention', () => {
  const neutral = runtimeFiles().filter(isNeutral);

  test('no DOM global, in code or behind a type', () => {
    // The lookbehinds matter: `context.document` is this API's own root proxy, and a check that
    // cannot tell it from the DOM's `document` would either fail forever or be deleted.
    const patterns = [
      /(?<![.#\w$])document\s*\./,
      /(?<![.#\w$])window\s*\./,
      /(?<![.#\w$])globalThis\b/,
      /\bHTML[A-Z]\w*Element\b/,
      /(?<![.#\w$])navigator\b/,
      /(?<![.#\w$])localStorage\b/,
    ];
    const hits: string[] = [];
    for (const file of neutral) {
      const source = codeOnly(readFileSync(file, 'utf8'));
      for (const pattern of patterns) {
        if (pattern.test(source)) hits.push(`${relative(RUNTIME, file)} ${String(pattern)}`);
      }
    }
    expect(hits).toEqual([]);
  });

  test('the DOM scan reads code and not labels, and still FIRES on code', () => {
    expect(codeOnly("const label = 'document.body';")).not.toContain('document.');
    expect(codeOnly('const title = document.title;')).toContain('document.');
    expect(codeOnly('const t = `${document.title}`;')).toContain('document.');
  });

  test('no HTML-from-strings sink, no fetch, no dynamic evaluation, anywhere in the runtime', () => {
    // Same list the repository's own audit grep uses, plus the evaluation and network sinks. A
    // proxy runtime carries file-derived strings (paragraph text, handle labels) end to end, so the
    // rule is that it hands them to no sink at all: it returns them.
    const sinks = [
      /\binnerHTML\b/,
      /\bouterHTML\b/,
      /\binsertAdjacentHTML\b/,
      /\bdocument\s*\.\s*write\b/,
      /\bwindow\s*\.\s*open\s*\(/,
      /\bXMLHttpRequest\b/,
      /\bimportScripts\s*\(/,
      /(?<![.#\w$])eval\s*\(/,
      /\bnew\s+Function\b/,
      /(?<![.#\w$])fetch\s*\(/,
      // CommonJS only: `this.#require(...)` is a private method, not a module loader.
      /(?<![.#\w$])require\s*\(/,
    ];
    const hits: string[] = [];
    for (const file of runtimeFiles()) {
      const source = withoutComments(readFileSync(file, 'utf8'));
      for (const sink of sinks) {
        if (sink.test(source)) hits.push(`${relative(RUNTIME, file)} ${String(sink)}`);
      }
    }
    expect(hits).toEqual([]);
  });

  test('the sink scan would FIRE on source that did contain one', () => {
    const pretend = withoutComments(
      [
        '// innerHTML in a comment is fine',
        'el.innerHTML = value;',
        'const x = require("fs");',
      ].join('\n')
    );
    expect(/\binnerHTML\b/.test(pretend)).toBe(true);
    expect(/(?<![.#\w$])require\s*\(/.test(pretend)).toBe(true);
    expect(/(?<![.#\w$])require\s*\(/.test('this.#require(one);')).toBe(false);
  });
});

describe('the claims that are compiled rather than scanned', () => {
  const neutralProject = join(RUNTIME, 'tsconfig.neutral.json');
  const fullProject = join(RUNTIME, 'tsconfig.json');

  test('the neutral project exists and its lib omits DOM', () => {
    expect(existsSync(neutralProject)).toBe(true);
    const lib = readProject(neutralProject).compilerOptions?.lib ?? [];
    expect(lib.length).toBeGreaterThan(0);
    expect(lib.some((entry) => entry.toLowerCase().includes('dom'))).toBe(false);
  });

  test('the neutral project compiles with zero diagnostics, without the DOM lib', () => {
    expect(typecheckProject(neutralProject)).toEqual([]);
  });

  test('the whole runtime, browser entry included, compiles with zero diagnostics', () => {
    expect(typecheckProject(fullProject)).toEqual([]);
  });

  test('the conformance assertions are compiled but never shipped', () => {
    // They import `compat/` — fine for a compiler, wrong for a bundle. Neither shipped entry may
    // reach them, and neither lane project may include them.
    const shipped = [
      join(PACKAGE_SRC, 'index.ts'),
      join(PACKAGE_SRC, 'browser.ts'),
      join(RUNTIME, 'public.ts'),
    ];
    for (const file of shipped) {
      expect(readFileSync(file, 'utf8')).not.toContain('__conformance__');
    }
    for (const project of [neutralProject, fullProject]) {
      const include = readProject(project).include ?? [];
      expect(include.some((pattern) => pattern.includes('__conformance__'))).toBe(false);
    }
    expect(existsSync(join(RUNTIME, '__conformance__', 'declared-lifecycle.ts'))).toBe(true);
  });

  test('both projects include the whole lane, and neither drags in the rest of the package', () => {
    /** The object model and the entry points sit above the runtime, so they are reached with `..`. */
    const ABOVE = new Set(['../model/*.ts', '../index.ts', '../browser.ts']);
    for (const project of [neutralProject, fullProject]) {
      const include = readProject(project).include ?? [];
      expect(include.length).toBeGreaterThan(0);
      expect(include).toContain('../model/*.ts');
      // The root entry is in BOTH: the entry a server imports is the one most worth proving
      // neutral, and it is the browser entry alone that the neutral project excludes.
      expect(include).toContain('../index.ts');
      expect(include.filter((pattern) => pattern.includes('..') && !ABOVE.has(pattern))).toEqual(
        []
      );
    }
    expect(readProject(neutralProject).include).not.toContain('../browser.ts');
    expect(readProject(fullProject).include).toContain('../browser.ts');
  });
});
