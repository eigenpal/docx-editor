import { describe, expect, test } from 'bun:test';
import JSZip from 'jszip';
import { createHeadlessPocEditorDriver } from '../src/poc/headless-driver';
import { nonEmptyString } from '../src/driver/editor-driver';
import {
  POC_PARAGRAPH_ID,
  createPocDocxFixture,
  loadPocDocx,
  savePocDocx,
  type LoadedPocDocx,
  type PocRun,
  type PocSaveSnapshot,
} from '../src/poc/docx';
import { createPocStore, type PocSnapshot } from '../src/poc/store';

const MAX_RUNS = 32;
const MAX_RUN_TEXT_LENGTH = 4096;
const MAX_TOTAL_TEXT_LENGTH = 8192;
const REQUIRED_PATHS = [
  '[Content_Types].xml',
  '_rels/.rels',
  'word/_rels/document.xml.rels',
  'word/styles.xml',
  'word/document.xml',
] as const;
let nextSaveTestClientId = 0x3000_0000;

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

function buildClassicZip(parts: readonly (readonly [string, Uint8Array])[]): Uint8Array {
  const UTF8_FLAG = 0x0800;
  const local: number[] = [];
  const central: number[] = [];
  let offset = 0;
  for (const [path, data] of parts) {
    const name = new TextEncoder().encode(path);
    const crc = crc32(data);
    local.push(
      0x50, 0x4b, 0x03, 0x04,
      ...u16(20), ...u16(UTF8_FLAG), ...u16(0),
      ...u16(0), ...u16(0x21),
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(name.length), ...u16(0), ...name, ...data
    );
    central.push(
      0x50, 0x4b, 0x01, 0x02,
      ...u16(20), ...u16(20), ...u16(UTF8_FLAG), ...u16(0),
      ...u16(0), ...u16(0x21),
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0),
      ...u32(offset), ...name
    );
    offset = local.length;
  }
  const centralOffset = local.length;
  return new Uint8Array([
    ...local,
    ...central,
    0x50, 0x4b, 0x05, 0x06,
    ...u16(0), ...u16(0),
    ...u16(parts.length), ...u16(parts.length),
    ...u32(central.length), ...u32(centralOffset), ...u16(0),
  ]);
}

