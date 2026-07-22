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
let nextSaveTestClientId = 0x3000_0000;

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

  test('rejects invalid run property shapes', async () => {
    const loaded = await loadedFixture();
    await expect(
      savePocDocx(loaded, {
        paragraphId: loaded.paragraphId,
        text: 'x',
        runs: [{ text: 'x', bold: 'yes' as unknown as boolean, italic: false }],
      })
    ).rejects.toThrow(/run/i);
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
