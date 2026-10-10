import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeHref } from '@docx-editor.dev/core/store';

describe('vue adapter security sinks', () => {
  test('sanitizeHref refuses javascript targets', () => {
    expect(sanitizeHref('javascript:alert(1)').ok).toBe(false);
    expect(sanitizeHref('java\nscript:alert(1)').ok).toBe(false);
  });

  test('packages/vue/src has no v-html bindings', () => {
    const root = join(import.meta.dirname, '../src');
    const stack = [''];
    while (stack.length) {
      const rel = stack.pop()!;
      const dir = join(root, rel);
      for (const name of readdirSync(dir)) {
        const child = rel ? `${rel}/${name}` : name;
        const abs = join(root, child);
        if (statSync(abs).isDirectory()) {
          stack.push(child);
          continue;
        }
        if (!/\.(ts|tsx|vue)$/.test(name)) continue;
        expect(readFileSync(abs, 'utf8').includes('v-html')).toBe(false);
      }
    }
  });
});