async function loadedWithDocumentXml(edit: (xml: string) => string): Promise<LoadedPocDocx> {
  const zip = await JSZip.loadAsync(await createPocDocxFixture());
  const parts = await Promise.all(
    REQUIRED_PATHS.map(async (path) => {
      const data =
        path === 'word/document.xml'
          ? new TextEncoder().encode(edit(await zip.file(path)!.async('string')))
          : await zip.file(path)!.async('uint8array');
      return [path, data] as const;
    })
  );
  return loadPocDocx(buildClassicZip(parts));
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

async function loadedFixture(): Promise<LoadedPocDocx> {
  return loadPocDocx(await createPocDocxFixture());
}

function snapshotFromStore(mutate?: (store: ReturnType<typeof createPocStore>) => void): Promise<{
  loaded: LoadedPocDocx;
  snapshot: PocSnapshot;
}> {
  return loadedFixture().then((loaded) => {
    const store = createPocStore(loaded, {
      actorId: 'save-test',
      sessionId: `save-test-session-${nextSaveTestClientId}`,
      clientId: nextSaveTestClientId++,
    });
    mutate?.(store);
    return { loaded, snapshot: store.snapshot() };
  });
}

async function documentXmlFromBytes(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  return zip.file('word/document.xml')!.async('string');
}

function extractCapsuleSubstring(documentXml: string): string {
  const start = documentXml.indexOf('<custom:PocUnsupported');
  const end = documentXml.indexOf('</custom:PocUnsupported>') + '</custom:PocUnsupported>'.length;
  if (start < 0 || end <= start) throw new Error('capsule missing from document.xml');
  return documentXml.slice(start, end);
}

describe('POC savePocDocx round trip', () => {
  test('preserves semantic text and maximal bold/italic coverage after edit', async () => {
    const { loaded, snapshot } = await snapshotFromStore((store) => {
      store.delete(6, 10);
      store.insert(6, 'WORLD');
      store.toggleMark(6, 11, 'bold');
    });
    const saved = await savePocDocx(loaded, snapshot);
    const reopened = await loadPocDocx(saved);
    expect(reopened.text).toBe('Hello WORLD italic');
    expect(reopened.runs).toEqual([
      { text: 'Hello ', bold: false, italic: false },
      { text: 'WORLD', bold: true, italic: false },
      { text: ' ', bold: false, italic: false },
      { text: 'italic', bold: false, italic: true },
    ]);
  });

  test('preserves mixed bold+italic marks and xml:space boundary whitespace', async () => {
    const { loaded, snapshot } = await snapshotFromStore((store) => {
      store.delete(0, store.snapshot().text.length);
      store.insert(0, ' mix ');
      store.toggleMark(1, 4, 'bold');
      store.toggleMark(1, 4, 'italic');
    });
    const saved = await savePocDocx(loaded, snapshot);
    const xml = await documentXmlFromBytes(saved);
    expect(xml).toContain('<w:t xml:space="preserve"> </w:t>');
    expect(xml).toContain('<w:rPr><w:b/><w:i/></w:rPr><w:t>mix</w:t>');
    const reopened = await loadPocDocx(saved);
    expect(reopened.text).toBe(' mix ');
    expect(reopened.runs).toEqual([
      { text: ' ', bold: false, italic: false },
      { text: 'mix', bold: true, italic: true },
      { text: ' ', bold: false, italic: false },
    ]);
  });

  test('save and reopen canonical empty document after delete-all', async () => {
    const { loaded, snapshot } = await snapshotFromStore((store) => {
      store.delete(0, store.snapshot().text.length);
    });
    expect(snapshot).toEqual({ paragraphId: POC_PARAGRAPH_ID, text: '', runs: [] });
    const saved = await savePocDocx(loaded, snapshot);
    const xml = await documentXmlFromBytes(saved);
    expect(xml).toContain('<poc:OwnedStart/><poc:OwnedEnd/>');
    expect(xml).not.toMatch(/<poc:OwnedStart\/>\s*<w:r>/);
    const reopened = await loadPocDocx(saved);
    expect(reopened.text).toBe('');
    expect(reopened.runs).toEqual([]);
    expect(reopened.paragraphId).toBe(POC_PARAGRAPH_ID);
  });

  test('preserves stable paragraph identity', async () => {
    const { loaded, snapshot } = await snapshotFromStore((store) => {
      store.insert(store.snapshot().text.length, '!');
    });
    const saved = await savePocDocx(loaded, snapshot);
    const reopened = await loadPocDocx(saved);
    expect(reopened.paragraphId).toBe(POC_PARAGRAPH_ID);
  });

  test('preserves exact captured capsule substring bytes in document.xml', async () => {
    const loaded = await loadedFixture();
    const saved = await savePocDocx(loaded, {
      paragraphId: loaded.paragraphId,
      text: loaded.text,
      runs: loaded.runs,
    });
    const xml = await documentXmlFromBytes(saved);
    const capsuleFromSaved = new TextEncoder().encode(extractCapsuleSubstring(xml));
    expect(bytesEqual(capsuleFromSaved, loaded.capsuleBytes)).toBe(true);
  });

  test('ignores forged LoadedPocDocx capsuleBytes and re-enters trust boundary', async () => {
    const loaded = await loadedFixture();
    const forged = Object.freeze({
      ...loaded,
      get capsuleBytes(): Uint8Array {
        return new TextEncoder().encode('<custom:PocUnsupported>FORGED</custom:PocUnsupported>');
      },
    }) as LoadedPocDocx;
    const saved = await savePocDocx(forged, {
      paragraphId: loaded.paragraphId,
      text: loaded.text,
      runs: loaded.runs,
    });
    const xml = await documentXmlFromBytes(saved);
    expect(xml).toContain('deadbeef');
    expect(xml).not.toContain('FORGED');
    expect(
      bytesEqual(
        new TextEncoder().encode(extractCapsuleSubstring(xml)),
        loaded.capsuleBytes
      )
    ).toBe(true);
  });

  test('XML-escapes attacker-controlled authored text on save', async () => {
    const payload = `&<>\"' attack`;
    const { loaded, snapshot } = await snapshotFromStore((store) => {
      store.delete(0, store.snapshot().text.length);
      store.insert(0, payload);
    });
    const saved = await savePocDocx(loaded, snapshot);
    const xml = await documentXmlFromBytes(saved);
    expect(xml).toContain('&amp;&lt;&gt;&quot;&apos; attack');
    expect(xml).not.toContain(payload);
    const reopened = await loadPocDocx(saved);
    expect(reopened.text).toBe(payload);
    expect(reopened.runs).toEqual([{ text: payload, bold: false, italic: false }]);
  });

  test('deterministic supported output semantics for unchanged fixture snapshot', async () => {
    const loaded = await loadedFixture();
    const snapshot: PocSaveSnapshot = {
      paragraphId: loaded.paragraphId,
      text: loaded.text,
      runs: loaded.runs,
    };
    const first = await savePocDocx(loaded, snapshot);
    const second = await savePocDocx(loaded, snapshot);
    const reopenedFirst = await loadPocDocx(first);
    const reopenedSecond = await loadPocDocx(second);
    expect(reopenedFirst).toMatchObject({
      paragraphId: loaded.paragraphId,
      text: loaded.text,
      runs: loaded.runs,
    });
    expect(reopenedSecond).toMatchObject({
      paragraphId: loaded.paragraphId,
      text: loaded.text,
      runs: loaded.runs,
    });
    expect(bytesEqual(reopenedFirst.capsuleBytes, reopenedSecond.capsuleBytes)).toBe(true);
  });
});

describe('POC savePocDocx rejection', () => {
  test('rejects forged paragraph identity mismatch', async () => {
    const loaded = await loadedFixture();
    await expect(
      savePocDocx(loaded, {
        paragraphId: 'wrong-id',
        text: loaded.text,
        runs: loaded.runs,
      })
    ).rejects.toThrow(/paragraph identity/i);
  });

  test('rejects runs that do not reconstruct snapshot text', async () => {
    const loaded = await loadedFixture();
    await expect(
      savePocDocx(loaded, {
        paragraphId: loaded.paragraphId,
        text: loaded.text,
        runs: [{ text: 'Hello', bold: false, italic: false }],
      })
    ).rejects.toThrow(/reconstruct/i);
  });

  test('rejects non-maximal run coverage', async () => {
    const loaded = await loadedFixture();
    const nonMaximal: readonly PocRun[] = [
      { text: 'Hello ', bold: false, italic: false },
      { text: 'b', bold: false, italic: false },
    ];
    await expect(
      savePocDocx(loaded, {
        paragraphId: loaded.paragraphId,
        text: 'Hello b',
        runs: nonMaximal,
      })
    ).rejects.toThrow(/maxim/i);
  });

  test('rejects oversized aggregate text and run bounds', async () => {
    const loaded = await loadedFixture();
    await expect(
      savePocDocx(loaded, {
        paragraphId: loaded.paragraphId,
        text: 'x'.repeat(MAX_TOTAL_TEXT_LENGTH + 1),
        runs: [{ text: 'x'.repeat(MAX_TOTAL_TEXT_LENGTH + 1), bold: false, italic: false }],
      })
    ).rejects.toThrow(/text exceeds/i);
    await expect(
      savePocDocx(loaded, {
        paragraphId: loaded.paragraphId,
        text: 'x'.repeat(MAX_RUN_TEXT_LENGTH + 1),
        runs: [{ text: 'x'.repeat(MAX_RUN_TEXT_LENGTH + 1), bold: false, italic: false }],
      })
    ).rejects.toThrow(/run text/i);
    await expect(
      savePocDocx(loaded, {
        paragraphId: loaded.paragraphId,
        text: 'x'.repeat(MAX_RUNS + 1),
        runs: Array.from({ length: MAX_RUNS + 1 }, () => ({
          text: 'x',
          bold: false,
          italic: false,
        })),
      })
    ).rejects.toThrow(/run count/i);
  });

  test('rejects malformed source bytes through the same load trust boundary', async () => {
    const loaded = await loadedFixture();
    const tampered = new Uint8Array(loaded.sourceBytes);
    tampered[tampered.length - 4] ^= 0xff;
    const forged = Object.freeze({
      paragraphId: loaded.paragraphId,
      text: loaded.text,
      runs: loaded.runs,
      get sourceBytes(): Uint8Array {
        return tampered;
      },
      get capsuleBytes(): Uint8Array {
        return loaded.capsuleBytes;
      },
    }) as LoadedPocDocx;
    await expect(
      savePocDocx(forged, {
        paragraphId: loaded.paragraphId,
        text: loaded.text,
        runs: loaded.runs,
      })
    ).rejects.toThrow();
  });

  test('rejects empty individual runs in non-empty snapshots', async () => {
    const loaded = await loadedFixture();
    await expect(
      savePocDocx(loaded, {
        paragraphId: loaded.paragraphId,
        text: 'ab',
        runs: [
          { text: 'a', bold: false, italic: false },
          { text: '', bold: false, italic: false },
        ],
      })
    ).rejects.toThrow(/empty/i);
  });

  test('rejects invalid run property shapes', async () => {
    const loaded = await loadedFixture();
    await expect(
      savePocDocx(loaded, {
        paragraphId: loaded.paragraphId,
        text: 'x',
        runs: [{ text: 'x', bold: 'yes' as unknown as boolean, italic: false }],
      })
    ).rejects.toThrow(/formatting/i);
  });
});

describe('POC savePocDocx trust-boundary inputs', () => {
  test('rejects snapshot objects with unknown fields or accessor properties', async () => {
    const loaded = await loadedFixture();
    await expect(
      savePocDocx(loaded, {
        paragraphId: loaded.paragraphId,
        text: loaded.text,
        runs: loaded.runs,
        forged: true,
      } as PocSaveSnapshot)
    ).rejects.toThrow(/fields/i);
    await expect(
      savePocDocx(loaded, {
        get paragraphId() {
          return loaded.paragraphId;
        },
        text: loaded.text,
        runs: loaded.runs,
      } as PocSaveSnapshot)
    ).rejects.toThrow(/accessor/i);
  });

  test('rejects save source objects with unknown fields', async () => {
    const loaded = await loadedFixture();
    await expect(
      savePocDocx(
        { ...loaded, forged: true } as LoadedPocDocx,
        { paragraphId: loaded.paragraphId, text: loaded.text, runs: loaded.runs }
      )
    ).rejects.toThrow(/fields/i);
  });

  test('snapshots inputs before await so post-call mutation does not change saved bytes', async () => {
    const loaded = await loadedFixture();
    const mutable = {
      paragraphId: loaded.paragraphId,
      text: 'stable',
      runs: [{ text: 'stable', bold: false, italic: false }],
    };
    const pending = savePocDocx(loaded, mutable);
    mutable.text = 'mutated';
    mutable.runs[0]!.text = 'mutated';
    const saved = await pending;
    expect((await loadPocDocx(saved)).text).toBe('stable');
  });

  test('returns defensive byte copies that do not alias caller buffers', async () => {
    const loaded = await loadedFixture();
    const snapshot: PocSaveSnapshot = {
      paragraphId: loaded.paragraphId,
      text: loaded.text,
      runs: loaded.runs,
    };
    const first = await savePocDocx(loaded, snapshot);
    const second = await savePocDocx(loaded, snapshot);
    expect(first).not.toBe(second);
    first[0] ^= 0xff;
    expect(bytesEqual(first, second)).toBe(false);
    expect(await loadPocDocx(second)).toMatchObject({
      paragraphId: loaded.paragraphId,
      text: loaded.text,
    });
  });
});

describe('POC savePocDocx unowned document preservation', () => {
  test('splices using tokenizer offsets for whitespace-equivalent owned markers', async () => {
    const loaded = await loadedWithDocumentXml((xml) =>
      xml
        .replace('<poc:OwnedStart/>', '<poc:OwnedStart />')
        .replace('<poc:OwnedEnd/>', '<poc:OwnedEnd />')
    );
    const trustedXml = await documentXmlFromBytes(loaded.sourceBytes);
    expect(trustedXml).toContain('<poc:OwnedStart />');
    expect(trustedXml).toContain('<poc:OwnedEnd />');
    const ownedStartEnd =
      trustedXml.indexOf('<poc:OwnedStart />') + '<poc:OwnedStart />'.length;
    const ownedEndStart = trustedXml.indexOf('<poc:OwnedEnd />', ownedStartEnd);
    const prefix = trustedXml.slice(0, ownedStartEnd);
    const suffix = trustedXml.slice(ownedEndStart);

    const saved = await savePocDocx(loaded, {
      paragraphId: loaded.paragraphId,
      text: 'edited marker spacing',
      runs: [{ text: 'edited marker spacing', bold: false, italic: false }],
    });
    const savedXml = await documentXmlFromBytes(saved);
    expect(savedXml.startsWith(prefix)).toBe(true);
    expect(savedXml.endsWith(suffix)).toBe(true);
    expect(
      bytesEqual(
        new TextEncoder().encode(extractCapsuleSubstring(savedXml)),
        loaded.capsuleBytes
      )
    ).toBe(true);

    const reopened = await loadPocDocx(saved);
    expect(reopened.text).toBe('edited marker spacing');
    expect(reopened.paragraphId).toBe(POC_PARAGRAPH_ID);
  });

  test('preserves trusted unowned prefix and suffix bytes including capsule and section geometry', async () => {
    const loaded = await loadedWithDocumentXml((xml) =>
      xml.replace('w:w="12240"', 'w:w="9999"').replace('<w:body>', '<w:body>\n  ')
    );
    const trustedXml = await documentXmlFromBytes(loaded.sourceBytes);
    const { prefix, suffix } = (() => {
      const start = trustedXml.indexOf('<poc:OwnedStart/>') + '<poc:OwnedStart/>'.length;
      const end = trustedXml.indexOf('<poc:OwnedEnd/>', start);
      return { prefix: trustedXml.slice(0, start), suffix: trustedXml.slice(end) };
    })();
    const saved = await savePocDocx(loaded, {
      paragraphId: loaded.paragraphId,
      text: 'edited',
      runs: [{ text: 'edited', bold: false, italic: false }],
    });
    const savedXml = await documentXmlFromBytes(saved);
    expect(savedXml.startsWith(prefix)).toBe(true);
    expect(savedXml.endsWith(suffix)).toBe(true);
    expect(savedXml).toContain('w:w="9999"');
    expect(savedXml).toContain('<w:body>\n  ');
    expect(
      bytesEqual(
        new TextEncoder().encode(extractCapsuleSubstring(savedXml)),
        loaded.capsuleBytes
      )
    ).toBe(true);
  });

  test('keeps required ZIP entries semantically valid and preserves non-document part bytes', async () => {
    const loaded = await loadedFixture();
    const snapshot: PocSaveSnapshot = {
      paragraphId: loaded.paragraphId,
      text: loaded.text,
      runs: loaded.runs,
    };
    const saved = await savePocDocx(loaded, snapshot);
    const sourceZip = await JSZip.loadAsync(loaded.sourceBytes);
    const savedZip = await JSZip.loadAsync(saved);
    expect(Object.keys(savedZip.files).sort()).toEqual([...REQUIRED_PATHS].sort());
    for (const path of REQUIRED_PATHS) {
      if (path === 'word/document.xml') continue;
      expect(await savedZip.file(path)!.async('uint8array')).toEqual(
        await sourceZip.file(path)!.async('uint8array')
      );
    }
    await expect(loadPocDocx(saved)).resolves.toMatchObject({
      paragraphId: loaded.paragraphId,
      text: loaded.text,
    });
  });
});

describe('POC EditorDriver save and reopen', () => {
  test('save returns bytes from canonical snapshot and reload preserves semantics', async () => {
    const driver = createHeadlessPocEditorDriver();
    await driver.loadDocx(await createPocDocxFixture());
    await driver.selectText('italic');
    await driver.type('italic!');

    const saveResult = await driver.save();
    expect(saveResult.status).toBe('saved');
    expect(saveResult.bytes).toBeInstanceOf(Uint8Array);

    await driver.loadDocx(saveResult.bytes!);
    expect(await driver.query({ type: 'findText', text: nonEmptyString('Hello bold italic!') })).toEqual({
      type: 'findText',
      ranges: [
        expect.objectContaining({
          blockId: POC_PARAGRAPH_ID,
          start: 0,
          end: 'Hello bold italic!'.length,
        }),
      ],
    });
  });
});

describe('POC save security sinks', () => {
  test('save path does not introduce fetch or HTML-from-string sinks', async () => {
    const source = await Bun.file(new URL('../src/poc/docx.ts', import.meta.url)).text();
    const saveSection = source.slice(source.indexOf('export async function savePocDocx'));
    expect(saveSection).not.toMatch(/fetch\s*\(/);
    expect(saveSection).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });
});
