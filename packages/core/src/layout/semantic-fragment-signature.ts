// Fragment content signatures for incremental layout convergence.
//
// Extracted from semantic-layout so the flow module stays under the line budget while every
// published field still participates in equality.

import type { BlockFragmentRecord } from './semantic-records.ts';

/** Cached per record, so a fragment is serialized once however often convergence is tested. */
const signatures = new WeakMap<object, string>();

export function fragmentSignature(fragment: BlockFragmentRecord): string {
  const cached = signatures.get(fragment);
  if (cached !== undefined) return cached;
  // Every PUBLISHED field participates. A field left out converges a freshly built
  // fragment against a stale one and discards the new value — the exact bug the `props`
  // note below records for paragraph properties.
  const signature =
    fragment.kind === 'table'
      ? JSON.stringify([
          fragment.id,
          fragment.tableId,
          fragment.fragmentIndex,
          fragment.nestingDepth,
          fragment.columnEdges,
          fragment.box,
          fragment.rows,
        ])
      : JSON.stringify([
          fragment.id,
          fragment.box,
          fragment.range,
          // `props` is a PUBLISHED field. A paragraph-property change layout does not read
          // moves no geometry, so without this the freshly built fragment converged against
          // the old one and was discarded — leaving a painter or style consumer reading the
          // pre-edit value.
          fragment.props,
          fragment.spacing,
          // The EFFECTIVE indent, for the same reason `props` is here. A list paragraph's
          // indent comes from `numbering.xml`, so a renumber that moves the text but no
          // other hashed field would converge against the stale fragment and leave the
          // ruler reading the pre-edit value.
          fragment.indent,
          fragment.bottomBorder,
          // Every `w:pBdr` stroke, not just the bottom one. A left rule's colour or width
          // moves nothing else that is hashed here — `props` carries `pBdr` without its
          // children — so leaving it out converges the repainted fragment against the stale
          // one and keeps drawing the old frame.
          fragment.borders,
          fragment.shading,
          fragment.shadingBox,
          fragment.marker,
          fragment.lines.map((line) => [line.id, line.box, line.baseline, line.spans]),
        ]);
  signatures.set(fragment, signature);
  return signature;
}

/**
 * Are two pending-fragment lists the same CONTENT?
 *
 * Identity is not enough: a resume rebuilds the open page's fragments, so the arrays differ
 * even when every record matches. Comparing signatures is what lets convergence fire.
 */
export function sameFragments(
  left: readonly BlockFragmentRecord[],
  right: readonly BlockFragmentRecord[]
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    if (a === b) continue;
    if (fragmentSignature(a) !== fragmentSignature(b)) return false;
  }
  return true;
}

/** Pending anchored drawings on the open page — reference identity for incremental reuse. */
export function sameAnchoredDrawings(
  left: readonly import('./drawing-layout.ts').AnchoredDrawingRecord[],
  right: readonly import('./drawing-layout.ts').AnchoredDrawingRecord[]
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) continue;
    return false;
  }
  return true;
}
