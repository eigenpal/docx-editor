// Word's "field shading: when selected", which is a CARET question, not a layout one.
//
// The mode shades a field only while the insertion point is inside it. Resolving that in layout
// would put the caret into the per-block cache key and remeasure the document on every arrow
// press; resolving it in paint would rebuild spans just as often. Both are the wrong lane for a
// background colour.
//
// So layout marks which spans ARE fields (`data-field-atom`, painted once) and this toggles one
// class as the caret moves — the same division the open review item already uses. Cost is one
// class removal and one query per caret move, against a document that never relayouts.

const ACTIVE_CLASS = 'docx-field-atom--active';
/** What paint adds only where shading is enabled for that field. */
const SHADABLE_CLASS = 'docx-field-atom';

/** Where the caret is, in the model's own addressing. */
export interface FieldShadingCaret {
  readonly paragraphId: string;
  readonly offset: number;
}

/**
 * Move the "caret is in this field" mark to whichever field atom holds `caret`.
 *
 * `caret` is null when there is no collapsed insertion point — no focus, a range selection, an
 * IME composition — and every mark comes off. A range selection draws its own highlight, and a
 * second background under one end of it reads as a second selection.
 */
export function syncActiveFieldShading(
  pagesLayer: HTMLElement,
  caret: FieldShadingCaret | null
): void {
  for (const marked of pagesLayer.querySelectorAll(`.${ACTIVE_CLASS}`)) {
    marked.classList.remove(ACTIVE_CLASS);
  }
  if (!caret) return;

  // `.docx-field-atom`, NOT `[data-field-atom]`. The attribute marks every field result so a
  // host can find them; the CLASS is what paint adds only where shading is actually enabled.
  // Keying off the attribute meant the caret shaded a field that `fieldShading: 'never'` — or
  // the document's own `w:doNotShadeFormData` — had just said never to shade, because the
  // stylesheet paints `--active` unconditionally. The caret must not be able to overrule the
  // decision paint already made.
  //
  // It is also the cheaper selector. This runs on the keystroke path, and a class match is
  // what browsers optimise; an attribute match over every materialized page is not.
  //
  // The paragraph id is compared in JS rather than written into the selector. It is
  // engine-minted, but it is built from a PART NAME, and part names come out of the file — so
  // it is attacker-influenced text, and the only way to interpolate it safely into a selector
  // is not to.
  const candidates = pagesLayer.querySelectorAll<HTMLElement>(`.${SHADABLE_CLASS}`);
  for (const candidate of candidates) {
    if (candidate.dataset.paragraphId !== caret.paragraphId) continue;
    const start = Number(candidate.dataset.start);
    const end = Number(candidate.dataset.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    // Half-open on the left, INCLUSIVE on the right: a field is one model unit, so a caret
    // resting at either edge is a caret Word considers inside it. Excluding the trailing edge
    // made the shading flicker off as the caret arrived at the field from the left.
    if (caret.offset < start || caret.offset > end) continue;
    // Every span, not the first. Line breaking splits a field's result at its spaces like any
    // other text, and all of them publish the same model range — marking one shaded half a
    // cross-reference while `always` (resolved in paint, per span) shaded all of it.
    candidate.classList.add(ACTIVE_CLASS);
  }
}
