import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { materializeCollectionFace, sfntChecksum } from '../font-collection-face.ts';
import { registerEmbeddedFontFaces } from '../embedded-font-faces.ts';
import { boundedStructuralFontValidator } from '../../layout/font-resource.ts';

const fixtureRoot = new URL('../../layout/__tests__/fixtures/fonts/', import.meta.url);
const regular = new Uint8Array(fs.readFileSync(new URL('DejaVuSans.ttf', fixtureRoot)));
const bold = new Uint8Array(fs.readFileSync(new URL('DejaVuSans-Bold.ttf', fixtureRoot)));
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function directory(bytes: Uint8Array, base = 0) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  return Array.from({ length: view.getUint16(base + 4) }, (_, n) => {
    const at = base + 12 + n * 16;
    return {
      tag: String.fromCharCode(...bytes.subarray(at, at + 4)),
      offset: view.getUint32(at + 8),
      length: view.getUint32(at + 12),
      entry: at,
    };
  });
}
// Public fonts, public text. The two source faces remain different at the glyph level.
function collection(fonts: readonly Uint8Array[]) {
  const bases: number[] = [],
    tableBases: number[] = [];
  let size = 12 + fonts.length * 4;
  for (const font of fonts) {
    bases.push(size);
    size += 12 + directory(font).length * 16;
  }
  for (const font of fonts) {
    tableBases.push(size);
    size += font.length;
  }
  const bytes = new Uint8Array(size),
    view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('ttcf'));
  view.setUint32(4, 0x00010000);
  view.setUint32(8, fonts.length);
  fonts.forEach((font, index) => {
    view.setUint32(12 + index * 4, bases[index]);
    const tables = directory(font),
      headerSize = 12 + tables.length * 16;
    bytes.set(font.subarray(0, headerSize), bases[index]);
    bytes.set(font, tableBases[index]);
    tables.forEach((table, n) =>
      view.setUint32(bases[index] + 12 + n * 16 + 8, tableBases[index] + table.offset)
    );
  });
  return bytes;
}
const ttc = collection([regular, bold]);

test('an admitted 129-table face keeps every table without an extra directory ceiling', () => {
  const sourceTables = directory(regular),
    count = 129;
  const addedBytes = (count - sourceTables.length) * 16;
  const expanded = new Uint8Array(regular.length + addedBytes);
  const originalEnd = 12 + sourceTables.length * 16;
  expanded.set(regular.subarray(0, originalEnd));
  expanded.set(regular.subarray(originalEnd), originalEnd + addedBytes);
  const view = new DataView(expanded.buffer);
  view.setUint16(4, count);
  for (const table of sourceTables) view.setUint32(table.entry + 8, table.offset + addedBytes);
  for (let index = sourceTables.length; index < count; index++) {
    const entry = 12 + index * 16;
    expanded.set(new TextEncoder().encode(`X${index.toString(16).padStart(3, '0')}`), entry);
    view.setUint32(entry + 8, expanded.length);
  }
  const source = collection([expanded]);
  assert.deepEqual(boundedStructuralFontValidator(source, 0), { valid: true });
  const result = materializeCollectionFace(source);
  assert.equal(directory(result).length, count);
  assert.deepEqual(boundedStructuralFontValidator(result, 0), { valid: true });
  assert.equal(sfntChecksum(result), 0xb1b0afba);
  for (const table of sourceTables.filter((table) => table.tag !== 'head')) {
    const output = directory(result).find((candidate) => candidate.tag === table.tag)!;
    assert.deepEqual(
      result.subarray(output.offset, output.offset + output.length),
      regular.subarray(table.offset, table.offset + table.length)
    );
  }
});

test('an admitted 257-face directory selects the last face without a new count ceiling', () => {
  const count = 257,
    base = 12 + count * 4;
  const source = new Uint8Array(base + regular.length);
  const view = new DataView(source.buffer);
  source.set(new TextEncoder().encode('ttcf'));
  view.setUint32(4, 0x00010000);
  view.setUint32(8, count);
  source.set(regular, base);
  for (let index = 0; index < count; index++) view.setUint32(12 + index * 4, base);
  for (const table of directory(regular))
    view.setUint32(base + table.entry + 8, base + table.offset);
  assert.deepEqual(boundedStructuralFontValidator(source, count - 1), { valid: true });
  const first = materializeCollectionFace(source, 0),
    last = materializeCollectionFace(source, count - 1);
  assert.deepEqual(last, first);
  assert.equal(sfntChecksum(last), 0xb1b0afba);
  assert.throws(() => materializeCollectionFace(source, count), /absent/);
});

test('each selected face retains all source tables and a valid independent SFNT checksum', () => {
  const untouched = hash(ttc),
    results = [];
  for (const [index, original] of [regular, bold].entries()) {
    const result = materializeCollectionFace(ttc, index);
    assert.equal(sfntChecksum(result), 0xb1b0afba);
    const tables = directory(result),
      source = directory(original);
    assert.deepEqual(
      tables.map((table) => table.tag),
      source.map((table) => table.tag)
    );
    for (const table of tables) {
      const before = source.find((candidate) => candidate.tag === table.tag);
      assert.equal(table.length, before.length);
      const actual = result.slice(table.offset, table.offset + table.length);
      const expected = original.slice(before.offset, before.offset + before.length);
      if (table.tag === 'head') {
        actual.fill(0, 8, 12);
        expected.fill(0, 8, 12);
      }
      assert.deepEqual(actual, expected, table.tag);
      const view = new DataView(result.buffer);
      assert.equal(view.getUint32(table.entry + 4), sfntChecksum(actual), table.tag);
    }
    results.push(result);
  }
  const glyphHash = (result: Uint8Array) => {
    const table = directory(result).find((table) => table.tag === 'glyf');
    return hash(result.subarray(table.offset, table.offset + table.length));
  };
  assert.notEqual(glyphHash(results[0]), glyphHash(results[1]));
  assert.equal(hash(ttc), untouched);
});

