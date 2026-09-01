export function canonicalLayout(value: unknown, key = ''): unknown {
  // Image decode is a host port (happy-dom refuses the fixture's tiny PNGs while the Node
  // header parser admits them); drawing geometry is compared, transient resource state is not.
  // Export sessions enrich the otherwise host-identical layout with review artifacts from the
  // atomic package revision. Browser layout keeps its existing editor-owned review model; artifact
  // parity is covered by export-session tests rather than this geometry/semantic-record comparison.
  if (key === 'revision' || key === 'part' || key === 'resource' || key === 'reviewArtifacts') {
    return undefined;
  }
  if (typeof value === 'number') return Number(value.toFixed(6));
  if (Array.isArray(value)) return value.map((entry) => canonicalLayout(entry));
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const property of Object.keys(value as object).sort()) {
    const normalized = canonicalLayout((value as Record<string, unknown>)[property], property);
    if (normalized !== undefined && typeof normalized !== 'function') result[property] = normalized;
  }
  return result;
}
