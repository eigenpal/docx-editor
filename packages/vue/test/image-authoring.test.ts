// Image authoring preflight — parity with the React adapter's PNG physical-density sizing.

import './dom-setup.ts';

import { describe, expect, test } from 'bun:test';
import { normalizeImageBytes } from '../src/editor/images/normalizeImageFile.ts';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

function pngWithPhysicalSize(width: number, height: number, pixelsPerMeter: number): Uint8Array {
  const source = PNG_1X1.slice();
  const writeUint32 = (bytes: Uint8Array, offset: number, value: number): void => {
    bytes[offset] = (value >>> 24) & 0xff;
    bytes[offset + 1] = (value >>> 16) & 0xff;
    bytes[offset + 2] = (value >>> 8) & 0xff;
    bytes[offset + 3] = value & 0xff;
  };
  writeUint32(source, 16, width);
  writeUint32(source, 20, height);
  const phys = Uint8Array.from([
    0, 0, 0, 9, 0x70, 0x48, 0x59, 0x73, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0,
  ]);
  writeUint32(phys, 8, pixelsPerMeter);
  writeUint32(phys, 12, pixelsPerMeter);
  const out = new Uint8Array(source.length + phys.length);
  out.set(source.subarray(0, 33));
  out.set(phys, 33);
  out.set(source.subarray(33), 33 + phys.length);
  return out;
}

describe('inserts validated image files', () => {
  test('uses PNG physical resolution for the inserted size', () => {
    const normalized = normalizeImageBytes(pngWithPhysicalSize(144, 72, 5669));
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.widthPoints).toBe(72);
    expect(normalized.heightPoints).toBe(36);
  });
});
