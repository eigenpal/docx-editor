/** Whether two tracked edits belong to one short, continuous editing run. */
export function sameEditingMoment(
  existing: string | undefined,
  current: string | undefined
): boolean {
  if (existing === undefined || current === undefined) return existing === current;
  const from = Date.parse(existing);
  const to = Date.parse(current);
  if (Number.isNaN(from) || Number.isNaN(to)) return existing === current;
  return Math.abs(to - from) <= COALESCE_WINDOW_MS;
}

const COALESCE_WINDOW_MS = 60_000;
