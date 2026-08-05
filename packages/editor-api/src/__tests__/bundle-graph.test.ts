/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// What each published entry actually pulls in, followed the way a bundler follows it.
//
// `runtime/__tests__/runtime-boundaries.test.ts` scans this package's OWN lane. That is not the
// same question. The build inlines the private contract package, so what ships in
// `dist/index.mjs` is this package's source PLUS whatever of `packages/core` it reaches — and a
// single `export *` inside core is enough to put the painted engine, its font shaper and a
// ProseMirror binding into a bundle a server imports, while every file in `packages/editor-api/src`
// still looks neutral.
//
// So this walk crosses the workspace boundary. It resolves `@docx-editor.dev/core/*`
// through core's own `exports` map rather than by guessing directory names, so a lane that moves
// is still followed instead of silently ending the walk.

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const PACKAGE_SRC = join(import.meta.dir, '..');
const CORE = join(PACKAGE_SRC, '..', '..', 'core');

const CORE_EXPORTS = JSON.parse(readFileSync(join(CORE, 'package.json'), 'utf8')).exports as Record<
  string,
  { import: string } | string
>;

/**
 * Every importable core specifier, mapped to the source file it resolves to.
 *
 * Conditional exports only. A subpath declared as a bare string is an asset rather than a
 * module entry — the stylesheet and `./package.json` — and there is no import graph to walk
 * from one, so it is not a specifier this test has anything to say about.
 */
const WORKSPACE = new Map<string, string>(
  Object.entries(CORE_EXPORTS)
    .filter((entry): entry is [string, { import: string }] => typeof entry[1] === 'object')
    .map(([subpath, target]) => [
      subpath === '.' ? '@docx-editor.dev/core' : `@docx-editor.dev/core${subpath.slice(1)}`,
      resolve(CORE, target.import),
    ])
);

const IMPORT = /(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s*['"]([^'"]+)['"]/g;
const DYNAMIC = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiersOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const found: string[] = [];
  for (const match of source.matchAll(IMPORT)) if (match[1]) found.push(match[1]);
  // Dynamic too. The font shaper is loaded by the layout pass through `await import(...)`, so a
  // walk that only read static imports could report a bundle as shaper-free while it ships one.
  for (const match of source.matchAll(DYNAMIC)) if (match[1]) found.push(match[1]);
  return found;
}

function resolveFile(candidate: string): string | null {
  for (const suffix of ['', '.ts', '.tsx', '/index.ts']) {
    const path = `${candidate}${suffix}`;
    if (path.endsWith('/')) continue;
    try {
      if (existsSync(path) && readFileSync(path).length >= 0) return path;
    } catch {
      // A directory: fall through to the index candidate.
    }
  }
  return null;
}

interface Reach {
  /** Source files reached, absolute. */
  readonly files: ReadonlySet<string>;
  /** Core subpaths reached, by specifier. */
  readonly lanes: ReadonlySet<string>;
  /** Third-party specifiers reached. */
  readonly external: ReadonlySet<string>;
}

function reachFrom(entry: string): Reach {
  const files = new Set<string>();
  const lanes = new Set<string>();
  const external = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);

    for (const specifier of specifiersOf(file)) {
      if (specifier.startsWith('.')) {
        const resolved = resolveFile(resolve(dirname(file), specifier.replace(/\.tsx?$/, '')));
        if (resolved) queue.push(resolved);
        continue;
      }
      // LONGEST match first: every lane specifier starts with the package's own name, and a
      // shortest-match walk would resolve `.../core/editor` to core's root barrel.
      const lane = [...WORKSPACE.keys()]
        .sort((a, b) => b.length - a.length)
        .find((name) => specifier === name || specifier.startsWith(`${name}/`));
      if (lane) {
        lanes.add(lane);
        queue.push(WORKSPACE.get(lane)!);
        continue;
      }
      external.add(specifier);
    }
  }
  return { files, lanes, external };
}

const server = reachFrom(join(PACKAGE_SRC, 'index.ts'));
const browser = reachFrom(join(PACKAGE_SRC, 'browser.ts'));

/** The names that mean "this bundle contains a browser editor". */
const EDITOR_RUNTIME = ['harfbuzzjs', 'prosemirror-model', 'prosemirror-state', 'prosemirror-view'];
/** The names that mean "this bundle contains a server transport". */
const SERVER_TRANSPORT = ['node:net', 'node:http', 'node:https', 'node:child_process', 'ws'];

describe('the walk itself', () => {
  test('reaches real files across the workspace boundary, so the checks are not vacuous', () => {
    // Every assertion below is an absence. An absence over an empty graph is worth nothing.
    expect(server.files.size).toBeGreaterThan(20);
    expect(browser.files.size).toBeGreaterThan(server.files.size);
    expect([...server.lanes]).toContain('@docx-editor.dev/core/automation');
    expect([...browser.lanes]).toContain('@docx-editor.dev/core/editor');
    expect([...server.files].some((file) => file.startsWith(CORE))).toBe(true);
  });

  test('the same detection FIRES on a graph that does contain what is forbidden', () => {
    // Every check below is `filter(...)` against one of these lists, so the control has to prove
    // the filter can return something. A synthetic set does that without depending on which
    // third-party names the real graph happens to reach this week.
    const pretend = new Set([...server.external, 'harfbuzzjs', 'node:net', 'react']);
    expect(EDITOR_RUNTIME.filter((name) => pretend.has(name))).toEqual(['harfbuzzjs']);
    expect(SERVER_TRANSPORT.filter((name) => pretend.has(name))).toEqual(['node:net']);
    expect(['react', 'vue'].filter((name) => pretend.has(name))).toEqual(['react']);
  });
});

