/** @spike-features seeded-rng-diagnostics */
export interface FailureDiagnostic {
  fixture: string;
  seed?: number;
  operations: readonly unknown[];
  origins: readonly string[];
  revisions: readonly number[];
  divergentState: unknown;
}

export function formatFailureDiagnostic(d: FailureDiagnostic): string {
  const lines = ['engine-core-spike parity failure', `fixture: ${d.fixture}`];
  if (d.seed !== undefined) lines.push(`seed: ${d.seed}`);
  lines.push(`operations: ${JSON.stringify(d.operations)}`);
  lines.push(`origins: ${JSON.stringify(d.origins)}`);
  lines.push(`revisions: ${JSON.stringify(d.revisions)}`);
  lines.push(`divergentState: ${JSON.stringify(d.divergentState)}`);
  return lines.join('\n');
}
