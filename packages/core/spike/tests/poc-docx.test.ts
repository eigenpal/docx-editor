import { describe, expect, test } from 'bun:test';
import JSZip from 'jszip';
import { deflateRawSync } from 'node:zlib';
import {
  POC_PARAGRAPH_ID,
  POC_CUSTOM_NS,
  POC_NS,
  POC_W_NS,
  POC_ZIP_MAX_BYTES,
  POC_ZIP_MAX_DECOMPRESSION_RATIO,
  POC_ZIP_MAX_ENTRIES,
  POC_ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES,
  POC_ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES,
  createPocDocxFixture,
  loadPocDocx,
  type LoadedPocDocx,
} from '../src/poc/docx';

const UTF8_FLAG = 0x0800;
const MAX_RUNS = 32;
const MAX_RUN_TEXT_LENGTH = 4096;
const REQUIRED_PATHS = [
  '[Content_Types].xml',
  '_rels/.rels',
  'word/_rels/document.xml.rels',
  'word/styles.xml',
  'word/document.xml',
] as const;

interface ZipInput {
  readonly path?: string;
  readonly nameBytes?: Uint8Array;
  readonly data: Uint8Array;
  readonly compressedData?: Uint8Array;
  readonly flags?: number;
  readonly method?: number;
  readonly extra?: Uint8Array;
  readonly local?: Partial<{
    nameBytes: Uint8Array;
    flags: number;
    method: number;
    crc: number;
    compressedSize: number;
    uncompressedSize: number;
    extra: Uint8Array;
  }>;
  readonly central?: Partial<{
    flags: number;
    method: number;
    crc: number;
    compressedSize: number;
    uncompressedSize: number;
    localOffset: number;
  }>;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

function u16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildClassicZip(entries: readonly ZipInput[], comment = new Uint8Array()): Uint8Array {
  const local: number[] = [];
  const central: number[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const nameBytes = entry.nameBytes ?? new TextEncoder().encode(entry.path ?? '');
    const localName = entry.local?.nameBytes ?? nameBytes;
    const data = entry.data;
    const compressedData = entry.compressedData ?? data;
    const flags = entry.flags ?? UTF8_FLAG;
    const method = entry.method ?? 0;
    const extra = entry.extra ?? new Uint8Array();
    const crc = crc32(data);
    const localExtra = entry.local?.extra ?? extra;
    const localHeader = [
      0x50, 0x4b, 0x03, 0x04,
      ...u16(20),
      ...u16(entry.local?.flags ?? flags),
      ...u16(entry.local?.method ?? method),
      ...u16(0), ...u16(0),
      ...u32(entry.local?.crc ?? crc),
      ...u32(entry.local?.compressedSize ?? compressedData.length),
      ...u32(entry.local?.uncompressedSize ?? data.length),
      ...u16(localName.length),
      ...u16(localExtra.length),
      ...localName,
      ...localExtra,
    ];
    local.push(...localHeader, ...compressedData);
    central.push(
      0x50, 0x4b, 0x01, 0x02,
      ...u16(20), ...u16(20),
      ...u16(entry.central?.flags ?? flags),
      ...u16(entry.central?.method ?? method),
      ...u16(0), ...u16(0),
      ...u32(entry.central?.crc ?? crc),
      ...u32(entry.central?.compressedSize ?? compressedData.length),
      ...u32(entry.central?.uncompressedSize ?? data.length),
      ...u16(nameBytes.length),
      ...u16(extra.length),
      ...u16(0), ...u16(0), ...u16(0), ...u32(0),
      ...u32(entry.central?.localOffset ?? localOffset),
      ...nameBytes,
      ...extra
    );
    localOffset += localHeader.length + compressedData.length;
  }
  const end = [
    0x50, 0x4b, 0x05, 0x06,
    ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(central.length), ...u32(local.length),
    ...u16(comment.length), ...comment,
  ];
  return new Uint8Array([...local, ...central, ...end]);
}

async function fixtureEntries(): Promise<ZipInput[]> {
  const zip = await JSZip.loadAsync(await createPocDocxFixture());
  return Promise.all(
    REQUIRED_PATHS.map(async (path) => ({
      path,
      data: await zip.file(path)!.async('uint8array'),
    }))
  );
}

async function replaceEntry(path: string, text: string): Promise<Uint8Array> {
  const entries = await fixtureEntries();
  return buildClassicZip(
    entries.map((entry) =>
      entry.path === path ? { path, data: new TextEncoder().encode(text) } : entry
    )
  );
}

async function documentXml(): Promise<string> {
  const zip = await JSZip.loadAsync(await createPocDocxFixture());
  return zip.file('word/document.xml')!.async('string');
}

async function loadFixture(): Promise<LoadedPocDocx> {
  return loadPocDocx(await createPocDocxFixture());
}

describe('POC DOCX deterministic fixture', () => {
  test('independent generation is byte-identical and standards-minimal', async () => {
    const first = await createPocDocxFixture();
    const second = await createPocDocxFixture();
    expect(first).not.toBe(second);
    expect(bytesEqual(first, second)).toBe(true);
    const zip = await JSZip.loadAsync(first);
    expect(Object.keys(zip.files).sort()).toEqual([...REQUIRED_PATHS].sort());
  });

  test('loads one paragraph with exact text, formatting, identity, and capsule', async () => {
    const loaded = await loadFixture();
    expect(loaded.paragraphId).toBe(POC_PARAGRAPH_ID);
    expect(loaded.text).toBe('Hello bold italic');
    expect(loaded.runs).toEqual([
      { text: 'Hello ', bold: false, italic: false },
      { text: 'bold', bold: true, italic: false },
      { text: ' ', bold: false, italic: false },
      { text: 'italic', bold: false, italic: true },
    ]);
    expect(Buffer.from(loaded.capsuleBytes).toString('utf8')).toContain('deadbeef');
  });

  test('fixture marks leading or trailing whitespace with xml:space preserve', async () => {
    const xml = await documentXml();
    expect(xml).toContain('<w:t xml:space="preserve">Hello </w:t>');
    expect(xml).toContain('<w:t xml:space="preserve"> </w:t>');
  });

  test('same loaded result returns defensive byte copies and deeply frozen records', async () => {
    const loaded = await loadFixture();
    const sourceBefore = loaded.sourceBytes;
    const capsuleBefore = loaded.capsuleBytes;
    sourceBefore[0] ^= 0xff;
    capsuleBefore[0] ^= 0xff;
    expect(bytesEqual(loaded.sourceBytes, await createPocDocxFixture())).toBe(true);
    expect(Buffer.from(loaded.capsuleBytes).toString('utf8')).toContain('deadbeef');
    expect(loaded.sourceBytes).not.toBe(loaded.sourceBytes);
    expect(loaded.capsuleBytes).not.toBe(loaded.capsuleBytes);
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded.runs)).toBe(true);
    expect(Object.isFrozen(loaded.runs[0])).toBe(true);
  });
});

