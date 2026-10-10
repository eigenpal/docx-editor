// Write the benchmark summary as JSON for tools and Markdown for people.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { linearFit } from './analysis.ts';
import type { StepResult } from './runner.ts';

export interface BenchmarkSummary {
  readonly startedAt: string;
  readonly environment: Record<string, string | number>;
  readonly settings: Record<string, unknown>;
  readonly steps: readonly StepResult[];
  /** Cost of one more participant, from a straight line through the steps of one typing share (100% when present). */
  readonly perParticipant: {
    readonly serverRssMb: number;
    readonly serverCpuPct: number;
    readonly outboundKBps: number;
  } | null;
}

const fixed = (value: number, digits = 1) => value.toFixed(digits);

export function summarize(
  startedAt: string,
  environment: Record<string, string | number>,
  settings: Record<string, unknown>,
  steps: readonly StepResult[]
): BenchmarkSummary {
  // One line through one typing share; mixing shares would give a slope of nothing.
  const share = steps.some((step) => step.activeShare === 1) ? 1 : steps[0]?.activeShare;
  const measured = steps.filter((step) => step.server.load && step.activeShare === share);
  const fit = (pick: (step: StepResult) => number) =>
    linearFit(measured.map((step) => [step.participants, pick(step)])).slope;
  return {
    startedAt,
    environment,
    settings,
    steps,
    perParticipant:
      measured.length >= 2
        ? {
            serverRssMb: fit((step) => step.server.load!.rssMaxMb),
            serverCpuPct: fit((step) => step.server.load!.cpuAvgPct),
            outboundKBps: fit((step) => step.traffic.outboundKBps),
          }
        : null,
  };
}

