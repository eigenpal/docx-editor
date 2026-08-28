// The Vue twin of the React hook. The two font paths — eager, which holds the document
// back until fonts settle, and on demand, which cannot — are documented on the React side
// and behave identically here.

import { computed, ref, toValue, watch, type ComputedRef } from 'vue';
import { scopeDispose } from './scope-dispose';
import {
  composeFontConfiguration,
  composeFontOrigins,
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
export type DocxFontsSource =
  | FontOrigin
  | (() => DocxFontsInput | Promise<DocxFontsInput>)
  | readonly FontOrigin[];

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
function fontOrigins(source: DocxFontsSource): readonly FontOrigin[] {
  return Array.isArray(source) ? source : [source as FontOrigin];
}

/** Whether ANY origin resolves per document, in which case nothing can be waited for. */
function isOnDemand(source: DocxFontsSource | undefined): boolean {
  return source !== undefined && fontOrigins(source).some((origin) => isFontResolver(origin));
}

/** Eager path only: a zero-argument loader is called, everything else is taken as it is. */
async function resolveEagerOrigin(origin: FontOrigin): Promise<DocxFontsInput | undefined> {
  return typeof origin === 'function'
    ? ((await (origin as () => DocxFontsInput | Promise<DocxFontsInput>)()) as DocxFontsInput)
    : await origin;
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
  const resolver: FontResolver = (request: FontResolutionRequest) =>
    composeFontOrigins(fontOrigins(toValue(reactiveOptions).fonts ?? []), request);

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
            const resolved = (await Promise.all(fontOrigins(fontsSource).map(resolveEagerOrigin)))
              // An origin that answered `undefined` contributed nothing.
              .filter((origin): origin is DocxFontsInput => origin !== undefined);
            if (live && resolved.length > 0) {
              fonts.value = composeFontConfiguration(
                resolved[0] as FontConfigurationFragment,
                ...(resolved.slice(1) as readonly FontConfigurationFragment[])
              );
            }
          } catch {
            // Font failures never fail the document.
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
