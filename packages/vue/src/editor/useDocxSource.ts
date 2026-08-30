// The Vue twin of the React hook. The two font paths — eager, which holds the document
// back until fonts settle, and on demand, which cannot — are documented on the React side
// and behave identically here.
//
// One deliberate difference: this watcher keys on the `fonts` VALUE, so swapping one eager
// loader for another re-runs it. React keys on the option's SHAPE, because it rebuilds the
// options object every render and keying on the value would re-run the eager load on every
// one. Neither is a contract; remount, or load a document, to change fonts deliberately.

import { computed, ref, toValue, watch, type ComputedRef } from 'vue';
import { scopeDispose } from './scope-dispose';
import {
  composeFontConfiguration,
  composeFontOrigins,
  defineFontResolver,
  isFontResolver,
} from '@docx-editor.dev/core/editor';
import type {
  FontConfigurationFragment,
  FontOrigin,
  FontResolutionRequest,
  FontResolver,
} from '@docx-editor.dev/core/editor';
import type { FontConfiguration } from '@docx-editor.dev/core/contracts/editor';
import type { MaybeRefOrGetter } from '../maybe-ref-or-getter';

/** @public */
export type DocxFontsInput = FontConfiguration | FontConfigurationFragment;

/** @public */
export type DocxFontsSource = DocxFontOrigin | readonly DocxFontOrigin[];

/** @public */
export type DocxFontOrigin = FontOrigin | (() => DocxFontsInput | Promise<DocxFontsInput>);

/** @public */
export type DocxSource = string | URL | Uint8Array | ArrayBuffer;

/** @public */
export interface UseDocxSourceOptions {
  fonts?: DocxFontsSource;
  fetchOptions?: RequestInit;
}

/** @public */
export interface UseDocxSourceResult {
  readonly document: ComputedRef<Uint8Array | undefined>;
  readonly fonts: ComputedRef<FontConfiguration | FontResolver | undefined>;
  readonly error: ComputedRef<Error | null>;
  readonly isLoading: ComputedRef<boolean>;
}

function bytesOf(source: DocxSource): Uint8Array | null {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  return null;
}

/** One origin or several — the rest of the composable only ever deals with a list. */
function fontOrigins(source: DocxFontsSource): readonly DocxFontOrigin[] {
  return Array.isArray(source) ? source : [source as DocxFontOrigin];
}

/** A loader in an ON-DEMAND list is still a loader: wrapped so it is called with no argument. */
function asFontOrigin(origin: DocxFontOrigin): FontOrigin {
  if (typeof origin !== 'function' || isFontResolver(origin)) return origin as FontOrigin;
  const loader = origin as () => DocxFontsInput | Promise<DocxFontsInput>;
  return defineFontResolver(async () => loader());
}

/** Whether ANY origin resolves per document, in which case nothing can be waited for. */
function isOnDemand(source: DocxFontsSource | undefined): boolean {
  return source !== undefined && fontOrigins(source).some((origin) => isFontResolver(origin));
}

/** Eager path only: a zero-argument loader is called, everything else is taken as it is. */
async function resolveEagerOrigin(origin: DocxFontOrigin): Promise<DocxFontsInput | undefined> {
  if (typeof origin !== 'function') return await origin;
  return (await (origin as unknown as () => DocxFontsInput | Promise<DocxFontsInput>)()) as
    | DocxFontsInput
    | undefined;
}

