/**
 * The packaged CJK face for the editor in a browser: a font resolver that composes next to
 * `packagedFonts()` and `googleFonts()` from `@docx-editor.dev/fonts`.
 *
 * ```ts
 * import { packagedFonts } from '@docx-editor.dev/fonts';
 * import { googleFonts } from '@docx-editor.dev/fonts/google';
 * import { cjkFonts } from '@docx-editor.dev/fonts-cjk/browser';
 *
 * const fonts = [packagedFonts(), googleFonts(), cjkFonts()];
 * ```
 *
 * @packageDocumentation
 * @public
 */
import {
  CJK_SUBSTITUTED_FAMILIES,
  LOCALIZED_CJK_FAMILIES,
  NOTO_SANS_CJK_JP_FAMILY,
  NOTO_SANS_CJK_JP_SHA256,
} from './families.ts';

export { CJK_SUBSTITUTED_FAMILIES, LOCALIZED_CJK_FAMILIES, NOTO_SANS_CJK_JP_FAMILY };

/**
 * Where the packaged face is, as the bundler leaves it. Vite and native ESM keep the
 * expression as a `URL`; webpack and Turbopack replace it with the path STRING of the asset
 * they emitted. Built when first needed, not at module scope: a build without
 * `import.meta.url` then fails one font request, not the import of this module.
 */
const faceLocation = (): URL | string =>
  new URL('../assets/NotoSansCJKjp-Regular.otf', import.meta.url);

/**
 * One face an earlier origin in the same composition can already paint, structurally the
 * editor contract's `FontFaceRequest`.
 *
 * @public
 */
export interface CjkResolvedFontFace {
  /** The family name, matched case-insensitively. */
  readonly family: string;
  /** CSS numeric weight. */
  readonly weight: number;
  /** Whether this is the upright or the italic face. */
  readonly style: 'normal' | 'italic';
}

/**
 * The request the resolver takes, structurally the editor contract's `FontResolutionRequest`.
 *
 * @public
 */
export interface CjkFontsRequest {
  /** Families the document declares, already name-validated and capped by the engine. */
  readonly families: readonly string[];
  /** The face a run naming no font resolves to. */
  readonly defaultFamily: string;
  /** Cancels the request. The resolver rejects with `signal.reason`. */
  readonly signal?: AbortSignal;
  /** Faces an earlier origin in the same composition can already paint. */
  readonly resolvedFaces?: readonly CjkResolvedFontFace[];
}

/**
 * A face request, structurally the editor contract's `FontFaceRequest`.
 *
 * @public
 */
export interface CjkFontFaceRequest {
  /** The family name. */
  readonly family: string;
  /** CSS numeric weight. */
  readonly weight: number;
  /** Whether this is the upright or the italic face. */
  readonly style: 'normal' | 'italic';
}

/**
 * The packaged face as a font source, structurally the editor contract's `FontSource`.
 *
 * @public
 */
export interface CjkFontSource {
  /** The face this source supplies: {@link NOTO_SANS_CJK_JP_FAMILY}, 400, normal. */
  readonly request: CjkFontFaceRequest;
  /** A stable identifier for the source. */
  readonly id: string;
  /** The font file. */
  readonly bytes: Uint8Array;
  /** `sha256:` and the hexadecimal SHA-256 of `bytes`. The editor checks it on admission. */
  readonly hash: string;
  /** Always 0: the file holds one face. */
  readonly faceIndex: number;
}

/**
 * What one resolver call produced, structurally the editor contract's
 * `FontConfigurationFragment`.
 *
 * @public
 */
export interface CjkFontsFragment {
  /** The packaged face, when the document names a family it stands in for. */
  readonly sources: readonly CjkFontSource[];
  /** Every face of each named East Asian family, pointed at the packaged face. */
  readonly substitutions: readonly {
    readonly from: CjkFontFaceRequest;
    readonly to: CjkFontFaceRequest;
  }[];
  /**
   * With `loading: 'background'`, the face and its substitutions, settled after the
   * download. The editor paints the document first and lays it out again on arrival.
   */
  readonly deferred?: Promise<CjkFontsFragment>;
}

/**
 * Whether a large CJK font download may delay the first paint.
 *
 * - `'background'`: the face installs in a separate step, after the document's other fonts.
 *   The first paint never waits for it, and text in it can move once when it arrives.
 * - `'wait'`: the face installs in the same step as the document's other fonts. A large
 *   document (over about 512 KB of uncompressed content) waits up to 2 seconds for them
 *   before its first paint. A small document paints at once and lays out again when all
 *   of its fonts arrive.
 *
 * Either way, a document export that receives this resolver waits for the face.
 *
 * @public
 */
