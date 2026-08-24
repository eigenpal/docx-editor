/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

// How this package asks for the engine — pinned, with the risk written down.
//
// The engine carries module-level state: the HarfBuzz shaper and its cache budget, the
// grapheme boundary strategy, and layout caches keyed by object identity. Two copies in one
// tree do not crash; they load the shaper twice and miss every identity-keyed cache,
// quietly. That is why `@docx-editor.dev/core` is a PEER of the react and pro packages
// (`packages/react/test/package-dependencies.test.ts`).
//
// This package currently declares the engine as a REGULAR dependency. That is safe for the
// headless `server` entry, which constructs its own document from bytes. It is NOT the
// right end state for the `browser` entry: `runtime/browser.ts` attaches to a
// `DocxEditorInstance` the HOST constructed with the host's copy of core, so a package
// manager nesting a second copy under this package puts the automation host and the editor
// on different engines — brand checks and identity-keyed caches miss across the boundary.
// Moving the engine to a peer dependency is a consumer-facing change with its own changeset
// and release notes, tracked as a follow-up; until then this test pins the shape so it can
// only change deliberately.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) =>
  JSON.parse(readFileSync(path, 'utf8')) as {
    version: string;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };

const manifest = read(join(import.meta.dir, '..', '..', 'package.json'));
const core = read(join(import.meta.dir, '..', '..', '..', 'core', 'package.json'));

describe('how this package asks for the engine', () => {
  test('the engine dependency shape is the pinned one', () => {
    // A move to peerDependencies is the intended end state — but it changes what a
    // consumer must install, so it lands as its own PR with a changeset, not as drift.
    expect(manifest.dependencies?.['@docx-editor.dev/core']).toBeDefined();
    expect(manifest.peerDependencies?.['@docx-editor.dev/core']).toBeUndefined();
  });

  test('the declared range admits the workspace engine it is built against', () => {
    // A caret range that fell behind the engine's major would make installs resolve a
    // SECOND, older engine next to the host's — the exact two-copies failure above.
    const range = manifest.dependencies!['@docx-editor.dev/core']!;
    const match = /^\^(\d+)\.(\d+)\.\d+$/.exec(range);
    expect(match).not.toBeNull();
    const [rangeMajor, rangeMinor] = [Number(match![1]), Number(match![2])];
    const [coreMajor, coreMinor] = core.version.split('.').map(Number);
    expect(rangeMajor).toBe(coreMajor);
    expect(rangeMinor).toBeLessThanOrEqual(coreMinor!);
  });
});