describe('POC DOCX classic ZIP preflight', () => {
  test('rejects input byte and entry count caps', async () => {
    await expect(loadPocDocx(new Uint8Array(POC_ZIP_MAX_BYTES + 1))).rejects.toThrow(/byte cap/i);
    const entries = Array.from({ length: POC_ZIP_MAX_ENTRIES + 1 }, (_, index) => ({
      path: `part-${index}.xml`,
      data: new Uint8Array([index]),
    }));
    await expect(loadPocDocx(buildClassicZip(entries))).rejects.toThrow(/entry count/i);
  });

  test('rejects truncation, comments, trailing bytes, and multi-disk EOCD', async () => {
    const fixture = await createPocDocxFixture();
    await expect(loadPocDocx(fixture.slice(0, -1))).rejects.toThrow(/truncated|end of central/i);
    await expect(loadPocDocx(buildClassicZip(await fixtureEntries(), new Uint8Array([1])))).rejects.toThrow(/comment/i);
    await expect(loadPocDocx(new Uint8Array([...fixture, 0]))).rejects.toThrow(/trailing|end of central/i);
    const multiDisk = new Uint8Array(fixture);
    multiDisk[multiDisk.length - 18] = 1;
    await expect(loadPocDocx(multiDisk)).rejects.toThrow(/single-disk/i);
  });

  test('rejects ZIP64 sentinels and ZIP64 records', async () => {
    const fixture = await createPocDocxFixture();
    const sentinel = new Uint8Array(fixture);
    sentinel[sentinel.length - 12] = 0xff;
    sentinel[sentinel.length - 11] = 0xff;
    await expect(loadPocDocx(sentinel)).rejects.toThrow(/zip64/i);
    const locator = new Uint8Array([...fixture.slice(0, -22), 0x50, 0x4b, 0x06, 0x07, ...new Uint8Array(16), ...fixture.slice(-22)]);
    await expect(loadPocDocx(locator)).rejects.toThrow(/zip64/i);
  });

  test.each([
    ['encryption', 0x0001, /encrypt/i],
    ['data descriptor', UTF8_FLAG | 0x0008, /descriptor/i],
    ['unknown flag', UTF8_FLAG | 0x0010, /flag/i],
    ['missing canonical UTF-8 flag', 0, /utf-8 flag/i],
  ])('rejects %s flag configuration', async (_label, flags, message) => {
    const entries = await fixtureEntries();
    entries[0] = { ...entries[0]!, flags };
    await expect(loadPocDocx(buildClassicZip(entries))).rejects.toThrow(message);
  });

  test('rejects unsupported compression methods', async () => {
    const entries = await fixtureEntries();
    entries[0] = { ...entries[0]!, method: 12 };
    await expect(loadPocDocx(buildClassicZip(entries))).rejects.toThrow(/compression method/i);
  });

  test('rejects invalid UTF-8 names, non-ASCII names, and extra-field name overrides', async () => {
    const entries = await fixtureEntries();
    entries[0] = { ...entries[0]!, nameBytes: new Uint8Array([0xc3, 0x28]) };
    await expect(loadPocDocx(buildClassicZip(entries))).rejects.toThrow(/utf-8/i);
    entries[0] = { ...entries[0]!, path: 'é.xml', nameBytes: undefined };
    await expect(loadPocDocx(buildClassicZip(entries))).rejects.toThrow(/ascii/i);
    entries[0] = {
      ...entries[0]!,
      path: '[Content_Types].xml',
      extra: new Uint8Array([0x75, 0x70, 0x01, 0x00, 0x00]),
    };
    await expect(loadPocDocx(buildClassicZip(entries))).rejects.toThrow(/extra field/i);
  });

  test('rejects duplicate and case-colliding required paths', async () => {
    const entries = await fixtureEntries();
    await expect(loadPocDocx(buildClassicZip([...entries, entries[4]!]))).rejects.toThrow(/duplicate/i);
    entries[4] = { ...entries[4]!, path: 'Word/document.xml' };
    await expect(loadPocDocx(buildClassicZip([...entries, { ...(await fixtureEntries())[4]! }]))).rejects.toThrow(
      /case collision/i
    );
  });

  test.each([
    ['parent segment', '../word/document.xml'],
    ['dot segment', 'word/./document.xml'],
    ['absolute', '/word/document.xml'],
    ['backslash', 'word\\document.xml'],
    ['NUL', 'word/document\u0000.xml'],
  ])('rejects unsafe path: %s', async (_label, path) => {
    const entries = await fixtureEntries();
    entries[4] = { ...entries[4]!, path };
    await expect(loadPocDocx(buildClassicZip(entries))).rejects.toThrow(/path/i);
  });

  test.each([
    ['filename', { nameBytes: new TextEncoder().encode('word/other.xml') }],
    ['flags', { flags: 0 }],
    ['method', { method: 8 }],
    ['CRC', { crc: 1 }],
    ['compressed size', { compressedSize: 1 }],
    ['uncompressed size', { uncompressedSize: 1 }],
  ])('rejects local-central %s mismatch', async (_label, local) => {
    const entries = await fixtureEntries();
    entries[4] = { ...entries[4]!, local };
    await expect(loadPocDocx(buildClassicZip(entries))).rejects.toThrow(/local.*central|mismatch/i);
  });

  test('rejects overlapping entry ranges and invalid offsets', async () => {
    const entries = await fixtureEntries();
    entries[1] = { ...entries[1]!, central: { localOffset: 0 } };
    await expect(loadPocDocx(buildClassicZip(entries))).rejects.toThrow(/overlap|offset/i);
    entries[1] = { ...entries[1]!, central: { localOffset: 0xffffffff } };
    await expect(loadPocDocx(buildClassicZip(entries))).rejects.toThrow(/zip64|offset|range/i);
  });

  test('preflights declared per-entry, aggregate, and ratio caps', async () => {
    const entries = await fixtureEntries();
    entries[4] = {
      ...entries[4]!,
      local: { uncompressedSize: POC_ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES + 1 },
      central: { uncompressedSize: POC_ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES + 1 },
    };
    await expect(loadPocDocx(buildClassicZip(entries))).rejects.toThrow(/entry.*uncompressed/i);

    const filler = new Uint8Array(30 * 1024);
    const aggregate = [
      ...(await fixtureEntries()),
      ...Array.from({ length: 5 }, (_, index) => ({ path: `extra/${index}.xml`, data: filler })),
    ];
    await expect(loadPocDocx(buildClassicZip(aggregate))).rejects.toThrow(/aggregate/i);

    const ratio = await fixtureEntries();
    ratio[4] = {
      ...ratio[4]!,
      local: { compressedSize: 1, uncompressedSize: POC_ZIP_MAX_DECOMPRESSION_RATIO + 1 },
      central: { compressedSize: 1, uncompressedSize: POC_ZIP_MAX_DECOMPRESSION_RATIO + 1 },
    };
    await expect(loadPocDocx(buildClassicZip(ratio))).rejects.toThrow(/ratio/i);
  });

  test('post-inflate verifies declared size and CRC', async () => {
    const entries = await fixtureEntries();
    const document = entries[4]!;
    entries[4] = {
      ...document,
      local: { crc: 1 },
      central: { crc: 1 },
    };
    await expect(loadPocDocx(buildClassicZip(entries))).rejects.toThrow(/crc/i);
  });

  test('rejects coherent declared size that differs from inflated payload', async () => {
    const entries = await fixtureEntries();
    const document = entries[4]!;
    const compressedData = new Uint8Array(deflateRawSync(document.data));
    entries[4] = {
      ...document,
      method: 8,
      compressedData,
      local: {
        compressedSize: compressedData.length,
        uncompressedSize: document.data.length - 1,
      },
      central: {
        compressedSize: compressedData.length,
        uncompressedSize: document.data.length - 1,
      },
    };
    await expect(loadPocDocx(buildClassicZip(entries))).rejects.toThrow();
  });
});

