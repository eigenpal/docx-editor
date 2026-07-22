/** @spike-features insert-delete-split-join-operations, origin-metadata */
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,127}$/;

export function isSpikeId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

export function validateSpikeId(value: unknown, label: string): string | null {
  if (!isSpikeId(value)) return `invalid ${label}`;
  return null;
}

export function validateSpikeIdList(value: unknown, label: string): string | null {
  if (!Array.isArray(value) || value.length === 0) return `invalid ${label}`;
  if (value.some((item) => !isSpikeId(item))) return `invalid ${label}`;
  return null;
}
