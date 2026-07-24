// Lighthouse accessibility gate for the production-editor a11y harness (task 4.7).

export interface LighthouseGateSummary {
  readonly url: string;
  readonly accessibilityScore: number | null;
  readonly failedAuditIds: readonly string[];
  readonly failedAuditTitles: readonly string[];
  readonly note: string;
}

export interface LighthouseReportLike {
  readonly categories?: {
    readonly accessibility?: { readonly score?: number | null };
  };
  readonly audits?: Record<string, { readonly id?: string; readonly title?: string; readonly score?: number | null } | undefined>;
}

export function evaluateLighthouseGate(report: LighthouseReportLike, url: string): LighthouseGateSummary {
  const score = report.categories?.accessibility?.score ?? null;
  const audits = report.audits ?? {};
  const failed = Object.values(audits).filter(
    (audit): audit is { id: string; title: string; score: number } =>
      !!audit &&
      typeof audit === 'object' &&
      typeof audit.score === 'number' &&
      audit.score < 1 &&
      typeof audit.id === 'string' &&
      typeof audit.title === 'string',
  );

  return {
    url,
    accessibilityScore: score,
    failedAuditIds: failed.map((audit) => audit.id),
    failedAuditTitles: failed.map((audit) => audit.title),
    note: 'Harness-only audit; app-shell issues outside this change are not claimed fixed.',
  };
}

export function lighthouseGateExitCode(summary: LighthouseGateSummary): number {
  if (summary.accessibilityScore !== 1) return 1;
  if (summary.failedAuditIds.length > 0) return 1;
  return 0;
}
