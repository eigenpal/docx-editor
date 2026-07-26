// Built-in block layout handlers survive module re-evaluation (dev hot reload).
//
// `registerBlockLayout` threw on any duplicate, and the built-ins register at module scope,
// so every hot reload re-ran them, threw `duplicate block layout handler for kind 'sdt'`,
// and cascaded into "Failed to reload" for every importer — the dev server effectively
// stopped hot-reloading the editor.
//
// The guard still matters: two DIFFERENT capabilities claiming one kind is a real error.
// Only an explicit `replace` opts out, and only the built-ins use it.

import { describe, expect, test } from 'bun:test';
import { registerBlockLayout } from '../src/block-layout.ts';

describe('registerBlockLayout duplicate ownership', () => {
  test('a second handler for the same kind is rejected by default', () => {
    const kind = `test-kind-${Math.abs(Number(process.pid))}-a`;
    registerBlockLayout(kind, () => {});
    expect(() => registerBlockLayout(kind, () => {})).toThrow(/duplicate block layout handler/);
  });

  test('replace: true allows re-registration, which is what hot reload needs', () => {
    const kind = `test-kind-${Math.abs(Number(process.pid))}-b`;
    registerBlockLayout(kind, () => {});
    expect(() => registerBlockLayout(kind, () => {}, { replace: true })).not.toThrow();
  });

  // Deliberately NOT asserting on the real 'paragraph'/'table'/'sdt' kinds: replacing them
  // with a no-op would leave every later test in this process laying out nothing. The
  // property that matters is the option, proven above on a synthetic kind.
});