describe('POC DOCX XML and relationship boundary', () => {
  test.each([
    ['[Content_Types].xml', '<! DOCTYPE Types><Types/>'],
    ['_rels/.rels', '<!DoCtYpE Relationships><Relationships/>'],
    ['word/_rels/document.xml.rels', '<! ENTITY x "y"><Relationships/>'],
    ['word/styles.xml', '<!eNtItY x "y"><w:styles/>'],
  ])('rejects DTD/entity variants in %s', async (path, xml) => {
    await expect(loadPocDocx(await replaceEntry(path, xml))).rejects.toThrow(/dtd|entity/i);
  });

  test('requires UTF-8 XML with optional UTF-8 BOM only', async () => {
    const xml = await documentXml();
    await expect(
      loadPocDocx(await replaceEntry('word/document.xml', xml.replace('encoding="UTF-8"', 'encoding="UTF-16"')))
    ).rejects.toThrow(/utf-8|encoding/i);
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(xml)]);
    const entries = await fixtureEntries();
    entries[4] = { ...entries[4]!, data: bom };
    await expect(loadPocDocx(buildClassicZip(entries))).resolves.toMatchObject({ paragraphId: POC_PARAGRAPH_ID });
  });

  test.each([
    [
      'prefixed single-quoted external mode',
      `<r:Relationships xmlns:r='http://schemas.openxmlformats.org/package/2006/relationships'><r:Relationship Id='x' Type='x' Target='word/document.xml' TargetMode='eXtErNaL'/></r:Relationships>`,
    ],
    [
      'entity-encoded remote scheme',
      `<Relationships xmlns='x'><Relationship Id='x' Type='x' Target='java&#x73;cript:alert(1)'/></Relationships>`,
    ],
    [
      'control-obscured remote scheme',
      `<Relationships xmlns='x'><Relationship Id='x' Type='x' Target='https&#x0A;://evil.test/x'/></Relationships>`,
    ],
    [
      'absolute target',
      `<Relationships xmlns='x'><Relationship Id='x' Type='x' Target='/word/document.xml'/></Relationships>`,
    ],
    [
      'traversal target',
      `<Relationships xmlns='x'><Relationship Id='x' Type='x' Target='../document.xml'/></Relationships>`,
    ],
    [
      'whitespace/entity-obscured external mode',
      `<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'><Relationship Id='x' Type='x' Target='word/document.xml' TargetMode=' &#x09;eXtErNaL&#x0A; '/></Relationships>`,
    ],
    [
      'leading whitespace remote target',
      `<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'><Relationship Id='x' Type='x' Target=' &#x09;https://evil.test/x '/></Relationships>`,
    ],
    [
      'entity-obscured traversal target',
      `<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'><Relationship Id='x' Type='x' Target='..&#x09;/document.xml'/></Relationships>`,
    ],
  ])('rejects relationship variant: %s', async (_label, xml) => {
    await expect(loadPocDocx(await replaceEntry('_rels/.rels', xml))).rejects.toThrow(/relationship|external|remote|target/i);
  });

  test('rejects malformed relationship attributes', async () => {
    const xml = `<Relationships xmlns='x'><Relationship Id='x' Type='x' Target='word/document.xml' Broken/></Relationships>`;
    await expect(loadPocDocx(await replaceEntry('_rels/.rels', xml))).rejects.toThrow(/attribute|relationship/i);
  });

  test.each([
    [
      'lowercase child',
      `<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'><relationship Id='x' Type='x' Target='word/document.xml'/></Relationships>`,
    ],
    [
      'unknown child',
      `<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'><Unknown/></Relationships>`,
    ],
    [
      'wrong namespace',
      `<Relationships xmlns='urn:wrong'><Relationship Id='x' Type='x' Target='word/document.xml'/></Relationships>`,
    ],
    [
      'unknown target mode',
      `<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'><Relationship Id='x' Type='x' Target='word/document.xml' TargetMode='other'/></Relationships>`,
    ],
    [
      'duplicate ID',
      `<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'><Relationship Id='x' Type='x' Target='word/document.xml'/><Relationship Id='x' Type='x' Target='word/document.xml'/></Relationships>`,
    ],
  ])('rejects closed RELS grammar: %s', async (_label, xml) => {
    await expect(loadPocDocx(await replaceEntry('_rels/.rels', xml))).rejects.toThrow(/relationship|rels|namespace|mode|id/i);
  });
});

