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
  devDependencies?: Record<string, string>;
};

describe('how this package asks for the engine', () => {
  test('the engine is a peer, so the consumer resolves one copy of it', () => {
    expect(manifest.peerDependencies?.['@docx-editor.dev/core']).toBeDefined();
    expect(manifest.dependencies?.['@docx-editor.dev/core']).toBeUndefined();
  });

  test('the adapter is a peer for the same reason', () => {
    expect(manifest.peerDependencies?.['@docx-editor.dev/react']).toBeDefined();
    expect(manifest.peerDependencies?.['@docx-editor.dev/vue']).toBeDefined();
    expect(manifest.dependencies?.['@docx-editor.dev/react']).toBeUndefined();
    expect(manifest.dependencies?.['@docx-editor.dev/vue']).toBeUndefined();
  });

  test('nothing is installed on a consumer that this package does not import', () => {
    // The string catalogue is a type-only import, so it erases at build time and never appears
    // in the output. Declaring it would make a consumer install what this package never loads.
    expect(manifest.peerDependencies?.['@docx-editor.dev/i18n']).toBeUndefined();
    expect(manifest.devDependencies?.['@docx-editor.dev/i18n']).toBe('workspace:*');
  });

  test('there are no runtime dependencies left to nest', () => {
    expect(Object.keys(manifest.dependencies ?? {})).toEqual([]);
  });
});
