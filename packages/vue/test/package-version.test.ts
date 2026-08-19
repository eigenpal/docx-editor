import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VERSION } from '../src/version';

describe('@docx-editor.dev/vue VERSION', () => {
  test('matches package.json', () => {
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8')
    ) as { version: string };
    expect(VERSION).toBe(manifest.version);
  });
});