describe('POC required package semantics', () => {
  test('rejects missing and unknown content-type declarations', async () => {
    const entries = await fixtureEntries();
    const contentTypes = new TextDecoder().decode(entries[0]!.data);
    const missing = contentTypes.replace(
      '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n',
      ''
    );
    await expect(loadPocDocx(await replaceEntry('[Content_Types].xml', missing))).rejects.toThrow(/content type/i);
    const unknown = contentTypes.replace('</Types>', '<Default Extension="bin" ContentType="x"/></Types>');
    await expect(loadPocDocx(await replaceEntry('[Content_Types].xml', unknown))).rejects.toThrow(/content type/i);
    const duplicate = contentTypes.replace(
      '</Types>',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>'
    );
    await expect(loadPocDocx(await replaceEntry('[Content_Types].xml', duplicate))).rejects.toThrow(
      /duplicate content type/i
    );
  });

  test('rejects missing required root and document relationships', async () => {
    const entries = await fixtureEntries();
    const rootRels = new TextDecoder().decode(entries[1]!.data);
    const documentRels = new TextDecoder().decode(entries[2]!.data);
    await expect(
      loadPocDocx(await replaceEntry('_rels/.rels', rootRels.replace(/<Relationship[^>]+\/>/, '')))
    ).rejects.toThrow(/required.*relationship|relationship.*required/i);
    await expect(
      loadPocDocx(
        await replaceEntry(
          'word/_rels/document.xml.rels',
          documentRels.replace(/<Relationship[^>]+\/>/, '')
        )
      )
    ).rejects.toThrow(/required.*relationship|relationship.*required/i);
  });

  test('rejects styles and document namespace rebinding', async () => {
    const entries = await fixtureEntries();
    const styles = new TextDecoder().decode(entries[3]!.data);
    await expect(
      loadPocDocx(await replaceEntry('word/styles.xml', styles.replace(POC_W_NS, 'urn:wrong')))
    ).rejects.toThrow(/namespace|styles/i);
    const document = new TextDecoder().decode(entries[4]!.data);
    for (const namespace of [POC_W_NS, POC_NS, POC_CUSTOM_NS]) {
      await expect(
        loadPocDocx(await replaceEntry('word/document.xml', document.replace(namespace, 'urn:wrong')))
      ).rejects.toThrow(/namespace|binding/i);
    }
  });
});

