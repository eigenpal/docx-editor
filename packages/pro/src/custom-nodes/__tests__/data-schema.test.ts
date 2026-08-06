/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The payload boundary. Everything here arrives from a file the sender controls, so the
// interesting cases are the hostile ones.
import { describe, expect, test } from 'bun:test';
import {
  MAX_CUSTOM_NODE_DATA_LENGTH,
  parseCustomNodeData,
  serializeCustomNodeData,
  type StandardSchemaV1,
} from '../data-schema.ts';
import { defineCustomNode } from '../define-custom-node.ts';

/** A stand-in for a zod schema: the same `~standard` interface zod exposes. */
function objectSchema<T>(check: (value: unknown) => value is T): StandardSchemaV1<unknown, T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (value) =>
        check(value) ? { value } : { issues: [{ message: 'did not match the schema' }] },
    },
  };
}

interface Iceberg {
  depth: number;
}
const IcebergSchema = objectSchema<Iceberg>(
  (value): value is Iceberg =>
    typeof value === 'object' && value !== null && typeof (value as Iceberg).depth === 'number'
);

describe('parsing a payload against a schema', () => {
  test('a payload that matches comes back typed', () => {
    const result = parseCustomNodeData(IcebergSchema, '{"depth":120}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.depth).toBe(120);
  });

  test('a payload that does not match is refused, not coerced', () => {
    const result = parseCustomNodeData(IcebergSchema, '{"depth":"deep"}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid');
      expect(result.issues).toEqual(['did not match the schema']);
    }
  });

  test('bytes that are not JSON at all are refused as malformed', () => {
    const result = parseCustomNodeData(IcebergSchema, '{depth:');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed');
  });

  test('no schema means no guarantees, and says so in the type', () => {
    const result = parseCustomNodeData(undefined, '{"anything":true}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ anything: true });
  });
});

describe('what a hostile file can put in a payload', () => {
  test('a prototype-polluting key is dropped rather than carried', () => {
    const result = parseCustomNodeData(undefined, '{"__proto__":{"polluted":true},"depth":1}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as Record<string, unknown>;
    expect(Object.keys(value)).toEqual(['depth']);
    // The point of dropping it: a host spreading this into a literal cannot pollute.
    const spread = { ...value };
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.getPrototypeOf(spread)).toBe(Object.prototype);
  });

  test('nested polluting keys go too', () => {
    const result = parseCustomNodeData(undefined, '{"a":{"constructor":{"x":1},"b":2}}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: { b: 2 } });
  });

  test('an oversized payload never reaches JSON.parse', () => {
    const huge = `{"a":"${'x'.repeat(MAX_CUSTOM_NODE_DATA_LENGTH)}"}`;
    const result = parseCustomNodeData(undefined, huge);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed');
  });

  test('an empty payload is refused rather than read as undefined', () => {
    expect(parseCustomNodeData(IcebergSchema, '').ok).toBe(false);
  });
});

describe('a schema the read path cannot use', () => {
  test('async validation is refused rather than awaited', () => {
    const async: StandardSchemaV1<unknown, unknown> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => Promise.resolve({ value: {} }),
      },
    };
    const result = parseCustomNodeData(async, '{}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('async');
  });
});

describe('serializing a payload', () => {
  test('an ordinary value round-trips', () => {
    const written = serializeCustomNodeData({ depth: 120, charted: false });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const read = parseCustomNodeData(undefined, written.value);
    expect(read.ok && read.value).toEqual({ depth: 120, charted: false });
  });

  test('a cyclic value is refused with its reason, not written as {}', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    const written = serializeCustomNodeData(cyclic);
    expect(written.ok).toBe(false);
    if (!written.ok) expect(written.issues[0]).toBeTruthy();
  });

  test('undefined serializes to nothing, which is refused', () => {
    expect(serializeCustomNodeData(undefined).ok).toBe(false);
  });
});

describe('declaring the options on a definition', () => {
  test('a zod schema is accepted, and comes back on the frozen definition', () => {
    const definition = defineCustomNode({
      name: 'citation',
      tagPrefix: 'acme',
      schema: IcebergSchema,
      preserveOnExport: 'text',
    });
    expect(definition.schema).toBe(IcebergSchema);
    expect(definition.preserveOnExport).toBe('text');
  });

  test('something that is not a schema is refused where the mistake was made', () => {
    expect(() =>
      defineCustomNode({
        name: 'citation',
        tagPrefix: 'acme',
        // A plain object is the shape a host reaches for before learning it needs a schema.
        schema: { depth: 'number' } as unknown as StandardSchemaV1,
      })
    ).toThrow(/not a Standard Schema/);
  });

  test('both options are optional, and default to preserving', () => {
    const definition = defineCustomNode({ name: 'plain', tagPrefix: 'acme' });
    expect(definition.schema).toBeUndefined();
    expect(definition.preserveOnExport).toBeUndefined();
  });
});
