import { describe, expect, test } from 'bun:test';
import packageJson from '../../package.json';

describe('collaboration package dependency shape', () => {
  test('keeps core and Yjs as peers and WebRTC optional', () => {
    expect(packageJson.peerDependencies['@docx-editor.dev/core']).toMatch(/^\^/);
    expect(packageJson.peerDependencies.yjs).toMatch(/^\^13\./);
    expect(packageJson.peerDependenciesMeta['y-webrtc']).toEqual({ optional: true });
    expect(packageJson.dependencies['y-protocols']).toMatch(/^\^/);
  });

  test('default entry does not import a network provider', async () => {
    const source = await Bun.file(new URL('../index.ts', import.meta.url)).text();
    expect(source).not.toContain('y-webrtc');
    expect(source).not.toContain('./webrtc');
  });
});
