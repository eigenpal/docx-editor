import { describe, expect, test } from 'bun:test';
import { sha256FontBytes, sha256FontBytesPure, sha256IsNative } from '../package/sha256.ts';

describe('sha256FontBytes', () => {
  test('matches the FIPS 180-4 vectors', () => {
    const text = (s: string) => new TextEncoder().encode(s);
    expect(sha256FontBytesPure(text(''))).toBe(
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    expect(sha256FontBytesPure(text('abc'))).toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    expect(sha256FontBytes(text('abc'))).toBe(sha256FontBytesPure(text('abc')));
  });

  test('the native path, when the host has one, agrees with the pure path byte for byte', () => {
    // Bun always has a native hasher, so this exercises the fast path in the test suite.
    expect(sha256IsNative).toBe(true);
    for (const length of [0, 1, 55, 56, 63, 64, 65, 1000, 4096, 70_000]) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) bytes[i] = (i * 7919 + length) & 0xff;
      expect(sha256FontBytes(bytes)).toBe(sha256FontBytesPure(bytes));
    }
    // A subarray view hashes the view, not the whole buffer beneath it.
    const buffer = new Uint8Array(200).fill(9);
    const view = buffer.subarray(50, 120);
    expect(sha256FontBytes(view)).toBe(sha256FontBytesPure(view));
    expect(sha256FontBytes(view)).not.toBe(sha256FontBytes(buffer));
  });
  test('large caller views require at most 128 bytes of padding storage', () => {
    const storage = new Uint8Array(1024 * 1024 + 80);
    for (let index = 0; index < storage.length; index++) storage[index] = (index * 7919) & 0xff;
    const original = storage.slice();
    const inputs = [0, 55, 56, 63].map((remainder) =>
      storage.subarray(7, 7 + 1024 * 1024 + remainder)
    );
    const expected = inputs.map((bytes) => sha256FontBytes(bytes));
    const allocations: number[] = [];
    const Constructor = globalThis.Uint8Array;
    const tracked = new Proxy(Constructor, {
      construct(target, args, newTarget) {
        const result = Reflect.construct(target, args, newTarget) as Uint8Array;
        allocations.push(result.byteLength);
        return result;
      },
    });
    let digests: string[];
    try {
      globalThis.Uint8Array = tracked;
      digests = inputs.map((bytes) => sha256FontBytesPure(bytes));
    } finally {
      globalThis.Uint8Array = Constructor;
    }
    expect(digests).toEqual(expected);
    expect(allocations).toEqual([64, 64, 128, 128]);
    expect(storage).toEqual(original);
  });
});
