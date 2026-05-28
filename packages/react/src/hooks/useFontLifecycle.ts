import { useEffect, useRef } from 'react';
import {
  onFontsLoaded,
  onFontError,
  loadFontDefinitions,
  type FontDefinition,
} from '@eigenpal/docx-editor-core/utils';

/**
 * Owns the editor's three font lifecycle wires:
 *
 * 1. Re-register custom faces from the `fonts` prop on identity change.
 *    The loader dedupes by `family|weight`, so re-runs are cheap.
 * 2. Forward the global `onFontsLoaded` event to the consumer's callback.
 * 3. Forward font-load failures to the consumer's `onError` prop. The
 *    subscription is mounted once and reads `onError` through a ref so an
 *    inline `onError={(e) => …}` does not churn the subscriber Set on every
 *    parent render.
 */
export function useFontLifecycle(
  fonts: ReadonlyArray<FontDefinition> | undefined,
  onFontsLoadedCallback: (() => void) | undefined,
  onError: ((error: Error) => void) | undefined
): void {
  useEffect(() => {
    void loadFontDefinitions(fonts);
  }, [fonts]);

  useEffect(() => {
    return onFontsLoaded(() => onFontsLoadedCallback?.());
  }, [onFontsLoadedCallback]);

  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  useEffect(() => {
    return onFontError((err) => onErrorRef.current?.(err));
  }, []);
}
