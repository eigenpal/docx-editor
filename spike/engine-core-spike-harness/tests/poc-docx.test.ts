import { describe, expect, test } from 'bun:test';
import JSZip from 'jszip';
import {
  POC_PARAGRAPH_ID,
  POC_ZIP_MAX_BYTES,
  POC_ZIP_MAX_DECOMPRESSION_RATIO,
  POC_ZIP_MAX_ENTRIES,
  POC_ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES,
  POC_ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES,
  createPocDocxFixture,
  loadPocDocx,
  savePocDocx,
  type LoadedPocDocx,
  type PocRun,
} from '../src/poc/docx';

const FIXED_ZIP_DATE = new Date('1980-01-01T00:00:00Z');

async function loadFixture(): Promise<LoadedPocDocx> {
  return loadPocDocx(await createPocDocxFixture());
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function buildStoredZip(entries: ReadonlyArray<{ path: string; data: Uint8Array; flags?: number }>): Uint8Array {
  const localParts: number[] = [];
  const centralParts: number[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.path);
    const data = entry.data;
    const flags = entry.flags ?? 0;
    const localHeader = [
      0x50,
      0x4b,
      0x03,
      0x04,
      ...u16(20),
      ...u16(flags),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(crc32(data)),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...nameBytes,
    ];
    localParts.push(...localHeader, ...data);
    const centralHeader = [
      0x50,
      0x4b,
      0x01,
      0x02,
      ...u16(20),
      ...u16(20),
      ...u16(flags),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(crc32(data)),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
      ...nameBytes,
    ];
    centralParts.push(...centralHeader);
    offset += localHeader.length + data.length;
  }
  const centralOffset = localParts.length;
  const centralSize = centralParts.length;
  const endRecord = [
    0x50,
    0x4b,
    0x05,
    0x06,
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(centralSize),
    ...u32(centralOffset),
    ...u16(0),
  ];
  return new Uint8Array([...localParts, ...centralParts, ...endRecord]);
}

function patchCentralDirectorySize(
  zipBytes: Uint8Array,
  entryPath: string,
  patch: { compressedSize?: number; uncompressedSize?: number }
): Uint8Array {
  const patched = new Uint8Array(zipBytes);
  const readU16At = (offset: number) => patched[offset]! | (patched[offset + 1]! << 8);
  const readU32At = (offset: number) =>
    (patched[offset]! |
      (patched[offset + 1]! << 8) |
      (patched[offset + 2]! << 16) |
      (patched[offset + 3]! << 24)) >>>
    0;
  const writeU32At = (offset: number, value: number) => {
    patched[offset] = value & 0xff;
    patched[offset + 1] = (value >>> 8) & 0xff;
    patched[offset + 2] = (value >>> 16) & 0xff;
    patched[offset + 3] = (value >>> 24) & 0xff;
  };
  let eocdOffset = -1;
  for (let index = patched.length - 22; index >= 0; index -= 1) {
    if (readU32At(index) !== 0x06054b50) continue;
    const commentLength = readU16At(index + 20);
    if (index + 22 + commentLength !== patched.length) continue;
    const centralSize = readU32At(index + 12);
    const centralOffset = readU32At(index + 16);
    if (centralOffset + centralSize !== index) continue;
    eocdOffset = index;
    break;
  }
  if (eocdOffset < 0) throw new Error('EOCD not found');
  const totalEntries = readU16At(eocdOffset + 10);
  let offset = readU32At(eocdOffset + 16);
  for (let index = 0; index < totalEntries; index += 1) {
    if (readU32At(offset) !== 0x02014b50) throw new Error('invalid central directory entry');
    const fileNameLength = readU16At(offset + 28);
    const extraLength = readU16At(offset + 30);
    const commentLength = readU16At(offset + 32);
    const nameStart = offset + 46;
    const path = new TextDecoder().decode(patched.slice(nameStart, nameStart + fileNameLength));
    if (path === entryPath) {
      if (patch.compressedSize !== undefined) writeU32At(offset + 20, patch.compressedSize);
      if (patch.uncompressedSize !== undefined) writeU32At(offset + 24, patch.uncompressedSize);
      return patched;
    }
    offset = nameStart + fileNameLength + extraLength + commentLength;
  }
  throw new Error(`entry not found: ${entryPath}`);
}

