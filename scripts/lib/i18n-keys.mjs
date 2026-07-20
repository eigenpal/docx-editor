/**
 * Shared key-walker for i18n JSON files. Used by both
 * `scripts/validate-i18n.mjs` (locale-fix CLI) and
 * `scripts/check-i18n-parity.mjs` (parity gate).
 *
 * `_lang` and any `_*` metadata key at the top level are skipped.
 */

const METADATA_PREFIX = '_';

export function getLeafPaths(obj, prefix = '') {
  const paths = [];
  for (const [k, v] of Object.entries(obj)) {
    if (!prefix && k.startsWith(METADATA_PREFIX)) continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      paths.push(...getLeafPaths(v, path));
    } else {
      paths.push(path);
    }
  }
  return paths.sort();
}
