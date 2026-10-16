import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  expectedOutputs,
  parsePage,
  replaceSection,
  rewriteLinks,
} from '../sync-agent-docs.mjs';

const root = resolve(import.meta.dirname, '../..');

describe('agent docs sync', () => {
  test('rewrites recipe links for package copies and site links for READMEs', () => {
    const text =
      '[A](/docs/2.x/recipes/comment-on-found-text) [B](/docs/2.x/recipes) [C](/docs/2.x/react/hooks#x)';
    expect(rewriteLinks(text, 'package')).toBe(
      '[A](./comment-on-found-text.md) [B](./index.md) [C](https://www.docx-editor.dev/docs/2.x/react/hooks#x)'
    );
    expect(rewriteLinks(text, 'absolute')).toBe(
      '[A](https://www.docx-editor.dev/docs/2.x/recipes/comment-on-found-text) ' +
        '[B](https://www.docx-editor.dev/docs/2.x/recipes) ' +
        '[C](https://www.docx-editor.dev/docs/2.x/react/hooks#x)'
    );
    expect(rewriteLinks(text, 'site')).toBe(text);
  });

  test('replaces only the named section', () => {
    const text = '# T\n\n## Which\n\nold\n\n## Next\n\nkeep\n';
    expect(replaceSection(text, '## Which', 'new', 'x.md')).toBe(
      '# T\n\n## Which\n\nnew\n\n## Next\n\nkeep\n'
    );
    expect(() => replaceSection(text, '## Missing', 'new', 'x.md')).toThrow('x.md');
  });

  test('reads the frontmatter title', () => {
    expect(parsePage("---\ntitle: 'It''s here'\n---\n\nBody\n", 'p.mdx')).toEqual({
      title: "It's here",
      body: 'Body\n',
    });
  });

  test('every committed copy matches the recipe sources', () => {
    for (const [file, content] of expectedOutputs()) {
      expect(readFileSync(join(root, file), 'utf8')).toBe(content);
    }
  });
});