async function replaceZipEntry(source: Uint8Array, path: string, data: string | Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(source);
  zip.file(path, data, { date: FIXED_ZIP_DATE });
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
}

async function documentXmlFromFixture(): Promise<string> {
  const fixture = await createPocDocxFixture();
  const zip = await JSZip.loadAsync(fixture);
  return zip.file('word/document.xml')!.async('string');
}

describe('POC DOCX fixture', () => {
  test('createPocDocxFixture is byte-identical across calls', async () => {
    const first = await createPocDocxFixture();
    const second = await createPocDocxFixture();
    expect(bytesEqual(first, second)).toBe(true);
  });

  test('loads editable text, runs, paragraph identity, and capsule bytes', async () => {
    const loaded = await loadFixture();
    expect(loaded.paragraphId).toBe(POC_PARAGRAPH_ID);
    expect(loaded.text).toBe('Hello bold italic');
    expect(loaded.runs).toEqual([
      { text: 'Hello ', bold: false, italic: false },
      { text: 'bold', bold: true, italic: false },
      { text: ' ', bold: false, italic: false },
      { text: 'italic', bold: false, italic: true },
    ]);
    const documentXml = await documentXmlFromFixture();
    const capsuleStart = documentXml.indexOf('<custom:PocUnsupported');
    expect(capsuleStart).toBeGreaterThanOrEqual(0);
    const capsuleEnd = documentXml.indexOf('</custom:PocUnsupported>') + '</custom:PocUnsupported>'.length;
    expect(Buffer.from(loaded.capsuleBytes).toString('utf8')).toBe(documentXml.slice(capsuleStart, capsuleEnd));
  });

  test('returns defensive copies of bytes and runs', async () => {
    const loaded = await loadFixture();
    const source = loaded.sourceBytes;
    const capsule = loaded.capsuleBytes;
    source[0] = source[0]! ^ 0xff;
    capsule[0] = capsule[0]! ^ 0xff;
    const again = await loadFixture();
    expect(bytesEqual(again.sourceBytes, await createPocDocxFixture())).toBe(true);
    expect(again.runs[0]?.text).toBe('Hello ');
    expect(Object.isFrozen(again.runs)).toBe(true);
    expect(Object.isFrozen(again.runs[0])).toBe(true);
  });
});

