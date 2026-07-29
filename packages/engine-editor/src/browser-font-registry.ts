import type { DisplayPage, GlyphFont } from '@docx-editor.dev/core-contract/contracts/geometry';
import { EditorFontError } from '@docx-editor.dev/core-contract/contracts/editor';
import type { FontResourceSnapshot, Page, ResolvedFont } from '@docx-editor.dev/engine-layout';

export type BrowserFontPaintErrorCode =
  | 'missingFont'
  | 'hashInvalid'
  | 'fontMismatch'
  | 'unsupportedFace'
  | 'loadFailed';

export class BrowserFontPaintError extends EditorFontError {
  readonly name = 'BrowserFontPaintError';

  constructor(
    readonly code: BrowserFontPaintErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(code, message, { cause: options?.cause });
  }
}

export interface BrowserFontFace {
  load(): Promise<BrowserFontFace>;
}

export interface BrowserFontSet {
  add(face: BrowserFontFace): unknown;
  delete(face: BrowserFontFace): boolean;
}

export type BrowserFontFaceFactory = (
  family: string,
  bytes: ArrayBuffer,
  descriptors: Readonly<{ weight: string; style: string }>
) => BrowserFontFace;

export interface InstalledDisplayFonts {
  aliasFor(font: GlyphFont): string;
  release(): void;
}

interface RegistryEntry {
  readonly alias: string;
  readonly face: BrowserFontFace;
  loaded: Promise<void>;
  refs: number;
  added: boolean;
  cancelled: boolean;
}

const registries = new WeakMap<object, Map<string, RegistryEntry>>();

function registryFor(fontSet: BrowserFontSet): Map<string, RegistryEntry> {
  const key = fontSet as object;
  let registry = registries.get(key);
  if (!registry) {
    registry = new Map();
    registries.set(key, registry);
  }
  return registry;
}

function fontKey(font: GlyphFont | ResolvedFont): string {
  return `${font.hash}#${font.faceIndex}:${font.request.weight}:${font.request.style}`;
}

function fontAlias(font: GlyphFont | ResolvedFont): string {
  const digest = font.hash.replace(/^sha256:/, '');
  if (!/^[a-f0-9]{64}$/i.test(digest)) {
    throw new BrowserFontPaintError('fontMismatch', `Invalid resolved font hash: ${font.hash}`);
  }
  return `DocxFont_${digest.toLowerCase()}_${font.faceIndex}_${font.request.weight}_${font.request.style}`;
}

function sameFont(expected: GlyphFont, actual: ResolvedFont): boolean {
  return (
    expected.id === actual.id &&
    expected.identity === actual.identity &&
    expected.family === actual.family &&
    expected.hash === actual.hash &&
    expected.faceIndex === actual.faceIndex &&
    expected.byteLength === actual.byteLength &&
    expected.request.family === actual.request.family &&
    expected.request.weight === actual.request.weight &&
    expected.request.style === actual.request.style
  );
}

async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new BrowserFontPaintError(
      'hashInvalid',
      'Exact font painting requires the Web Crypto SHA-256 implementation'
    );
  }
  const owned = bytes.slice();
  const digest = await globalThis.crypto.subtle.digest('SHA-256', owned);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')}`;
}

function selectedFonts(pages: readonly DisplayPage[]): readonly GlyphFont[] {
  const selected = new Map<string, GlyphFont>();
  for (const page of pages) {
    for (const item of page.items) {
      if (item.kind !== 'text') continue;
      for (const run of item.runs) {
        selected.set(fontKey(run.font), run.font);
        for (const span of run.fontSpans) {
          if (span.font.identity !== run.font.identity) {
            throw new BrowserFontPaintError(
              'fontMismatch',
              `Glyph run ${run.font.identity} contains a different font span ${span.font.identity}; the display bridge must split it before DOM paint`
            );
          }
          selected.set(fontKey(span.font), span.font);
        }
      }
    }
  }
  return [...selected.values()];
}

function selectedLayoutFonts(pages: readonly Page[]): readonly GlyphFont[] {
  const selected = new Map<string, GlyphFont>();
  for (const page of pages) {
    for (const item of page.items) {
      if (item.type !== 'text') continue;
      const font = item.shapingEnvironment.font;
      selected.set(fontKey(font), font);
    }
  }
  return [...selected.values()];
}

const defaultFaceFactory: BrowserFontFaceFactory = (family, bytes, descriptors) => {
  if (typeof FontFace !== 'function') {
    throw new BrowserFontPaintError(
      'loadFailed',
      'This browser does not provide the FontFace API required for exact font painting'
    );
  }
  return new FontFace(family, bytes, descriptors) as unknown as BrowserFontFace;
};

