// The paint aliases of the glyph fallback faces, carried with a font alias lookup.
//
// Layout shapes a character that a run's face lacks in the first glyph fallback face that
// covers it (`glyph-fallback-shaper.ts`). The browser must draw it in the same face, so the
// CSS font stack of a run names the aliases of those faces right behind the run's own alias,
// in the order the shaper tries them. The canvas measurer and the painter both build their
// stack from one alias lookup, so the aliases travel with that lookup: a host attaches them
// once, and the two stacks cannot differ.

type FontAliasLookup = (family: string) => string | undefined;

/** The same bound the stack builders apply to an alias: engine-minted, never file-derived. */
const ALIAS_NAME = /^[\p{L}\p{N}\p{M} \-.+_,;]{1,64}$/u;

const aliasesByLookup = new WeakMap<FontAliasLookup, readonly string[]>();

/** Attach the aliases of the held glyph fallback faces, in fallback order, to `lookup`. */
export function withGlyphFallbackAliases<T extends FontAliasLookup>(
  lookup: T,
  aliases: readonly (string | undefined)[]
): T {
  const held = [...new Set(aliases.filter((alias): alias is string => !!alias))].filter((alias) =>
    ALIAS_NAME.test(alias)
  );
  if (held.length > 0) aliasesByLookup.set(lookup, Object.freeze(held));
  return lookup;
}

/**
 * The CSS font-family entries of the glyph fallback faces of `lookup`, each followed by a
 * comma, or an empty string. `after` is the run's own alias, which the list must not repeat.
 */
export function glyphFallbackStackOf(lookup: FontAliasLookup | undefined, after?: string): string {
  const aliases = lookup && aliasesByLookup.get(lookup);
  if (!aliases) return '';
  return aliases
    .filter((alias) => alias !== after)
    .map((alias) => `"${alias}", `)
    .join('');
}

/**
 * The CSS font-family list of a run: its alias (the bytes layout shaped it in), the glyph
 * fallback faces, the declared family, then the `stack` that an unresolved name falls back to.
 * Without an alias the declared family leads. The caller validates `family` and `alias`.
 */
export function fontFamilyStack(
  lookup: FontAliasLookup | undefined,
  alias: string | null | undefined,
  family: string,
  stack: string
): string {
  const glyphFallbacks = glyphFallbackStackOf(lookup, alias ?? undefined);
  return alias
    ? `"${alias}", ${glyphFallbacks}"${family}", ${stack}`
    : `"${family}", ${glyphFallbacks}${stack}`;
}