describe('POC DOCX trust boundary — ZIP limits', () => {
  test('rejects archives exceeding the input byte cap', async () => {
    const oversized = new Uint8Array(POC_ZIP_MAX_BYTES + 1);
    await expect(loadPocDocx(oversized)).rejects.toThrow(/byte cap/i);
  });

  test('rejects archives with too many entries', async () => {
    const entries = Array.from({ length: POC_ZIP_MAX_ENTRIES + 1 }, (_, index) => ({
      path: `part-${index}.txt`,
      data: new Uint8Array([97]),
    }));
    await expect(loadPocDocx(buildStoredZip(entries))).rejects.toThrow(/entry/i);
  });

  test.each([
    ['..', '../word/document.xml'],
    ['absolute', '/word/document.xml'],
    ['backslash', 'word\\document.xml'],
    ['nul', 'word/document\u0000.xml'],
  ])('rejects traversal path (%s) using original central-directory name', async (_label, unsafePath) => {
    const fixture = await createPocDocxFixture();
    const zip = await JSZip.loadAsync(fixture);
    const documentXml = await zip.file('word/document.xml')!.async('uint8array');
    const malicious = buildStoredZip([
      { path: '[Content_Types].xml', data: new TextEncoder().encode('<Types/>') },
      { path: unsafePath, data: documentXml },
    ]);
    await expect(loadPocDocx(malicious)).rejects.toThrow(/path/i);
  });

  test('rejects declared per-entry uncompressed size above cap', async () => {
    const fixture = await createPocDocxFixture();
    const zip = await JSZip.loadAsync(fixture);
    const tiny = new Uint8Array([0x78]);
    const parts = [
      '[Content_Types].xml',
      '_rels/.rels',
      'word/_rels/document.xml.rels',
      'word/styles.xml',
      'word/document.xml',
    ] as const;
    const entries = await Promise.all(
      parts.map(async (path) => ({
        path,
        data: path === 'word/document.xml' ? tiny : await zip.file(path)!.async('uint8array'),
      }))
    );
    const stored = buildStoredZip(entries);
    const patched = patchCentralDirectorySize(stored, 'word/document.xml', {
      uncompressedSize: POC_ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES + 1,
    });
    await expect(loadPocDocx(patched)).rejects.toThrow(/uncompressed/i);
  });

  test('rejects decompression ratio before inflating when metadata allows the check', async () => {
    const fixture = await createPocDocxFixture();
    const zip = await JSZip.loadAsync(fixture);
    const documentXml = await zip.file('word/document.xml')!.async('uint8array');
    const parts = [
      '[Content_Types].xml',
      '_rels/.rels',
      'word/_rels/document.xml.rels',
      'word/styles.xml',
      'word/document.xml',
    ] as const;
    const entries = await Promise.all(
      parts.map(async (path) => ({
        path,
        data: path === 'word/document.xml' ? documentXml : await zip.file(path)!.async('uint8array'),
      }))
    );
    const stored = buildStoredZip(entries);
    const patched = patchCentralDirectorySize(stored, 'word/document.xml', {
      compressedSize: 1,
      uncompressedSize: POC_ZIP_MAX_DECOMPRESSION_RATIO + 1,
    });
    await expect(loadPocDocx(patched)).rejects.toThrow(/ratio/i);
  });

  test('rejects aggregate uncompressed size after decompression', async () => {
    const fixture = await createPocDocxFixture();
    const zip = await JSZip.loadAsync(fixture);
    const filler = new Uint8Array(30 * 1024);
    filler.fill(97);
    const requiredEntries = await Promise.all(
      ([
        '[Content_Types].xml',
        '_rels/.rels',
        'word/_rels/document.xml.rels',
        'word/styles.xml',
        'word/document.xml',
      ] as const).map(async (path) => ({
        path,
        data: await zip.file(path)!.async('uint8array'),
      }))
    );
    const fillerEntries = ['extra/a.bin', 'extra/b.bin', 'extra/c.bin', 'extra/d.bin', 'extra/e.bin'].map(
      (path) => ({ path, data: filler })
    );
    await expect(loadPocDocx(buildStoredZip([...requiredEntries, ...fillerEntries]))).rejects.toThrow(/aggregate/i);
  });

  test('rejects duplicate required entries', async () => {
    const fixture = await createPocDocxFixture();
    const zip = await JSZip.loadAsync(fixture);
    const documentXml = await zip.file('word/document.xml')!.async('uint8array');
    const duplicate = buildStoredZip([
      { path: '[Content_Types].xml', data: await zip.file('[Content_Types].xml')!.async('uint8array') },
      { path: '_rels/.rels', data: await zip.file('_rels/.rels')!.async('uint8array') },
      { path: 'word/_rels/document.xml.rels', data: await zip.file('word/_rels/document.xml.rels')!.async('uint8array') },
      { path: 'word/styles.xml', data: await zip.file('word/styles.xml')!.async('uint8array') },
      { path: 'word/document.xml', data: documentXml },
      { path: 'word/document.xml', data: documentXml },
    ]);
    await expect(loadPocDocx(duplicate)).rejects.toThrow(/duplicate/i);
  });

  test('rejects case-colliding entry paths', async () => {
    const fixture = await createPocDocxFixture();
    const zip = await JSZip.loadAsync(fixture);
    zip.file('Word/document.xml', await zip.file('word/document.xml')!.async('string'), {
      date: FIXED_ZIP_DATE,
    });
    await expect(
      loadPocDocx(
        await zip.generateAsync({
          type: 'uint8array',
          compression: 'DEFLATE',
          compressionOptions: { level: 9 },
        })
      )
    ).rejects.toThrow(/collision/i);
  });

  test('rejects encrypted zip entries when flagged', async () => {
    const fixture = await createPocDocxFixture();
    const zip = await JSZip.loadAsync(fixture);
    const documentXml = await zip.file('word/document.xml')!.async('uint8array');
    const encrypted = buildStoredZip([
      { path: '[Content_Types].xml', data: await zip.file('[Content_Types].xml')!.async('uint8array') },
      { path: '_rels/.rels', data: await zip.file('_rels/.rels')!.async('uint8array') },
      { path: 'word/_rels/document.xml.rels', data: await zip.file('word/_rels/document.xml.rels')!.async('uint8array') },
      { path: 'word/styles.xml', data: await zip.file('word/styles.xml')!.async('uint8array') },
      { path: 'word/document.xml', data: documentXml, flags: 0x0001 },
    ]);
    await expect(loadPocDocx(encrypted)).rejects.toThrow(/encrypt/i);
  });
});

