// Footnote reserve maps: page-slot → bottom reserve height (points). The compute lives in
// note-pagination.ts (computeFootnoteReserves); this module holds the pure map algebra the
// reflow loop and the section context keys share.

/**
 * The note-reserve slice of one section's layout context key.
 *
 * The reserve map is keyed by DOCUMENT page index (`computeFootnoteReserves`), while a
 * section's pass reads it at `pageIndexStart + localSlot` as it opens pages. The key folds
 * exactly the entries that pass can read — document slots in
 * `[pageIndexStart, pageIndexStart + pageBound)` — so a reserve on another section's pages
 * cannot invalidate this one. `pageBound` is EXCLUSIVE and section-LOCAL: the highest local
 * page slot the pass can read, plus one.
 *
 * Entries are emitted at their LOCAL slot (`documentSlot - pageIndexStart`), not the document
 * one. The document page index is deliberately absent from a section's context key (an Enter
 * that adds a page above must not re-lay every section below), and the local slot is what the
 * pass's reads actually depend on: two passes whose readable windows carry the same heights
 * at the same local offsets read identically wherever the section sits, so a section whose
 * reserves shift down a sheet with it reconverges to its stored key once the reflow loop has
 * recomputed the map, while a reserve that stays at a fixed document page as the section
 * moves lands on a different local slot and invalidates.
 *
 * Entries are sorted by slot so two content-equal maps render one canonical key regardless
 * of insertion order. `Infinity` folds every entry from `pageIndexStart` on (a pass with no
 * prior page count cannot bound its reads). A window with no entries keys like no map at
 * all: both mean every read returns zero, and two encodings of that would invalidate every
 * untouched section when a document's last note disappears.
 */
export function notesReserveContextKey(
  reserves: ReadonlyMap<number, number> | undefined,
  pageIndexStart: number,
  pageBound: number
): string {
  if (!reserves) return '';
  const entries: [number, number][] = [];
  for (const [pageSlot, height] of reserves) {
    const localSlot = pageSlot - pageIndexStart;
    if (localSlot >= 0 && localSlot < pageBound) entries.push([localSlot, height]);
  }
  if (entries.length === 0) return '';
  entries.sort((a, b) => a[0] - b[0]);
  return `|nr:${entries.map(([localSlot, height]) => `${localSlot}=${height}`).join(',')}`;
}

/** Drop non-positive heights so missing and zero compare equal. */
export function compactFootnoteReserves(
  reserves: ReadonlyMap<number, number>
): Map<number, number> {
  const next = new Map<number, number>();
  for (const [pageIndex, height] of reserves) {
    if (height > 0) next.set(pageIndex, height);
  }
  return next;
}

/** True when both maps list the same page → height pairs (zeros ignored). */
export function footnoteReservesEqual(
  a: ReadonlyMap<number, number>,
  b: ReadonlyMap<number, number>
): boolean {
  const left = compactFootnoteReserves(a);
  const right = compactFootnoteReserves(b);
  if (left.size !== right.size) return false;
  for (const [pageIndex, height] of left) {
    if ((right.get(pageIndex) ?? 0) !== height) return false;
  }
  return true;
}

/** Monotonic union: each page keeps the larger of the two heights. */
export function growFootnoteReserves(
  base: ReadonlyMap<number, number>,
  computed: ReadonlyMap<number, number>
): Map<number, number> {
  const next = compactFootnoteReserves(base);
  for (const [pageIndex, height] of computed) {
    if (height <= 0) continue;
    next.set(pageIndex, Math.max(next.get(pageIndex) ?? 0, height));
  }
  return next;
}

/** Canonical content fingerprint, for cycle detection over adopted maps. */
export function footnoteReservesFingerprint(reserves: ReadonlyMap<number, number>): string {
  return [...compactFootnoteReserves(reserves)]
    .map(([pageIndex, height]) => `${pageIndex}=${height}`)
    .sort()
    .join(',');
}
