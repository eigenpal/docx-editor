import { ref, computed, watchEffect, type ComputedRef } from 'vue';
import {
  prefersColorSchemeDark,
  resolveIsDark,
  subscribeSystemDark,
  type ColorMode,
} from '@eigenpal/docx-editor-core/utils';

/**
 * Resolve the effective dark flag from a reactive `colorMode`. `'system'`
 * follows the OS via `subscribeSystemDark` (SSR-safe; re-syncs on entry).
 * Mirrors the React adapter's inline colorMode logic via the shared core helpers.
 */
export function useColorMode(colorMode: () => ColorMode): ComputedRef<boolean> {
  const systemDark = ref(prefersColorSchemeDark());
  watchEffect((onCleanup) => {
    if (colorMode() !== 'system') return;
    onCleanup(
      subscribeSystemDark((dark) => {
        systemDark.value = dark;
      })
    );
  });
  return computed(() => resolveIsDark(colorMode(), systemDark.value));
}
