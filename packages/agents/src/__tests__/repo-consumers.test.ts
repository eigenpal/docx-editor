// What the rest of the repository says about this package.
//
// These checks cover concrete repository consumers and workspace membership after the package
// rewrite, without mirroring implementation details or scanning unrelated source text.

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGE = join(import.meta.dir, '..', '..');
const REPO = join(PACKAGE, '..', '..');

describe('the consumers that declared this package', () => {
  const manifestOf = (path: string): { dependencies?: Record<string, string> } =>
    JSON.parse(readFileSync(join(REPO, path), 'utf8'));

  test.each([
    join('packages', 'react', 'package.json'),
    join('packages', 'vue', 'package.json'),
    join('packages', 'nuxt', 'package.json'),
    join('examples', 'vue', 'package.json'),
  ])('%s no longer depends on it', (path) => {
    expect(manifestOf(path).dependencies?.['@docx-editor.dev/agents']).toBeUndefined();
  });
});

describe('the example a consumer is pointed at', () => {
  const root = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
    workspaces: string[];
  };

  test('every workspace listed is a directory that exists', () => {
    const missing = root.workspaces
      .filter((pattern) => !pattern.includes('*'))
      .filter((pattern) => !existsSync(join(REPO, pattern)));
    expect(missing).toEqual([]);
  });

  test('the demos built on the removed surfaces are gone from the tree and the workspaces', () => {
    for (const demo of [join('examples', 'agents-demo'), join('examples', 'agent-chat-demo')]) {
      expect(existsSync(join(REPO, demo))).toBe(false);
    }
    expect(root.workspaces).not.toContain('examples/agents-demo');
    expect(root.workspaces).not.toContain('examples/agent-chat-demo');
  });

  test('the framework-neutral example is a workspace member and imports the package root', () => {
    expect(root.workspaces).toContain('examples/automation');
    const script = readFileSync(join(REPO, 'examples', 'automation', 'fill-template.ts'), 'utf8');
    expect(script).toContain("from '@docx-editor.dev/agents'");
    // A repo example that imported a relative source path would compile here and nowhere else.
    expect(script).not.toMatch(/from '\.{1,2}\//);
  });
});