export type CjkFontLoading = 'background' | 'wait';

/**
 * A fetch of the packaged face that failed for a reason other than cancellation.
 *
 * @public
 */
export interface CjkFontLoadFailure {
  /** Always {@link NOTO_SANS_CJK_JP_FAMILY}. */
  readonly family: string;
  /** The URL the resolver fetched, or an empty string when it could not build one. */
  readonly url: string;
  /** Why the fetch failed. */
  readonly diagnostic: string;
}

/**
 * Options for {@link cjkFonts}.
 *
 * @public
 */
export interface CjkFontsOptions {
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetcher?: typeof fetch;
  /** Fetch failures. Defaults to a console warning. The document keeps its other fonts. */
  readonly onFailure?: (failure: CjkFontLoadFailure) => void;
  /**
   * Whether the download may delay the document. Defaults to `'background'`, because the
   * face is about 16 MB. See {@link CjkFontLoading}.
   */
  readonly loading?: CjkFontLoading;
}

/**
 * Brand and string mark of a resolver, the same pair `defineFontResolver` from the editor
 * and the resolvers in `@docx-editor.dev/fonts` set.
 */
const FONT_RESOLVER_BRAND: unique symbol = Symbol.for('docx-editor.dev/font-resolver') as never;
const FONT_RESOLVER_MARK_KEY = 'docx-editor.dev/font-resolver';

/**
 * The marker the editor reads to call a function per document.
 *
 * @public
 */
export interface CjkFontResolverMark {
  /** Always `true`. Set non-enumerably. */
  readonly 'docx-editor.dev/font-resolver': true;
}

/**
 * What {@link cjkFonts} returns: a marked resolver over the packaged CJK face.
 *
 * @public
 */
export type CjkFontsResolver = ((request: CjkFontsRequest) => Promise<CjkFontsFragment>) &
  CjkFontResolverMark;

/** Case-folded declared name -> its English name, for every name the face stands in for. */
const SUBSTITUTED: ReadonlyMap<string, string> = new Map([
  ...CJK_SUBSTITUTED_FAMILIES.map((family) => [family.toLowerCase(), family] as const),
  ...[...LOCALIZED_CJK_FAMILIES.keys()].map(
    (localized) => [localized.toLowerCase(), localized] as const
  ),
]);

const FACES = [
  [400, 'normal'],
  [700, 'normal'],
  [400, 'italic'],
  [700, 'italic'],
] as const;

/** The packaged face as the editor receives it. */
const PACKAGED_FACE: CjkFontFaceRequest = {
  family: NOTO_SANS_CJK_JP_FAMILY,
  weight: 400,
  style: 'normal',
};

/** One download of the face, shared by every request that waits for it. */
interface SharedLoad {
  readonly bytes: Promise<Uint8Array>;
  /** Stops the download; set while it is still running. */
  readonly controller: AbortController;
  waiters: number;
  settled: boolean;
}

/** The global `fetch`, looked up per call so a host that replaces it later is honoured. */
const defaultFetch = ((input: string, init?: RequestInit) =>
  globalThis.fetch(input, init)) as typeof fetch;

/**
 * Loads per fetcher, so documents opened one after another download the face once. Without
 * an injected fetcher every resolver shares {@link defaultFetch}, and so one entry.
 */
const loadsByFetcher = new WeakMap<typeof fetch, SharedLoad>();

