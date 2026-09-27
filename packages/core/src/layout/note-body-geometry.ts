import type { SemanticLayout } from './semantic-records.ts';

// Note reserves belong to the body box that admitted them. Header projections can
// change that box while the body part and note stories keep their identities.
const geometryBySession = new WeakMap<object, readonly string[]>();

export function resetNoteReserveSearch(
  memo: { settledReserves: unknown; reflowSpent: unknown; orphanPolicyPart?: unknown } | null
): void {
  if (!memo) return;
  memo.settledReserves = null;
  memo.reflowSpent = null;
  memo.orphanPolicyPart = undefined;
}

export function noteBodyGeometryChanged(
  session: object | undefined,
  layout: SemanticLayout
): boolean {
  if (!session) return false;
  const previous = geometryBySession.get(session);
  const current = layout.pages.map(({ box, contentBox }) =>
    [
      box.width,
      box.height,
      contentBox.x - box.x,
      contentBox.y - box.y,
      contentBox.width,
      contentBox.height,
    ].join(',')
  );
  geometryBySession.set(session, current);
  // A changed page count alone is a result of note pagination, not a changed
  // constraint. Compare only sheets that already had a reserve context.
  return (
    previous !== undefined &&
    current.some((value, i) => previous[i] !== undefined && previous[i] !== value)
  );
}
