import { onBeforeUnmount, watch } from 'vue';
import {
  onFontError,
  loadFontDefinitions,
  type FontDefinition,
} from '@eigenpal/docx-editor-core/utils';

/**
 * Vue counterpart to React's `useFontLifecycle`.
 *
 * - Re-registers custom faces from the `fonts` prop on identity change.
 *   The loader dedupes by `family|weight`, so re-runs are cheap.
 * - Forwards font-load failures to the supplied error handler. `<DocxEditor>`
 *   passes `(err) => emit('error', err)`; `emit` is stable per `<script setup>`
 *   instance, so the subscription stays on a single listener for the
 *   component's lifetime.
 */
export function useFontLifecycle(
  fontsGetter: () => ReadonlyArray<FontDefinition> | undefined,
  onError: (error: Error) => void
): void {
  watch(
    fontsGetter,
    (next) => {
      void loadFontDefinitions(next);
    },
    { immediate: true }
  );

  const unsubscribe = onFontError(onError);
  onBeforeUnmount(() => unsubscribe());
}