describe('POC document shape tokenizer', () => {
  test('parses explicit false and zero bold/italic values', async () => {
    const xml = (await documentXml())
      .replace('<w:b/>', '<w:b w:val="false"/>')
      .replace('<w:i/>', '<w:i w:val="0"/>');
    const loaded = await loadPocDocx(await replaceEntry('word/document.xml', xml));
    expect(loaded.runs[1]?.bold).toBe(false);
    expect(loaded.runs[3]?.italic).toBe(false);
  });

  test.each([
    ['unknown owned markup', '<poc:OwnedStart/>', '<poc:OwnedStart/><w:tab/>'],
    [
      'wrong owned namespace prefix',
      '<w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r>',
      '<x:r><x:rPr><x:b/></x:rPr><x:t>bold</x:t></x:r>',
    ],
    ['markup inside text', '<w:t>bold</w:t>', '<w:t>bo<w:b/>ld</w:t>'],
    ['unknown paragraph properties', '</w:pPr>', '<w:keepNext/></w:pPr>'],
    ['unknown body child', '<w:sectPr>', '<w:bookmarkStart/><w:sectPr>'],
    ['duplicate paragraph', '</w:p>', '</w:p><w:p/>'],
    ['duplicate capsule', '</custom:PocUnsupported>', '</custom:PocUnsupported><custom:PocUnsupported/>'],
    ['missing owned end', '<poc:OwnedEnd/>', ''],
  ])('rejects malformed exact shape: %s', async (_label, before, after) => {
    const xml = (await documentXml()).replace(before, after);
    await expect(loadPocDocx(await replaceEntry('word/document.xml', xml))).rejects.toThrow();
  });

  test('enforces xml:space preserve for boundary whitespace', async () => {
    const xml = (await documentXml()).replace('<w:t xml:space="preserve">Hello </w:t>', '<w:t>Hello </w:t>');
    await expect(loadPocDocx(await replaceEntry('word/document.xml', xml))).rejects.toThrow(/xml:space|whitespace/i);
  });

  test('rejects invalid XML controls and unknown text attributes', async () => {
    const xml = (await documentXml()).replace('Hello ', `Hello \u0001`);
    await expect(loadPocDocx(await replaceEntry('word/document.xml', xml))).rejects.toThrow(/control|xml character/i);
    const unknown = (await documentXml()).replace(
      '<w:t xml:space="preserve">Hello </w:t>',
      '<w:t xml:space="preserve" bad="1">Hello </w:t>'
    );
    await expect(loadPocDocx(await replaceEntry('word/document.xml', unknown))).rejects.toThrow(/attribute|markup/i);
  });

  test('enforces run count and per-run text bounds', async () => {
    const xml = await documentXml();
    const tooManyRuns = '<w:r><w:t>x</w:t></w:r>'.repeat(MAX_RUNS + 1);
    const countPayload = xml.replace(
      /<poc:OwnedStart\/>[\s\S]*?<poc:OwnedEnd\/>/,
      `<poc:OwnedStart/>${tooManyRuns}<poc:OwnedEnd/>`
    );
    await expect(loadPocDocx(await replaceEntry('word/document.xml', countPayload))).rejects.toThrow(/run count/i);
    const longText = 'x'.repeat(MAX_RUN_TEXT_LENGTH + 1);
    const textPayload = xml.replace('<w:t>bold</w:t>', `<w:t>${longText}</w:t>`);
    await expect(loadPocDocx(await replaceEntry('word/document.xml', textPayload))).rejects.toThrow(/run text/i);
  });

  test('enforces aggregate editable text bound', async () => {
    const xml = await documentXml();
    const runs = Array.from(
      { length: 3 },
      () => `<w:r><w:t>${'x'.repeat(3000)}</w:t></w:r>`
    ).join('');
    const payload = xml.replace(
      /<poc:OwnedStart\/>[\s\S]*?<poc:OwnedEnd\/>/,
      `<poc:OwnedStart/>${runs}<poc:OwnedEnd/>`
    );
    await expect(loadPocDocx(await replaceEntry('word/document.xml', payload))).rejects.toThrow(/owned text|aggregate text/i);
  });

  test('decodes predefined and numeric entities without interpreting markup', async () => {
    const xml = (await documentXml()).replace('<w:t>bold</w:t>', '<w:t>&lt;&amp;&#65;&#x42;</w:t>');
    const loaded = await loadPocDocx(await replaceEntry('word/document.xml', xml));
    expect(loaded.runs[1]?.text).toBe('<&AB');
  });
});
