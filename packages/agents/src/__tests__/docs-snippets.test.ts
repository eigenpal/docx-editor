import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..', '..');
const DOCS = [
  join(ROOT, 'packages', 'agents', 'README.md'),
  join(ROOT, 'examples', 'automation', 'README.md'),
  join(ROOT, 'docs', 'site', 'content', 'agents', 'index.mdx'),
  join(ROOT, 'docs', 'site', 'content', 'agents', 'word-js-api.mdx'),
  join(ROOT, 'packages', 'agents', 'src', 'index.ts'),
] as const;

describe('published automation examples', () => {
  test('name only methods the object model actually exports', () => {
    for (const path of DOCS) {
      const source = readFileSync(path, 'utf8');
      expect(source).not.toContain('.font.set(');
      expect(source).not.toContain('getItemOrNullObject');
    }
  });

  test('load and synchronize the browser heading before reading or formatting it', () => {
    for (const path of DOCS.filter((entry) => !entry.endsWith('word-js-api.mdx'))) {
      const source = readFileSync(path, 'utf8');
      const browser = source.slice(source.indexOf('createBrowser'));
      expect(browser).toContain("heading.load('text')");
      expect(browser.indexOf("heading.load('text')")).toBeLessThan(
        browser.indexOf('heading.font.bold')
      );
      expect(browser.slice(0, browser.indexOf('heading.font.bold'))).toContain(
        'await context.sync()'
      );
    }
  });
});