function releaseEntry(
  registry: Map<string, RegistryEntry>,
  key: string,
  entry: RegistryEntry,
  fontSet: BrowserFontSet
): void {
  if (entry.refs > 0) entry.refs -= 1;
  if (entry.refs !== 0) return;
  entry.cancelled = true;
  if (registry.get(key) === entry) registry.delete(key);
  if (entry.added) fontSet.delete(entry.face);
}

async function installSelectedFonts(
  required: readonly GlyphFont[],
  fonts: FontResourceSnapshot,
  fontSet: BrowserFontSet,
  createFace: BrowserFontFaceFactory = defaultFaceFactory
): Promise<InstalledDisplayFonts> {
  const resolved = await Promise.all(
    required.map(async (published) => {
      const font = fonts.resolve(published.request);
      if (font instanceof Error) {
        const resolutionCode = (font as { code?: unknown }).code;
        throw new BrowserFontPaintError(
          resolutionCode === 'hashMismatch' ? 'hashInvalid' : 'missingFont',
          `Cannot paint ${published.identity}: ${font.message}`,
          { cause: font }
        );
      }
      if (!sameFont(published, font) || (await sha256(font.bytes)) !== published.hash) {
        throw new BrowserFontPaintError(
          'fontMismatch',
          `Layout selected ${published.identity}, but the supplied font snapshot resolved different bytes`
        );
      }
      if (font.faceIndex !== 0) {
        throw new BrowserFontPaintError(
          'unsupportedFace',
          `FontFace cannot select collection face ${font.faceIndex} for ${font.identity}`
        );
      }
      return { published, font };
    })
  );

  const registry = registryFor(fontSet);
  const held: { key: string; entry: RegistryEntry }[] = [];
  const aliases = new Map<string, string>();
  try {
    for (const { published, font } of resolved) {
      const key = fontKey(font);
      let entry = registry.get(key);
      if (!entry) {
        const alias = fontAlias(font);
        let face: BrowserFontFace;
        try {
          const bytes = font.bytes;
          const buffer = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
          ) as ArrayBuffer;
          face = createFace(alias, buffer, {
            weight: String(font.request.weight),
            style: font.request.style,
          });
        } catch (error) {
          if (error instanceof BrowserFontPaintError) throw error;
          throw new BrowserFontPaintError(
            'loadFailed',
            `Could not create FontFace for ${font.identity}`,
            { cause: error }
          );
        }
        entry = {
          alias,
          face,
          refs: 0,
          added: false,
          cancelled: false,
          loaded: Promise.resolve(),
        };
        const current = entry;
        current.loaded = current.face
          .load()
          .then(() => {
            if (current.cancelled || current.refs === 0) return;
            fontSet.add(current.face);
            current.added = true;
          })
          .catch((error) => {
            if (registry.get(key) === current) registry.delete(key);
            throw new BrowserFontPaintError(
              'loadFailed',
              `FontFace loading failed for ${font.identity}`,
              { cause: error }
            );
          });
        registry.set(key, current);
      }
      entry.refs += 1;
      held.push({ key, entry });
      aliases.set(fontKey(published), entry.alias);
    }
    await Promise.all(held.map(({ entry }) => entry.loaded));
  } catch (error) {
    for (const { key, entry } of held) releaseEntry(registry, key, entry, fontSet);
    throw error;
  }

  let released = false;
  return Object.freeze({
    aliasFor(font: GlyphFont): string {
      const alias = aliases.get(fontKey(font));
      if (!alias) {
        throw new BrowserFontPaintError(
          'fontMismatch',
          `No installed font mapping exists for ${font.identity}`
        );
      }
      return alias;
    },
    release(): void {
      if (released) return;
      released = true;
      for (const { key, entry } of held) releaseEntry(registry, key, entry, fontSet);
    },
  });
}

export async function installDisplayFonts(
  pages: readonly DisplayPage[],
  fonts: FontResourceSnapshot,
  fontSet: BrowserFontSet,
  createFace: BrowserFontFaceFactory = defaultFaceFactory
): Promise<InstalledDisplayFonts> {
  return await installSelectedFonts(selectedFonts(pages), fonts, fontSet, createFace);
}

export async function installLayoutFonts(
  pages: readonly Page[],
  fonts: FontResourceSnapshot,
  fontSet: BrowserFontSet,
  createFace: BrowserFontFaceFactory = defaultFaceFactory
): Promise<InstalledDisplayFonts> {
  return await installSelectedFonts(selectedLayoutFonts(pages), fonts, fontSet, createFace);
}
