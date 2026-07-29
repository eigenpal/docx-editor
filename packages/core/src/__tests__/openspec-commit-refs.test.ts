import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '../../../..');
const openspecRoot = resolve(repositoryRoot, 'openspec');

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return extname(entry.name) === '.md' ? [path] : [];
  });
}

describe('OpenSpec commit evidence', () => {
  test('references commits reachable from the current branch', () => {
    const staleReferences: string[] = [];

    for (const path of markdownFiles(openspecRoot)) {
      const content = readFileSync(path, 'utf8');
      for (const match of content.matchAll(/`([0-9a-f]{7,40})`/g)) {
        const ref = match[1];
        const result = Bun.spawnSync(['git', 'merge-base', '--is-ancestor', ref, 'HEAD'], {
          cwd: repositoryRoot,
          stdout: 'ignore',
          stderr: 'ignore',
        });
        if (result.exitCode !== 0) {
          staleReferences.push(`${path.slice(repositoryRoot.length + 1)}: ${ref}`);
        }
      }
    }

    expect(staleReferences).toEqual([]);
  });
});