describe('POC DOCX trust boundary — XML and relationships', () => {
  test('rejects DOCTYPE and ENTITY declarations before interpretation', async () => {
    const fixture = await createPocDocxFixture();
    for (const payload of [
      '<!DOCTYPE w:document [<!ENTITY x "1">]><w:document/>',
      '<?xml version="1.0"?><!DOCTYPE foo SYSTEM "http://evil.test/x.dtd"><w:document/>',
      '<root><!ENTITY x "1"></root>',
    ]) {
      await expect(loadPocDocx(await replaceZipEntry(fixture, 'word/document.xml', payload))).rejects.toThrow(
        /dtd|entity/i
      );
    }
  });

  test('rejects external relationship targets', async () => {
    const fixture = await createPocDocxFixture();
    const externalRoot = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml" TargetMode="External"/>
</Relationships>`;
    await expect(loadPocDocx(await replaceZipEntry(fixture, '_rels/.rels', externalRoot))).rejects.toThrow(
      /external/i
    );
  });

  test('rejects remote relationship targets even without TargetMode', async () => {
    const fixture = await createPocDocxFixture();
    const remote = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="https://evil.test/doc.xml"/>
</Relationships>`;
    await expect(loadPocDocx(await replaceZipEntry(fixture, '_rels/.rels', remote))).rejects.toThrow(/external|remote/i);
  });

  test('rejects malformed owned markers and duplicate capsule occurrences', async () => {
    const fixture = await createPocDocxFixture();
    const documentXml = await documentXmlFromFixture();
    const missingStart = documentXml.replace('<poc:OwnedStart/>', '');
    await expect(loadPocDocx(await replaceZipEntry(fixture, 'word/document.xml', missingStart))).rejects.toThrow(
      /owned/i
    );
    const duplicateCapsule = documentXml.replace('</custom:PocUnsupported>', '</custom:PocUnsupported><custom:PocUnsupported/>');
    await expect(loadPocDocx(await replaceZipEntry(fixture, 'word/document.xml', duplicateCapsule))).rejects.toThrow(
      /capsule/i
    );
  });
});

describe('POC DOCX save boundary', () => {
  test('save/reopen preserves text, formatting, paragraph identity, and exact capsule bytes', async () => {
    const loaded = await loadFixture();
    const editedRuns: PocRun[] = [
      { text: 'Saved ', bold: false, italic: false },
      { text: 'bold', bold: true, italic: false },
      { text: ' & ', bold: false, italic: false },
      { text: 'italic', bold: false, italic: true },
    ];
    const saved = await savePocDocx(loaded, editedRuns);
    const reopened = await loadPocDocx(saved);
    expect(reopened.paragraphId).toBe(POC_PARAGRAPH_ID);
    expect(reopened.text).toBe('Saved bold & italic');
    expect(reopened.runs).toEqual(editedRuns);
    expect(bytesEqual(reopened.capsuleBytes, loaded.capsuleBytes)).toBe(true);

    const zip = await JSZip.loadAsync(saved);
    const documentXml = await zip.file('word/document.xml')!.async('string');
    expect(documentXml).toContain('&amp;');
    expect(documentXml).not.toContain('Saved bold & italic');
    const capsuleStart = documentXml.indexOf('<custom:PocUnsupported');
    const capsuleEnd = documentXml.indexOf('</custom:PocUnsupported>') + '</custom:PocUnsupported>'.length;
    expect(documentXml.slice(capsuleStart, capsuleEnd)).toBe(Buffer.from(loaded.capsuleBytes).toString('utf8'));
  });
});