describe('the server bundle', () => {
  test('does not reach the editor lane, the layout lane or the PM binding', () => {
    const forbidden = ['/editor', '/layout', '/binding', '/output'];
    const reached = [...server.lanes].filter((lane) =>
      forbidden.some((fragment) => lane.endsWith(fragment))
    );
    expect(reached).toEqual([]);
  });

  test('contains no font shaper and no editor runtime', () => {
    expect(EDITOR_RUNTIME.filter((name) => server.external.has(name))).toEqual([]);
  });

  test('contains no UI framework', () => {
    const frameworks = ['react', 'react-dom', 'vue', '@vue/runtime-core'];
    expect(frameworks.filter((name) => server.external.has(name))).toEqual([]);
  });

  test('names no Node builtin, so it runs in a worker as well as on a server', () => {
    expect([...server.external].filter((name) => name.startsWith('node:'))).toEqual([]);
  });

  test('names no DOM global, at any depth', () => {
    // `context.document` is this API's own root proxy, so the lookbehind matters: a check that
    // could not tell it from the DOM's `document` would fail forever and then be deleted.
    const patterns = [
      /(?<![.#\w$])document\s*\./,
      /(?<![.#\w$])window\s*\./,
      /\bHTML[A-Z]\w*Element\b/,
      /(?<![.#\w$])navigator\s*\./,
    ];
    const hits: string[] = [];
    for (const file of server.files) {
      const source = codeOnly(readFileSync(file, 'utf8'));
      for (const pattern of patterns) {
        if (pattern.test(source)) hits.push(`${relative(PACKAGE_SRC, file)} ${String(pattern)}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('the browser bundle', () => {
  test('reaches the editor, which is the point of it existing separately', () => {
    // Stated as lanes and file count rather than as third-party names on purpose. The editor lane
    // is reached — that is what makes this entry different from the root — but WHICH third-party
    // names come with it is the engine's business and changes as the engine drops dependencies.
    expect([...browser.lanes]).toContain('@docx-editor.dev/core/editor');
    expect(browser.files.size).toBeGreaterThan(server.files.size);
    expect([...browser.files].filter((file) => !server.files.has(file)).length).toBeGreaterThan(5);
  });

  test('carries no server transport and no Node builtin', () => {
    expect(SERVER_TRANSPORT.filter((name) => browser.external.has(name))).toEqual([]);
    expect([...browser.external].filter((name) => name.startsWith('node:'))).toEqual([]);
  });

  test('carries no UI framework, so it does not pick a host for the consumer', () => {
    const frameworks = ['react', 'react-dom', 'vue'];
    expect(frameworks.filter((name) => browser.external.has(name))).toEqual([]);
  });
});

describe('neither bundle', () => {
  test('reaches a Microsoft package or an upstream declaration bundle', () => {
    for (const reach of [server, browser]) {
      expect([...reach.external].filter((name) => /office|microsoft|word-js/i.test(name))).toEqual(
        []
      );
    }
  });

  test('reaches an AI SDK, an MCP transport or a document templating toolkit', () => {
    const removed = [
      'ai',
      '@ai-sdk/vue',
      '@modelcontextprotocol/sdk',
      'docxtemplater',
      'jszip',
      'pizzip',
      'xml-js',
    ];
    for (const reach of [server, browser]) {
      expect(
        removed.filter(
          (name) =>
            reach.external.has(name) || [...reach.external].some((s) => s.startsWith(`${name}/`))
        )
      ).toEqual([]);
    }
  });
});

/**
 * Comment-free and string-free source, so prose and proxy path labels are not read as code.
 *
 * This is a single left-to-right scan rather than a chain of replaces, because strings and
 * comments can only be told apart by reading the file in order. A pass that stripped `//`
 * comments first turned `startsWith('//')` into a dangling quote, and the string stripper
 * then swallowed everything up to the next apostrophe — which is how `/word/document.xml`
 * in `opc-names.ts` came back as a DOM `document.` access.
 *
 * Template-literal interpolations survive (they are real code); their text does not.
 */
function codeOnly(source: string): string {
  let out = '';
  let index = 0;
  const at = (offset: number): string => source[index + offset] ?? '';
  while (index < source.length) {
    const char = source[index]!;
    if (char === '/' && at(1) === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end === -1 ? source.length : end + 2;
      out += ' ';
    } else if (char === '/' && at(1) === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
    } else if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      index += 1;
      while (index < source.length && source[index] !== quote) {
        if (source[index] === '\\') index += 1;
        // Interpolations are code, so keep their contents and drop the surrounding text.
        else if (quote === '`' && source[index] === '$' && at(1) === '{') {
          const end = source.indexOf('}', index + 2);
          out += `;${source.slice(index + 2, end === -1 ? source.length : end)};`;
          index = end === -1 ? source.length : end;
        }
        index += 1;
      }
      index += 1;
      out += `${quote}${quote}`;
    } else {
      out += char;
      index += 1;
    }
  }
  return out;
}
