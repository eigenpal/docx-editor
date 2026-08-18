import { computed, onScopeDispose, ref, watch, type ComputedRef } from 'vue';
import { composeFontConfiguration } from '@docx-editor.dev/core/editor';
import type { FontConfigurationFragment } from '@docx-editor.dev/core/editor';
import type { FontConfiguration } from '@docx-editor.dev/core/contracts/editor';

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
  source: DocxSource | null | undefined,
  options: UseDocxSourceOptions = {}
): UseDocxSourceResult {
  const bytes = ref<Uint8Array | undefined>(undefined);
  const fonts = ref<FontConfiguration | undefined>(undefined);
  const error = ref<Error | null>(null);
  const documentLoading = ref(source != null);
  const fontsSettled = ref(options.fonts === undefined);

  const latest = { current: options };
  latest.current = options;

  onScopeDispose(
    watch(
      () => latest.current.fonts,
      (fontsSource) => {
        if (fontsSource === undefined) return;
        let live = true;
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

  onScopeDispose(
    watch(
      () => source,
      (nextSource) => {
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
              ...latest.current.fetchOptions,
              signal: controller.signal,
            });
            if (!response.ok) {
              throw new Error(
                `could not open the document: ${response.status} ${response.statusText}`
              );
            }
            const loaded = new Uint8Array(await response.arrayBuffer());
            if (!live) return;
            bytes.value = loaded;
            documentLoading.value = false;
          } catch (cause) {
            if (!live || (cause instanceof Error && cause.name === 'AbortError')) return;
            error.value = cause instanceof Error ? cause : new Error('could not open the document');
            documentLoading.value = false;
          }
        })();
        return () => {
          live = false;
          controller.abort();
        };
      },
      { immediate: true }
    )
  );

  return {
    document: computed(() => (fontsSettled.value ? bytes.value : undefined)),
    fonts: computed(() => fonts.value),
    error: computed(() => error.value),
    isLoading: computed(() => documentLoading.value || !fontsSettled.value),
  };
}
