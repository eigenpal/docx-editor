import { describe, expect, test } from 'bun:test';

import { dataUrlToBlob } from './InsertImageDialog';

describe('dataUrlToBlob', () => {
  test('parses the MIME type from a data URL', () => {
    const blob = dataUrlToBlob('data:image/jpeg;base64,QUJD');
    expect(blob.type).toBe('image/jpeg');
  });

  test('keeps the type for a header without a `;` (e.g. svg)', () => {
    expect(dataUrlToBlob('data:image/svg+xml,QUJD').type).toBe('image/svg+xml');
  });

  test('falls back to image/png when the prefix has no MIME', () => {
    const blob = dataUrlToBlob('data:,QUJD');
    expect(blob.type).toBe('image/png');
  });

  test('falls back to image/png when the header is not a valid type/subtype', () => {
    // No `;` and no `/`: the candidate is not a MIME type, so we must not
    // surface it as the Blob type.
    expect(dataUrlToBlob('data:notamimetype,QUJD').type).toBe('image/png');
  });

  test('stays linear on an adversarial prefix (no ReDoS)', () => {
    // A long `:a:a:a…` prefix with no `;` used to backtrack quadratically.
    // Generous bound: post-fix this is microsecond-scale, but a quadratic
    // regression would take tens of seconds, so this still separates the two
    // without flaking on a loaded CI runner.
    const evil = ':' + ':a'.repeat(200_000) + ',QUJD';
    const start = performance.now();
    dataUrlToBlob(evil);
    expect(performance.now() - start).toBeLessThan(5_000);
  });
});
