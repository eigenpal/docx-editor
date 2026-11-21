import type { FieldAtomMarker } from './field-pieces.ts';

/**
 * Field result text for inter-script spacing (`w:autoSpaceDE`, `w:autoSpaceDN`) and balanced
 * space widths. A displayed field result is text like any other run: every field type, a
 * `w:fldSimple`, and a result that continues into a later paragraph. Field code text shown in
 * place of a result is text too. A form control (check box or drop-down) is not text.
 */
export function isFieldResultText(item: { readonly fieldAtom?: FieldAtomMarker }): boolean {
  return item.fieldAtom !== undefined && item.fieldAtom.formControl === undefined;
}

/**
 * Whether a field result piece may be cut at an automatic gap or a balanced space. A page number
 * is not cut: the finalize pass replaces its text after layout. Font slots still split a page
 * number that mixes scripts, and finalize writes the value into the first slice only.
 */
export function fieldResultMayCut(item: { readonly fieldAtom?: FieldAtomMarker }): boolean {
  const atom = item.fieldAtom;
  return atom === undefined || (atom.pageField === undefined && atom.pageRef === undefined);
}

interface SourceSlice {
  readonly start: number;
  readonly end: number;
  readonly projected?: boolean | undefined;
  readonly fieldAtom?: FieldAtomMarker | undefined;
}

/**
 * Whether `after` follows `before` directly in the source. Adjacent model ranges follow
 * directly. Two slices of one atomic field result also follow directly: every slice keeps the
 * whole atom range, so their ranges are equal instead of adjacent.
 */
export function followsInSource(before: SourceSlice, after: SourceSlice): boolean {
  if (before.end === after.start) return true;
  return (
    before.projected === true &&
    after.projected === true &&
    before.fieldAtom !== undefined &&
    before.fieldAtom === after.fieldAtom &&
    before.start === after.start &&
    before.end === after.end
  );
}