/** @public */
export function useDocxSource(
  source: MaybeRefOrGetter<DocxSource | null | undefined>,
  options: MaybeRefOrGetter<UseDocxSourceOptions> = {}
): UseDocxSourceResult {
  const reactiveSource = source;
  const reactiveOptions = options;
  const bytes = ref<Uint8Array | undefined>(undefined);
  const fonts = ref<FontConfiguration | FontResolver | undefined>(undefined);
  const error = ref<Error | null>(null);
  const documentLoading = ref(toValue(reactiveSource) != null);
  const fontsSettled = ref(toValue(options).fonts === undefined);
  let fetchGeneration = 0;

  // ONE resolver for the composable's life, delegating to whatever the options hold now.
  // `:fonts` rebuilds the editor when its identity changes, and `packagedFonts()` written
  // inline is a fresh function on every render; this is what keeps that from remounting.
  const resolver: FontResolver = defineFontResolver((request: FontResolutionRequest) =>
    composeFontOrigins(fontOrigins(toValue(reactiveOptions).fonts ?? []).map(asFontOrigin), request)
  );

  scopeDispose(
    watch(
      () => toValue(reactiveOptions).fonts,
      (fontsSource, _previous, onCleanup) => {
        if (fontsSource === undefined) {
          fonts.value = undefined;
          fontsSettled.value = true;
          return;
        }
        // On demand: the answer needs the parsed document, so there is nothing to await
        // here and nothing to hold the bytes for.
        if (isOnDemand(fontsSource)) {
          fonts.value = resolver;
          fontsSettled.value = true;
          return;
        }
        let live = true;
        fonts.value = undefined;
        fontsSettled.value = false;
        void (async () => {
          try {
            // `allSettled`, not `all`: one rejecting origin must not take the answers
            // around it down with it. The React twin carries the reasoning.
            const settled = await Promise.allSettled(
              fontOrigins(fontsSource).map(resolveEagerOrigin)
            );
            const resolved: DocxFontsInput[] = [];
            for (const outcome of settled) {
              if (outcome.status === 'rejected') {
                console.warn(
                  '[fonts] font loading failed for one origin; the others still compose',
                  outcome.reason
                );
                continue;
              }
              if (outcome.value !== undefined) resolved.push(outcome.value);
            }
            if (live && resolved.length > 0) {
              fonts.value = composeFontConfiguration(
                resolved[0] as FontConfigurationFragment,
                ...(resolved.slice(1) as readonly FontConfigurationFragment[])
              );
            }
          } catch (cause) {
            // Never fatal, never silent: the same reasoning as the React twin.
            console.warn('[fonts] font loading failed; the fixed measurer stays in effect', cause);
          } finally {
            if (live) fontsSettled.value = true;
          }
        })();
        onCleanup(() => {
          live = false;
        });
      },
      { immediate: true }
    )
  );

  scopeDispose(
    watch(
      () => toValue(reactiveSource),
      (nextSource, _previous, onCleanup) => {
        fetchGeneration += 1;
        const generation = fetchGeneration;
        if (nextSource == null) {
          bytes.value = undefined;
          error.value = null;
          documentLoading.value = false;
          return;
        }
        const immediate = bytesOf(nextSource);
        if (immediate) {
          bytes.value = immediate;
          error.value = null;
          documentLoading.value = false;
          return;
        }

        let live = true;
        const controller = new AbortController();
        bytes.value = undefined;
        documentLoading.value = true;
        error.value = null;
        void (async () => {
          try {
            const response = await fetch(String(nextSource), {
              ...toValue(reactiveOptions).fetchOptions,
              signal: controller.signal,
            });
            if (!response.ok) {
              throw new Error(
                `could not open the document: ${response.status} ${response.statusText}`
              );
            }
            const loaded = new Uint8Array(await response.arrayBuffer());
            if (!live || generation !== fetchGeneration) return;
            bytes.value = loaded;
            documentLoading.value = false;
          } catch (cause) {
            if (!live || generation !== fetchGeneration) return;
            if (cause instanceof Error && cause.name === 'AbortError') return;
            bytes.value = undefined;
            error.value = cause instanceof Error ? cause : new Error('could not open the document');
            documentLoading.value = false;
          }
        })();
        onCleanup(() => {
          live = false;
          controller.abort();
        });
      },
      { immediate: true, flush: 'post' }
    )
  );

  return {
    document: computed(() => (fontsSettled.value ? bytes.value : undefined)),
    fonts: computed(() => fonts.value),
    error: computed(() => error.value),
    isLoading: computed(() => documentLoading.value || !fontsSettled.value),
  };
}
