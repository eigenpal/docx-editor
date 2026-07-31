/**
 * Shared FontOption shape + normaliser used by FontPicker components
 * in both adapters. Lifted from packages/react/src/components/ui/
 * normalizeFontFamilies.ts so the type definition has a single home.
 * @packageDocumentation
 * @public
 */

export interface FontOption {
  name: string;
  fontFamily: string;
  category?: 'sans-serif' | 'serif' | 'monospace' | 'other';
}

/**
 * Normalize a `fontFamilies` prop (mix of strings and FontOption
 * objects) into a uniform `FontOption[]`. Returns `undefined` for
 * `undefined` input so callers fall back to their built-in defaults.
 * Strings expand into the `'other'` group with no CSS fallback chain.
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

function isDev(): boolean {
  return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
}