function startLoad(fetcher: typeof fetch, url: string): SharedLoad {
  const controller = new AbortController();
  const load: SharedLoad = {
    controller,
    waiters: 0,
    settled: false,
    bytes: fetcher(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((buffer) => new Uint8Array(buffer)),
  };
  load.bytes.then(
    () => {
      load.settled = true;
    },
    () => {
      load.settled = true;
      // A failed or stopped download is not kept: the next document tries again.
      if (loadsByFetcher.get(fetcher) === load) loadsByFetcher.delete(fetcher);
    }
  );
  loadsByFetcher.set(fetcher, load);
  return load;
}

/**
 * The face's bytes for one request. A request that is cancelled stops waiting at once and
 * rejects with `signal.reason`; the download itself stops when no request waits for it.
 */
function loadFace(fetcher: typeof fetch, url: string, signal?: AbortSignal): Promise<Uint8Array> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  const load = loadsByFetcher.get(fetcher) ?? startLoad(fetcher, url);
  load.waiters += 1;
  return new Promise<Uint8Array>((resolve, reject) => {
    let left = false;
    const leave = () => {
      if (left) return;
      left = true;
      signal?.removeEventListener('abort', onAbort);
      load.waiters -= 1;
    };
    const onAbort = () => {
      leave();
      if (load.waiters === 0 && !load.settled) {
        if (loadsByFetcher.get(fetcher) === load) loadsByFetcher.delete(fetcher);
        load.controller.abort(signal!.reason);
      }
      reject(signal!.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    load.bytes.then(
      (bytes) => {
        leave();
        resolve(bytes);
      },
      (error: unknown) => {
        leave();
        reject(error);
      }
    );
  });
}

/**
 * The packaged CJK face, served ON DEMAND: a font resolver that fetches the face only when a
 * document names one of the {@link CJK_SUBSTITUTED_FAMILIES}, in English or in a localized
 * name ({@link LOCALIZED_CJK_FAMILIES}), or names {@link NOTO_SANS_CJK_JP_FAMILY} itself.
 * A document without one never downloads the 16 MB face.
 *
 * The face has one weight and one style, so every face of a named family points at it. Put
 * it after the origins whose faces you prefer. A family an earlier origin paints by the time
 * this resolver runs is left to that origin. A face an earlier origin loads in the background
 * is not painted yet, so this face still downloads.
 *
 * The download does not delay the first paint by default: the document paints with its other
 * fonts and lays out again when this face arrives. See {@link CjkFontLoading} for
 * `loading: 'wait'`. A document export that receives this resolver waits for the face.
 *
 * The face is the file inside this package, fetched from where your bundler emits it. Nothing
 * comes from a third party. A failed fetch reports through `onFailure` and the document keeps
 * its other fonts; cancellation rejects with `signal.reason`.
 *
 * @public
 */
export function cjkFonts(options: CjkFontsOptions = {}): CjkFontsResolver {
  async function resolveCjkFonts(request: CjkFontsRequest): Promise<CjkFontsFragment> {
    const painted = new Set(
      (request.resolvedFaces ?? [])
        .filter((face) => face.weight === 400 && face.style === 'normal')
        .map((face) => face.family.trim().toLowerCase())
    );
    const planned = request.families.filter((family) => {
      const key = family.trim().toLowerCase();
      return SUBSTITUTED.has(key) && !painted.has(key);
    });
    const named = request.families.some(
      (family) => family.trim().toLowerCase() === NOTO_SANS_CJK_JP_FAMILY.toLowerCase()
    );
    if (planned.length === 0 && !named) return { sources: [], substitutions: [] };
    if (painted.has(NOTO_SANS_CJK_JP_FAMILY.toLowerCase())) {
      return { sources: [], substitutions: substitutionsFor(planned) };
    }
    if ((options.loading ?? 'background') === 'background') {
      // Settles, never rejects: a cancelled load answers nothing instead.
      const deferred = downloadFace(planned, request).catch(() => EMPTY);
      return { sources: [], substitutions: [], deferred };
    }
    return downloadFace(planned, request);
  }
  async function downloadFace(
    planned: readonly string[],
    request: CjkFontsRequest
  ): Promise<CjkFontsFragment> {
    const fetcher = options.fetcher ?? defaultFetch;
    let url = '';
    let bytes: Uint8Array;
    try {
      const location = faceLocation();
      url = typeof location === 'string' ? location : location.href;
      bytes = await loadFace(fetcher, url, request.signal);
    } catch (error) {
      if (request.signal?.aborted) throw request.signal.reason;
      const failure = {
        family: NOTO_SANS_CJK_JP_FAMILY,
        url,
        diagnostic: error instanceof Error ? error.message : String(error),
      };
      if (options.onFailure) options.onFailure(failure);
      else console.warn(`[fonts-cjk] ${failure.family} (${failure.url}): ${failure.diagnostic}`);
      return { sources: [], substitutions: [] };
    }
    if (request.signal?.aborted) throw request.signal.reason;
    return {
      sources: [
        {
          request: PACKAGED_FACE,
          id: 'fonts-cjk:noto-sans-cjk-jp#400#normal',
          bytes,
          hash: `sha256:${NOTO_SANS_CJK_JP_SHA256}`,
          faceIndex: 0,
        },
      ],
      substitutions: substitutionsFor(planned),
    };
  }
  const descriptor = { value: true, enumerable: false, configurable: true } as const;
  Object.defineProperty(resolveCjkFonts, FONT_RESOLVER_BRAND, descriptor);
  Object.defineProperty(resolveCjkFonts, FONT_RESOLVER_MARK_KEY, descriptor);
  return resolveCjkFonts as CjkFontsResolver;
}

const EMPTY: CjkFontsFragment = Object.freeze({ sources: [], substitutions: [] });

function substitutionsFor(families: readonly string[]): CjkFontsFragment['substitutions'] {
  return families.flatMap((family) =>
    FACES.map(([weight, style]) => ({ from: { family, weight, style }, to: PACKAGED_FACE }))
  );
}
