/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// How this package asks for the engine, which decides whether a page ends up with one of it.
//
// The engine carries module-level state: the HarfBuzz shaper and its cache budget, the grapheme
// boundary strategy, and layout caches keyed by object identity. Two copies in one tree do not
// crash. They load the shaper twice, read a boundary configured on the other copy, and miss every
// identity-keyed cache — wrong and expensive, quietly.
//
// The headless `index` entry constructs its own document from bytes, so a nested engine copy
// would merely be slow there. The `./browser` entry is the one a second copy breaks: it attaches
// to a `DocxEditorInstance` the HOST constructed with the host's copy of core, so a package
// manager nesting a second copy under this package puts the automation host and the editor on
// different engines — brand checks fail and identity-keyed caches miss across the boundary. A
// regular dependency lets a package manager nest that second copy the moment the ranges diverge;
// a peer makes the manager resolve one, and say so at install when it cannot.
//
// `packages/react/test/package-dependencies.test.ts` and
// `packages/pro/src/__tests__/package-dependencies.test.ts` assert the same shape for the same
// reason. Neither file is decoration: moving the engine back to a regular dependency is the
// failure all of them were written to catch.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) =>
  JSON.parse(readFileSync(path, 'utf8')) as {
    version: string;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    devDependencies?: Record<string, string>;
  };

const manifest = read(join(import.meta.dir, '..', '..', 'package.json'));
const core = read(join(import.meta.dir, '..', '..', '..', 'core', 'package.json'));

describe('how this package asks for the engine', () => {
  test('the engine is a peer, so the consumer resolves one copy of it', () => {
    expect(manifest.peerDependencies?.['@docx-editor.dev/core']).toBeDefined();
    expect(manifest.dependencies?.['@docx-editor.dev/core']).toBeUndefined();
  });

  test('the engine peer is REQUIRED, not optional', () => {
    // An optional peer is a suggestion: the manager installs nothing and stays silent, which is
    // the opposite of the point. There is no consumer of this package without the engine — the
    // server entry parses with it and the browser entry attaches to an editor built from it.
    expect(manifest.peerDependenciesMeta?.['@docx-editor.dev/core']?.optional).toBeUndefined();
  });

  test('it is still installed here, so this workspace builds and tests against it', () => {
    // A peer is what a CONSUMER resolves. It is not an install for this package's own build, so
    // the dev dependency is what makes `bun run build` and these tests see the engine at all.
    expect(manifest.devDependencies?.['@docx-editor.dev/core']).toBe('workspace:*');
  });

  test('the engine peer is an EXACT pin on the version it ships with', () => {
    // The `./browser` entry attaches to internals of the host's engine, not just its public
    // contract, so a range here would admit an engine this exact build was never tested
    // against. The fixed release group publishes both packages at the same version, and an
    // exact pin is out of range on every bump, so `changeset version` moves it in lockstep.
    expect(manifest.peerDependencies?.['@docx-editor.dev/core']).toBe(core.version);
  });
});
