/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// What `@docx-editor.dev/editor-api/agent` exports, and what its bundle carries.
//
// The entry is built as its own bundle. A value import of the runtime would put a second copy of
// it there, with its own symbols and classes, so the agent sources import the object model as
// types only. This walk follows value imports the way a bundler does and asserts that they stay
// inside `src/agent`.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import * as agent from '../../agent.ts';

const SRC = join(import.meta.dir, '..', '..');
const VALUE_IMPORT =
  /(?:^|\n)\s*(import|export)\s+(?!type\b)([\s\S]{0,400}?)from\s*['"]([^'"]+)['"]/g;

/** Every file that the value imports of `entry` reach. */
function valueReach(entry: string): string[] {
  const files = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const match of readFileSync(file, 'utf8').matchAll(VALUE_IMPORT)) {
      const names = match[2]!;
      const specifier = match[3]!;
      // `export { type A, type B } from` and `import { type A } from` erase too.
      const members = /\{([\s\S]*)\}/
        .exec(names)?.[1]
        ?.split(',')
        .map((name) => name.trim());
      if (members && members.filter(Boolean).every((name) => name.startsWith('type '))) continue;
      expect(specifier.startsWith('.')).toBe(true);
      queue.push(resolve(dirname(file), specifier));
    }
  }
  return [...files].map((file) => relative(SRC, file)).sort();
}

describe('the agent entry', () => {
  test('exports the rewrite helper and its error, and no model call', () => {
    expect(Object.keys(agent).sort()).toEqual(['RewriteError', 'prepareRewrite']);
  });

  test('carries no runtime: its value imports stay in src/agent', () => {
    const reached = valueReach(join(SRC, 'agent.ts'));
    expect(reached).toContain('agent/rewrite-writes.ts');
    expect(reached.filter((file) => file !== 'agent.ts' && !file.startsWith('agent/'))).toEqual([]);
  });
});
