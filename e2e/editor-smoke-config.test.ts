import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './editor-smoke.config';

const configDir = dirname(fileURLToPath(new URL('./editor-smoke.config.ts', import.meta.url)));

describe('editor smoke web servers', () => {
  test('resolve both adapter working directories from the Playwright config directory', () => {
    const webServers = Array.isArray(config.webServer) ? config.webServer : [config.webServer];

    expect(webServers).toHaveLength(2);
    for (const server of webServers) {
      expect(server?.cwd).toBeDefined();
      expect(existsSync(resolve(configDir, server!.cwd!))).toBe(true);
    }
  });
});
