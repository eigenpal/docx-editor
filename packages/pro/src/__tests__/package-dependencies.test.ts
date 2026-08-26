/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// How this package asks for the engine, which decides whether a page ends up with one of it.
//
// The engine carries module-level state: the HarfBuzz shaper and its cache budget, the grapheme
// boundary strategy, and layout caches keyed by object identity. Two copies in one tree do not
// crash. They load the shaper twice, read a boundary configured on the other copy, and miss every
// identity-keyed cache — wrong and expensive, quietly.
//
// This package registers modules into an editor the adapter constructs, so it has to reach the
// same engine the adapter did. A regular dependency lets a package manager nest it a second copy
// whenever the ranges diverge; a peer makes the manager resolve one, and say so at install when it
// cannot. The adapter is already a peer here for the same reason.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const manifest = JSON.parse(
  readFileSync(join(import.meta.dir, '..', '..', 'package.json'), 'utf8')
) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  devDependencies?: Record<string, string>;
};

const versionOf = (pkg: string) =>
  (
    JSON.parse(
      readFileSync(join(import.meta.dir, '..', '..', '..', pkg, 'package.json'), 'utf8')
    ) as { version: string }
  ).version;

// A tilde range on the peer's current minor: patch drift is allowed, a different minor is
// not, so an app never pairs this module with an engine or adapter minor it did not ship
// with. The floor patch may lag within the minor because in-range releases do not rewrite
// the range.
const requiresSameMinor = (range: string | undefined, version: string) => {
  const match = /^~(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(range ?? '');
  if (!match) return false;
  const [major, minor, patch] = version.split('.').map(Number);
  return Number(match[1]) === major && Number(match[2]) === minor && Number(match[3]) <= patch!;
};

describe('how this package asks for the engine', () => {
  test('the engine is a peer, so the consumer resolves one copy of it', () => {
    expect(
      requiresSameMinor(manifest.peerDependencies?.['@docx-editor.dev/core'], versionOf('core'))
    ).toBe(true);
    expect(manifest.dependencies?.['@docx-editor.dev/core']).toBeUndefined();
  });

  test('the adapter is a peer for the same reason', () => {
    expect(
      requiresSameMinor(manifest.peerDependencies?.['@docx-editor.dev/react'], versionOf('react'))
    ).toBe(true);
    expect(
      requiresSameMinor(manifest.peerDependencies?.['@docx-editor.dev/vue'], versionOf('vue'))
    ).toBe(true);
    expect(manifest.dependencies?.['@docx-editor.dev/react']).toBeUndefined();
    expect(manifest.dependencies?.['@docx-editor.dev/vue']).toBeUndefined();
  });

  test('nothing is installed on a consumer that this package does not import', () => {
    // The string catalogue is a type-only import, so it erases at build time and never appears
    // in the output. Declaring it would make a consumer install what this package never loads.
    expect(manifest.peerDependencies?.['@docx-editor.dev/i18n']).toBeUndefined();
    expect(manifest.devDependencies?.['@docx-editor.dev/i18n']).toBe('workspace:*');
  });

  test('the only runtime dependency is y-protocols', () => {
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['y-protocols']);
  });

  test('yjs and y-webrtc are optional peers and never regular dependencies', () => {
    expect(manifest.peerDependencies?.yjs).toMatch(/^\^13\./);
    expect(manifest.peerDependencies?.['y-webrtc']).toMatch(/^\^10\./);
    expect(manifest.peerDependenciesMeta?.yjs).toEqual({ optional: true });
    expect(manifest.peerDependenciesMeta?.['y-webrtc']).toEqual({ optional: true });
    expect(manifest.dependencies?.yjs).toBeUndefined();
    expect(manifest.dependencies?.['y-webrtc']).toBeUndefined();
  });

  test('the default collaboration entry does not import a network provider', async () => {
    const source = await Bun.file(join(import.meta.dir, '..', 'collaboration', 'index.ts')).text();
    expect(source).not.toContain('y-webrtc');
    expect(source).not.toContain('./webrtc');
  });
});