test('single SFNT copy stays exact and rejects an absent collection index', () => {
  assert.deepEqual(materializeCollectionFace(regular), regular);
  assert.notEqual(materializeCollectionFace(regular).buffer, regular.buffer);
  assert.throws(() => materializeCollectionFace(regular, 1), /requires a collection/);
});

test('absent faces, bad directories and table ranges fail closed', () => {
  assert.throws(() => materializeCollectionFace(ttc, 2), /absent/);
  assert.throws(() => materializeCollectionFace(ttc, 0.5), /index/);
  const badVersion = ttc.slice();
  new DataView(badVersion.buffer).setUint32(4, 3);
  assert.throws(() => materializeCollectionFace(badVersion), /version/);
  const base = new DataView(ttc.buffer).getUint32(12);
  const overflow = ttc.slice();
  new DataView(overflow.buffer).setUint32(base + 20, ttc.length);
  assert.throws(() => materializeCollectionFace(overflow), /range/);
  const duplicate = ttc.slice();
  duplicate.set(duplicate.subarray(base + 12, base + 16), base + 28);
  assert.throws(() => materializeCollectionFace(duplicate), /duplicate/);
  const overlaps = ttc.slice();
  new DataView(overlaps.buffer).setUint32(base + 20, 0);
  assert.throws(() => materializeCollectionFace(overlaps), /directory/);
});

test('signed selected faces are refused without silently dropping their signature', () => {
  const signed = ttc.slice(),
    base = new DataView(signed.buffer).getUint32(12);
  signed.set(new TextEncoder().encode('DSIG'), base + 12);
  assert.throws(() => materializeCollectionFace(signed), /signature-aware/);
  const version2 = new Uint8Array(ttc.length + 12),
    original = new DataView(ttc.buffer);
  version2.set(ttc.subarray(0, 20));
  version2.set(ttc.subarray(20), 32);
  const view = new DataView(version2.buffer);
  view.setUint32(4, 0x00020000);
  for (const index of [0, 1]) {
    const base = original.getUint32(12 + index * 4);
    view.setUint32(12 + index * 4, base + 12);
    for (const table of directory(ttc, base))
      view.setUint32(table.entry + 12 + 8, table.offset + 12);
  }
  assert.equal(sfntChecksum(materializeCollectionFace(version2, 1)), 0xb1b0afba);
  view.setUint32(20, 0x44534947);
  view.setUint32(24, 4);
  view.setUint32(28, ttc.length);
  assert.throws(() => materializeCollectionFace(version2), /signature-aware/);
});

test('registration gives different collection faces different aliases and browser bytes', async () => {
  const sources = [0, 1].map((faceIndex) => ({
    request: { family: `Public Face ${faceIndex}`, weight: 400, style: 'normal' as const },
    id: `public-${faceIndex}`,
    bytes: ttc,
    hash: `sha256:${hash(ttc)}`,
    faceIndex,
  }));
  const added: { family: string; bytes: Uint8Array; load: () => Promise<void> }[] = [];
  const deleted: unknown[] = [];
  const registration = await registerEmbeddedFontFaces(sources, {
    fontSet: {
      add: (face) => added.push(face as (typeof added)[number]),
      delete: (face) => deleted.push(face),
    },
    createFontFace: (family, bytes) => ({ family, bytes, load: async () => {} }),
  });
  assert.equal(registration.installed, 2);
  assert.notEqual(registration.alias('Public Face 0'), registration.alias('Public Face 1'));
  for (const [index, face] of added.entries()) {
    assert.equal(face.family, registration.alias(`Public Face ${index}`));
    assert.deepEqual(face.bytes, materializeCollectionFace(ttc, index));
    assert.equal(sfntChecksum(face.bytes), 0xb1b0afba);
  }
  assert.notEqual(hash(added[0].bytes), hash(added[1].bytes));
  assert.equal(sources[0].bytes, sources[1].bytes);
  registration.dispose();
  registration.dispose();
  assert.deepEqual(deleted, added);
});

test('unsupported collection face never advertises an alias or reaches the font loader', async () => {
  let calls = 0;
  const registration = await registerEmbeddedFontFaces(
    [
      {
        request: { family: 'Public Missing Face', weight: 400, style: 'normal' },
        id: 'public-missing',
        bytes: ttc,
        hash: `sha256:${hash(ttc)}`,
        faceIndex: 2,
      },
    ],
    {
      fontSet: { add: () => assert.fail('Invalid face added'), delete: () => {} },
      createFontFace: () => {
        calls++;
        return { load: async () => {} };
      },
    }
  );
  assert.equal(calls, 0);
  assert.equal(registration.installed, 0);
  assert.equal(registration.alias('Public Missing Face'), undefined);
});
