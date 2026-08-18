import { computed, ref, toValue, watch, type ComputedRef } from 'vue';
import { scopeDispose } from './scope-dispose';
import { composeFontConfiguration } from '@docx-editor.dev/core/editor';
import type { FontConfigurationFragment } from '@docx-editor.dev/core/editor';
import type { FontConfiguration } from '@docx-editor.dev/core/contracts/editor';
import type { MaybeRefOrGetter } from '../maybe-ref-or-getter';

/** @public */
export type DocxFontsInput = FontConfiguration | FontConfigurationFragment;

/** @public */
export type DocxFontsSource =
  | DocxFontsInput
  | Promise<DocxFontsInput>
  | (() => DocxFontsInput | Promise<DocxFontsInput>);

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
  readonly fonts: ComputedRef<FontConfiguration | undefined>;
  readonly error: ComputedRef<Error | null>;
  readonly isLoading: ComputedRef<boolean>;
}

function bytesOf(source: DocxSource): Uint8Array | null {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  return null;
}

async function resolveFonts(source: DocxFontsSource): Promise<DocxFontsInput> {
  return typeof source === 'function' ? source() : source;
}

/** @public */
export function useDocxSource(
  source: MaybeRefOrGetter<DocxSource | null | undefined>,
  options: MaybeRefOrGetter<UseDocxSourceOptions> = {}
): UseDocxSourceResult {
  const reactiveSource = source;
  const reactiveOptions = options;
  const bytes = ref<Uint8Array | undefined>(undefined);
  const fonts = ref<FontConfiguration | undefined>(undefined);
  const error = ref<Error | null>(null);
  const documentLoading = ref(toValue(reactiveSource) != null);
  const fontsSettled = ref(toValue(options).fonts === undefined);
  let fetchGeneration = 0;

  scopeDispose(
    watch(
      () => toValue(reactiveOptions).fonts,
      (fontsSource) => {
        if (fontsSource === undefined) {
          fontsSettled.value = true;
          return;
        }
        let live = true;
        fontsSettled.value = false;
        void (async () => {
          try {
            const resolved = await resolveFonts(fontsSource);
            if (live) fonts.value = composeFontConfiguration(resolved as FontConfigurationFragment);
          } catch {
            // Font failures never fail the document.
          } finally {
            if (live) fontsSettled.value = true;
          }
        })();
        return () => {
          live = false;
        };
      },
      { immediate: true }
    )
  );

  scopeDispose(
    watch(
      () => toValue(reactiveSource),
      (nextSource) => {
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
            error.value = cause instanceof Error ? cause : new Error('could not open the document');
            documentLoading.value = false;
          }
        })();
        return () => {
          live = false;
          controller.abort();
        };
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
