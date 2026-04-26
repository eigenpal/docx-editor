import type { FontOption } from './FontPicker';

/**
 * Normalize the `fontFamilies` prop (which may mix strings and `FontOption`
 * objects) into a uniform `FontOption[]` for `FontPicker`. Returns
 * `undefined` for `undefined` input so `FontPicker` falls back to its
 * built-in `DEFAULT_FONTS`. Strings expand into the `'other'` group with no
 * CSS fallback chain.
 */
export function normalizeFontFamilies(
  fontFamilies: ReadonlyArray<string | FontOption> | undefined
): FontOption[] | undefined {
  if (fontFamilies === undefined) return undefined;
  const normalized = fontFamilies.map(
    (f): FontOption => (typeof f === 'string' ? { name: f, fontFamily: f, category: 'other' } : f)
  );
  if (isDev()) {
    const warned = new Set<string>();
    const seen = new Set<string>();
    for (const f of normalized) {
      if (seen.has(f.name) && !warned.has(f.name)) {
        console.warn(`[DocxEditor] Duplicate font name in fontFamilies: "${f.name}"`);
        warned.add(f.name);
      }
      seen.add(f.name);
    }
  }
  return normalized;
}

// `process` is undefined in browser bundles unless the host's bundler
// replaces it. Guard so the lib doesn't throw a ReferenceError when shipped
// without a process shim (Vite default, native ESM).
function isDev(): boolean {
  return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
}
