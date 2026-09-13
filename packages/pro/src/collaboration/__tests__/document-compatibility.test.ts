/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import {
  DOCUMENT_COLLABORATION_VERSIONS as versions,
  assertDocumentCollaborationCompatibility as assertCompatible,
} from '../index.ts';
import { CollaborationSchemaError, SCHEMA_VERSION } from '../schema.ts';

test('public full-document contract matches JSON handshake and stays separate from text-only schema', () => {
  expect(versions.sharedSchemaVersion).toBe(3);
  expect(SCHEMA_VERSION).toBe(1);
  expect(Object.isFrozen(versions)).toBe(true);
  expect(() => assertCompatible(JSON.parse(JSON.stringify(versions)))).not.toThrow();
  expect(() => assertCompatible({ ...versions, futureCapability: true })).not.toThrow();
});

for (const field of Object.keys(versions) as (keyof typeof versions)[]) {
  for (const received of [0, versions[field] + 1, undefined, '3', null, NaN, Infinity, {}, []]) {
    test(`refuses ${field}=${String(received)} with stable code and bounded diagnostic`, () => {
      const input = Object.freeze({ ...versions, [field]: received });
      let failure: unknown;
      try {
        assertCompatible(input);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(CollaborationSchemaError);
      expect(failure).toMatchObject({
        code: field === 'protocolVersion' ? 'protocol-version-mismatch' : 'schema-version-mismatch',
      });
      expect((failure as CollaborationSchemaError).detail).toContain(
        `${field}: expected ${versions[field]}, received `
      );
      expect((failure as CollaborationSchemaError).detail!.length).toBeLessThan(100);
    });
  }
}

test('refuses missing descriptors and inherited claims without coercion or leaking metadata', () => {
  for (const input of [undefined, null, true, 3, '3', [], Object.create(versions)]) {
    expect(() => assertCompatible(input)).toThrow('protocolVersion: expected 1, received missing');
  }
  expect(() =>
    assertCompatible({ ...versions, sharedSchemaVersion: '<script>private data</script>' })
  ).toThrow('sharedSchemaVersion: expected 3, received invalid');
});