export function markdown(summary: BenchmarkSummary): string {
  const lines: string[] = [];
  lines.push('# Collaboration server load benchmark', '');
  lines.push(`Started ${summary.startedAt}.`, '');
  lines.push('## Environment', '');
  for (const [key, value] of Object.entries(summary.environment)) lines.push(`- ${key}: ${value}`);
  lines.push('', '## Settings', '');
  for (const [key, value] of Object.entries(summary.settings)) {
    lines.push(`- ${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
  }
  lines.push('', '## Results', '');
  lines.push(
    '| Participants | Typing | Edits/s | Latency p50 / p95 / p99 / max (ms) | Join p95 (ms) | Server CPU avg / p95 (% of one core) | Server RSS peak (MB) | Event loop delay p99 / max (ms) | Server out (KB/s) | Client apply p95 (ms) | Client CPU per participant (cores) | Healthy |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  );
  for (const step of summary.steps) {
    const load = step.server.load;
    lines.push(
      `| ${step.participants} | ${step.activeParticipants} | ${fixed(step.edits.perSecond)} | ` +
        `${fixed(step.latencyMs.p50)} / ${fixed(step.latencyMs.p95)} / ${fixed(step.latencyMs.p99)} / ${fixed(step.latencyMs.max)} | ` +
        `${fixed(step.joinMs.p95, 0)} | ` +
        (load
          ? `${fixed(load.cpuAvgPct)} / ${fixed(load.cpuP95Pct)} | ${fixed(load.rssMaxMb)} | ` +
            `${fixed(load.eventLoopP99MaxMs)} / ${fixed(load.eventLoopMaxMs)} | `
          : 'n/a | n/a | n/a | ') +
        `${fixed(step.traffic.outboundKBps)} | ${fixed(step.clients.remoteApplyMs.p95)} | ` +
        `${fixed(step.clients.cpuCoresPerParticipant, 2)} | ${step.healthy ? 'yes' : 'NO'} |`
    );
  }
  lines.push('', '## Server egress by message type (KB/s)', '');
  const types = [...new Set(summary.steps.flatMap((step) => Object.keys(step.traffic.byType)))]
    .filter((type) =>
      summary.steps.some((step) => (step.traffic.byType[type]?.bytesReceived ?? 0) > 0)
    )
    .sort();
  lines.push(
    `| Participants | Typing | ${types.join(' | ')} |`,
    `| --- | --- |${types.map(() => ' --- |').join('')}`
  );
  for (const step of summary.steps) {
    const seconds = Math.max(0.001, step.durationMs / 1000);
    const cells = types.map((type) =>
      fixed((step.traffic.byType[type]?.bytesReceived ?? 0) / 1024 / seconds)
    );
    lines.push(`| ${step.participants} | ${step.activeParticipants} | ${cells.join(' | ')} |`);
  }
  if (summary.perParticipant) {
    const cost = summary.perParticipant;
    lines.push('', '## Cost of one more participant', '');
    lines.push(`- Server memory: ${fixed(cost.serverRssMb, 2)} MB`);
    lines.push(`- Server CPU: ${fixed(cost.serverCpuPct, 2)} % of one core`);
    lines.push(`- Server egress: ${fixed(cost.outboundKBps, 2)} KB/s`);
  }
  const unhealthy = summary.steps.filter((step) => !step.healthy);
  const saturated = summary.steps.filter((step) => step.health.clientMachineSaturated);
  if (unhealthy.length || saturated.length) {
    lines.push('', '## Problems', '');
    for (const step of unhealthy) {
      lines.push(
        `- ${step.participants} participants, ${step.activeParticipants} typing: ${step.problems.join('; ')}`
      );
    }
    for (const step of saturated) {
      lines.push(
        `- ${step.participants} participants, ${step.activeParticipants} typing: the client machine fell behind its keystroke plan ` +
          `(p95 ${fixed(step.clients.schedulerLagMs.p95)} ms late). Latency includes client delay.`
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

/** One row per step, for spreadsheets and chart tools. */
export function csv(summary: BenchmarkSummary): string {
  const header = [
    'participants',
    'active_participants',
    'active_share',
    'edits_per_s',
    'latency_p50_ms',
    'latency_p95_ms',
    'latency_max_ms',
    'server_cpu_avg_pct',
    'server_cpu_p95_pct',
    'server_rss_max_mb',
    'server_heap_max_mb',
    'event_loop_p99_ms',
    'event_loop_max_ms',
    'server_out_kbps',
    'server_in_kbps',
    'disk_write_kbps',
    'room_bytes',
    'docx_bytes',
    'export_ms_max',
    'client_machine_saturated',
    'healthy',
  ];
  const rows = summary.steps.map((step) => {
    const load = step.server.load;
    return [
      step.participants,
      step.activeParticipants,
      step.activeShare,
      fixed(step.edits.perSecond, 2),
      fixed(step.latencyMs.p50),
      fixed(step.latencyMs.p95),
      fixed(step.latencyMs.max),
      load ? fixed(load.cpuAvgPct, 2) : '',
      load ? fixed(load.cpuP95Pct, 2) : '',
      load ? fixed(load.rssMaxMb) : '',
      load ? fixed(load.heapUsedMaxMb) : '',
      load ? fixed(load.eventLoopP99MaxMs) : '',
      load ? fixed(load.eventLoopMaxMs) : '',
      fixed(step.traffic.outboundKBps, 2),
      fixed(step.traffic.inboundKBps, 2),
      step.disk ? fixed(step.disk.writeKBps, 2) : '',
      step.disk?.roomBytes ?? '',
      step.disk?.docxBytes ?? '',
      step.disk ? fixed(step.disk.exportMsMax) : '',
      step.health.clientMachineSaturated,
      step.healthy,
    ].join(',');
  });
  return `${[header.join(','), ...rows].join('\n')}\n`;
}

export function writeSummary(directory: string, summary: BenchmarkSummary): void {
  writeFileSync(path.join(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(path.join(directory, 'summary.md'), markdown(summary));
  writeFileSync(path.join(directory, 'summary.csv'), csv(summary));
}
