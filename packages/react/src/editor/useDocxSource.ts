// Opening a document, as a hook.
//
// Every host was writing the same thirty lines to get one document on screen: fetch the
// bytes, load and install the fonts, compose them into a `FontConfiguration`, keep the two
// from racing, cancel both if the component unmounts or the source changes, and turn a
// failure into something renderable. None of that is about the host's product, and getting
// the cancellation wrong is the kind of bug that only shows up as a React warning in
// somebody else's console.
//
// FONTS ARE PASSED IN, not imported. `@docx-editor.dev/fonts` ships font BYTES; making this
// package depend on it would put megabytes in the bundle of every consumer who brings their
// own faces or wants none. So the hook takes a loader — `{ fonts: defaultFonts }` for Word's
// defaults — and owns only the wiring around it.

import { useEffect, useRef, useState } from 'react';
import { composeFontConfiguration } from '@docx-editor.dev/core-contract/editor';
import type { FontConfigurationFragment } from '@docx-editor.dev/core-contract/editor';
import type { FontConfiguration } from '@docx-editor.dev/core-contract/contracts/editor';

/** A complete configuration, or a fragment this hook composes with the defaults. @public */
export type DocxFontsInput = FontConfiguration | FontConfigurationFragment;

/**
 * How a host supplies fonts: a value, a promise, or a function returning either.
 *
 * The function form is the useful one — `{ fonts: defaultFonts }` from
 * `@docx-editor.dev/fonts` — because it defers the work until the hook actually runs it.
 *
 * @public
 */
export type DocxFontsSource =
  | DocxFontsInput
  | Promise<DocxFontsInput>
  | (() => DocxFontsInput | Promise<DocxFontsInput>);

/** What the document itself can be: a URL to fetch, or bytes already in hand. @public */
export type DocxSource = string | URL | Uint8Array | ArrayBuffer;

/** Options for {@link useDocxSource}. @public */
export interface UseDocxSourceOptions {
  fonts?: DocxFontsSource;
  /** Passed to `fetch` for a URL source — credentials, headers, an AbortSignal's siblings. */
  fetchOptions?: RequestInit;
}

/** What {@link useDocxSource} reports. @public */
export interface UseDocxSourceResult {
  /** Bytes for `DocxEditor`'s `document` prop; undefined until they arrive. */
  readonly document: Uint8Array | undefined;
  /** Composed configuration for the `fonts` prop; undefined until fonts settle. */
  readonly fonts: FontConfiguration | undefined;
  /** Why the DOCUMENT could not be opened. Font failures never land here — see below. */
  readonly error: Error | null;
  /** True until the document either arrives or fails. */
  readonly isLoading: boolean;
}

/** A URL source needs fetching; bytes are already what the editor wants. */
function bytesOf(source: DocxSource): Uint8Array | null {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  return null;
}

async function resolveFonts(source: DocxFontsSource): Promise<DocxFontsInput> {
  return typeof source === 'function' ? source() : source;
}

/**
 * Load a document (and optionally fonts) for `DocxEditor`.
 *
 * ```tsx
 * const { document, fonts, error } = useDocxSource(url, { fonts: defaultFonts });
 * if (error) return <p>{error.message}</p>;
 * return <DocxEditor document={document} fonts={fonts} />;
 * ```
 *
 * FONTS NEVER FAIL THE DOCUMENT. A face that will not load degrades that family to
 * fixed-width measurement — the document still opens, it just paginates less like Word — so
 * a font failure leaves `error` null and is the loader's to report. A document failure is
 * different: there is nothing to show, so it lands on `error`.
 *
 * THE DOCUMENT WAITS FOR THE FONTS. They fetch concurrently, but `document` stays undefined
 * until fonts have settled — resolved OR failed — because layout MEASURES with them. Handing
 * the editor bytes first paginates the whole document on the fixed fallback and then
 * re-paginates when the real faces arrive, which the reader sees as the text jumping. One
 * slightly longer wait beats a visible reflow. Without a `fonts` option there is nothing to
 * wait for and the bytes go straight through.
 *
 * A URL is fetched with the browser's own `fetch`, exactly as the caller wrote it. Validate
 * it first if it came from user input: this hook adds no allowlist of its own, and inventing
 * one would only give callers a false sense of where the trust boundary is.
 *
 * @public
 */
export function useDocxSource(
  source: DocxSource | null | undefined,
  options: UseDocxSourceOptions = {}
): UseDocxSourceResult {
  const [bytes, setBytes] = useState<Uint8Array | undefined>(undefined);
  const [fonts, setFonts] = useState<FontConfiguration | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [documentLoading, setDocumentLoading] = useState(source != null);
  // Whether the font question is answered — resolved, failed, or never asked. The document
  // is held back until it is; see the note on reflow above.
  const [fontsSettled, setFontsSettled] = useState(options.fonts === undefined);

  // Options are rebuilt every render by any caller writing them inline, which is the normal
  // case. Read from a ref so a fresh object literal cannot restart a fetch.
  const latest = useRef(options);
  latest.current = options;

  // Fonts load ONCE, not per document: the faces are a property of the app, not of the file
  // open in it, and re-fetching them on every navigation would be pure waste.
  useEffect(() => {
    const fontsSource = latest.current.fonts;
    if (fontsSource === undefined) return undefined;
    let live = true;
    void (async () => {
      try {
        const resolved = await resolveFonts(fontsSource);
        // A fragment composes with the defaults; a complete configuration passes through.
        if (live) setFonts(composeFontConfiguration(resolved as FontConfigurationFragment));
      } catch {
        // Deliberately swallowed. The loader reports its own failures, and the engine
        // measures on its fixed fallback — a worse-looking document, not a missing one.
      } finally {
        // `finally`, so a font failure releases the document instead of holding it forever.
        if (live) setFontsSettled(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (source == null) {
      setBytes(undefined);
      setError(null);
      setDocumentLoading(false);
      return undefined;
    }
    const immediate = bytesOf(source);
    if (immediate) {
      setBytes(immediate);
      setError(null);
      setDocumentLoading(false);
      return undefined;
    }

    // `live` rather than only the AbortController: aborting stops the request, but a
    // response already in flight to `.arrayBuffer()` can still resolve after unmount, and
    // setting state then is the warning nobody can trace back here.
    let live = true;
    const controller = new AbortController();
    setDocumentLoading(true);
    setError(null);
    void (async () => {
      try {
        const response = await fetch(String(source), {
          ...latest.current.fetchOptions,
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`could not open the document: ${response.status} ${response.statusText}`);
        }
        const loaded = new Uint8Array(await response.arrayBuffer());
        if (!live) return;
        setBytes(loaded);
        setDocumentLoading(false);
      } catch (cause) {
        // An abort is this hook cancelling itself, not a failure the caller should render.
        if (!live || (cause instanceof Error && cause.name === 'AbortError')) return;
        setError(cause instanceof Error ? cause : new Error('could not open the document'));
        setDocumentLoading(false);
      }
    })();
    return () => {
      live = false;
      controller.abort();
    };
  }, [source]);

  return {
    // Held back until fonts settle, so the first layout is the only layout.
    document: fontsSettled ? bytes : undefined,
    fonts,
    error,
    isLoading: documentLoading || !fontsSettled,
  };
}
