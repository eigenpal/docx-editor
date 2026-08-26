import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';

const root = resolve(import.meta.dir, '../..');
const baselinePath = resolve(
  root,
  'openspec/changes/full-document-yjs-collaboration/local-edit-baseline.json'
);
const budgetsPath = resolve(
  root,
  'openspec/changes/full-document-yjs-collaboration/collaboration-budgets.json'
);
const fixturePath = resolve(root, 'e2e/fixtures/synthetic-long-edit.docx');

const FIXTURE_SHA256 = 'ca8ee28a8d40ae7914a820303b96ddbbe8f06d37325b0fc2ae6f1140aea96321';

interface Timing {
  readonly medianMs: number;
  readonly p95Ms: number;
}

interface Baseline {
  readonly task: string;
  readonly capturedAt: string;
  readonly fixtureBytes: number;
  readonly fixtureSha256: string;
  readonly environment: {
    readonly runtime: string;
    readonly arch: string;
    readonly platform: string;
  };
  readonly config: { readonly runs: number; readonly warmup: number };
  readonly target: {
    readonly paragraphIndex: number;
    readonly paragraphId: string;
    readonly collaborationParagraphId: string;
  };
  readonly timings: {
    readonly transaction: Timing;
    readonly layout: Timing;
    readonly paint: Timing;
    readonly total: Timing;
  };
  readonly memory: {
    readonly heapUsedDeltaMedian: Record<string, number>;
    readonly rssDeltaMedian: { readonly editThroughPaint: number };
    readonly externalDeltaMedian: { readonly editThroughPaint: number };
  };
  readonly work: {
    readonly layout: Record<string, unknown>;
    readonly canonical: Record<string, unknown>;
    readonly dirty: Record<string, unknown>;
    readonly paint: Record<string, unknown>;
    readonly yjs: Record<string, unknown>;
  };
}

interface Budgets {
  readonly source: { readonly baselineTask: string; readonly capturedAt: string };
  readonly fixture: { readonly bytes: number; readonly sha256: string };
  readonly target: {
    readonly paragraphIndex: number;
    readonly paragraphId: string;
    readonly collaborationParagraphId: string;
  };
  readonly samples: {
    readonly pullRequestWork: { readonly warmup: number; readonly runs: number };
    readonly maintainedHardware: { readonly warmup: number; readonly runs: number };
    readonly browserTyping: {
      readonly isolatedSamples: number;
      readonly unpacedCharacters: number;
    };
  };
  readonly hardwareProfile: {
    readonly runtime: string;
    readonly arch: string;
    readonly platform: string;
  };
  readonly lanes: {
    readonly workCounters: { readonly pullRequest: boolean };
    readonly timings: { readonly pullRequest: boolean; readonly maintainedHardware: boolean };
    readonly rss: { readonly pullRequest: boolean; readonly maintainedHardware: boolean };
    readonly external: { readonly pullRequest: boolean; readonly maintainedHardware: boolean };
    readonly heapUsed: { readonly pullRequest: boolean; readonly maintainedHardware: boolean };
  };
  readonly ratios: {
    readonly allocationPassExclusive: number;
    readonly allocationKillInclusive: number;
    readonly layoutPaintWorkMaxInclusive: number;
    readonly timingMaxInclusive: number;
    readonly rssMaxInclusive: number;
  };
  readonly localExact: {
    readonly canonical: Record<string, unknown>;
    readonly dirty: Record<string, unknown>;
    readonly layout: Record<string, unknown>;
    readonly paint: Record<string, unknown>;
    readonly yjsProofSchema: Record<string, unknown>;
    readonly memory: {
      readonly heapUsedDeltaMedian: Record<string, number>;
      readonly rssDeltaMedian: { readonly editThroughPaint: number };
      readonly externalDeltaMedian: { readonly editThroughPaint: number };
    };
    readonly timings: {
      readonly transaction: Timing;
      readonly layout: Timing;
      readonly paint: Timing;
      readonly total: Timing;
    };
  };
  readonly pullRequest: {
    readonly remoteOneCharacter: {
      readonly canonicalAllocated: {
        readonly passMaxExclusive: number;
        readonly optimizeMinInclusive: number;
        readonly optimizeMaxExclusive: number;
        readonly killMinInclusive: number;
        readonly offPathMustBe: number;
      };
      readonly layout: { readonly placedMaxInclusive: number; readonly fullPasses: number };
      readonly paint: { readonly rebuiltPaintElements: number };
      readonly bytes: {
        readonly incrementalUpdatePassMaxExclusive: number;
        readonly incrementalUpdateKillMinInclusive: number;
        readonly snapshotGrowthPassMaxExclusive: number;
        readonly proofSchemaSnapshotBytes: number;
      };
    };
    readonly reconnect: {
      readonly empty: {
        readonly allocated: number;
        readonly extraFullPasses: number;
        readonly rebuiltPaintElements: number;
        readonly snapshotDeltaMaxBytes: number;
      };
    };
  };
  readonly maintainedHardware: {
    readonly remoteTimingMaxInclusive: {
      readonly transaction: Timing;
      readonly layout: Timing;
      readonly paint: Timing;
      readonly total: Timing;
    };
    readonly rssDeltaMaxInclusive: { readonly editThroughPaint: number };
    readonly browserTyping: {
      readonly eligibleMedianMs: number;
      readonly eligibleP95Ms: number;
      readonly surface: string;
    };
  };
  readonly failurePolicy: {
    readonly pullRequestWorkMiss: string;
    readonly pullRequestTimingOrRss: string;
    readonly hardwareTimingOrRssMiss: string;
  };
  readonly keystrokePath: {
    readonly replicationInsideTransact: boolean;
    readonly yjsUpdatesDuringLocalTransactMustBe: number;
    readonly flushSeam: string;
  };
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline;
const budgets = JSON.parse(readFileSync(budgetsPath, 'utf8')) as Budgets;

function medianP95(timing: Timing): Timing {
  return { medianMs: timing.medianMs, p95Ms: timing.p95Ms };
}

describe('collaboration budget artifact', () => {
  test('pins the 1.7 fixture hash and file bytes', () => {
    const sha256 = createHash('sha256').update(readFileSync(fixturePath)).digest('hex');
    expect(sha256).toBe(FIXTURE_SHA256);
    expect(baseline.fixtureSha256).toBe(sha256);
    expect(budgets.fixture.sha256).toBe(sha256);
    expect(budgets.fixture.bytes).toBe(baseline.fixtureBytes);
    expect(budgets.fixture.bytes).toBe(27897);
  });

  test('copies local work, memory, and timing from the 1.7 baseline', () => {
    expect(budgets.source.baselineTask).toBe(baseline.task);
    expect(budgets.source.capturedAt).toBe(baseline.capturedAt);
    expect(budgets.target.paragraphIndex).toBe(baseline.target.paragraphIndex);
    expect(budgets.target.paragraphId).toBe(baseline.target.paragraphId);
    expect(budgets.target.collaborationParagraphId).toBe(baseline.target.collaborationParagraphId);
    expect(budgets.localExact.canonical).toEqual(baseline.work.canonical);
    expect(budgets.localExact.dirty).toEqual(baseline.work.dirty);
    expect(budgets.localExact.layout).toEqual(baseline.work.layout);
    expect(budgets.localExact.paint).toEqual(baseline.work.paint);
    expect(budgets.localExact.yjsProofSchema).toEqual(baseline.work.yjs);
    expect(budgets.localExact.memory.heapUsedDeltaMedian).toEqual(
      baseline.memory.heapUsedDeltaMedian
    );
    expect(budgets.localExact.memory.rssDeltaMedian).toEqual(baseline.memory.rssDeltaMedian);
    expect(budgets.localExact.memory.externalDeltaMedian).toEqual(
      baseline.memory.externalDeltaMedian
    );
    expect(budgets.localExact.timings.transaction).toEqual(medianP95(baseline.timings.transaction));
    expect(budgets.localExact.timings.layout).toEqual(medianP95(baseline.timings.layout));
    expect(budgets.localExact.timings.paint).toEqual(medianP95(baseline.timings.paint));
    expect(budgets.localExact.timings.total).toEqual(medianP95(baseline.timings.total));
    expect(budgets.localExact.canonical.allocatedOffParagraphPath).toBe(0);
    expect(budgets.hardwareProfile.runtime).toBe(baseline.environment.runtime);
    expect(budgets.hardwareProfile.arch).toBe(baseline.environment.arch);
    expect(budgets.hardwareProfile.platform).toBe(baseline.environment.platform);
  });

  test('locks layout work to the edit-bench steady-middle-text row', () => {
    expect(budgets.localExact.layout).toEqual({
      placed: 13,
      total: 3200,
      reusedPages: 154,
      fullPasses: 1,
      pagesBefore: 204,
      pagesAfter: 204,
      cache: { hits: 12, misses: 3201, evictions: 0, size: 3201 },
    });
  });

  test('separates pull-request work counters from timing and RSS gates', () => {
    expect(budgets.lanes.workCounters.pullRequest).toBe(true);
    expect(budgets.lanes.timings.pullRequest).toBe(false);
    expect(budgets.lanes.rss.pullRequest).toBe(false);
    expect(budgets.lanes.external.pullRequest).toBe(false);
    expect(budgets.lanes.heapUsed.pullRequest).toBe(false);
    expect(budgets.lanes.heapUsed.maintainedHardware).toBe(false);
    expect(budgets.lanes.timings.maintainedHardware).toBe(true);
    expect(budgets.lanes.rss.maintainedHardware).toBe(true);
    expect(budgets.lanes.external.maintainedHardware).toBe(false);
    expect(budgets.failurePolicy.pullRequestWorkMiss).toBe('fail-pr');
    expect(budgets.failurePolicy.pullRequestTimingOrRss).toBe('do-not-fail-pr');
    expect(budgets.failurePolicy.hardwareTimingOrRssMiss).toBe(
      'fail-maintained-job-on-recorded-profile'
    );
  });

  test('derives remote allocation bands from local allocated=6', () => {
    const local = budgets.localExact.canonical.allocated as number;
    expect(local).toBe(6);
    const remote = budgets.pullRequest.remoteOneCharacter.canonicalAllocated;
    expect(remote.passMaxExclusive).toBe(local * budgets.ratios.allocationPassExclusive);
    expect(remote.killMinInclusive).toBe(local * budgets.ratios.allocationKillInclusive);
    expect(remote.optimizeMinInclusive).toBe(remote.passMaxExclusive);
    expect(remote.optimizeMaxExclusive).toBe(remote.killMinInclusive);
    expect(remote.offPathMustBe).toBe(0);
    expect(17).toBeLessThan(remote.passMaxExclusive);
    expect(18).toBeGreaterThanOrEqual(remote.optimizeMinInclusive);
    expect(60).toBeGreaterThanOrEqual(remote.killMinInclusive);
  });

  test('derives remote layout, paint, byte, and reconnect work ceilings', () => {
    const localPlaced = budgets.localExact.layout.placed as number;
    const localUpdate = budgets.localExact.yjsProofSchema.incrementalUpdateBytes as number;
    const localSnapshot = budgets.localExact.yjsProofSchema.snapshotBytes as number;
    const remote = budgets.pullRequest.remoteOneCharacter;
    expect(remote.layout.placedMaxInclusive).toBe(
      localPlaced * budgets.ratios.layoutPaintWorkMaxInclusive
    );
    expect(remote.layout.fullPasses).toBe(1);
    expect(remote.paint.rebuiltPaintElements).toBe(0);
    expect(remote.bytes.incrementalUpdatePassMaxExclusive).toBe(
      localUpdate * budgets.ratios.allocationPassExclusive
    );
    expect(remote.bytes.incrementalUpdateKillMinInclusive).toBe(
      localUpdate * budgets.ratios.allocationKillInclusive
    );
    expect(remote.bytes.snapshotGrowthPassMaxExclusive).toBe(
      remote.bytes.incrementalUpdatePassMaxExclusive
    );
    expect(remote.bytes.proofSchemaSnapshotBytes).toBe(localSnapshot);
    const empty = budgets.pullRequest.reconnect.empty;
    expect(empty.allocated).toBe(0);
    expect(empty.extraFullPasses).toBe(0);
    expect(empty.rebuiltPaintElements).toBe(0);
    expect(empty.snapshotDeltaMaxBytes).toBe(Math.floor(localSnapshot * 0.01));
  });

  test('derives hardware timing and RSS ceilings as 2× local', () => {
    const factor = budgets.ratios.timingMaxInclusive;
    expect(factor).toBe(2);
    expect(budgets.samples.maintainedHardware).toEqual({
      warmup: baseline.config.warmup,
      runs: baseline.config.runs,
    });
    expect(budgets.samples.pullRequestWork).toEqual({ warmup: 1, runs: 1 });
    expect(budgets.samples.browserTyping).toEqual({
      isolatedSamples: 100,
      unpacedCharacters: 180,
    });
    const local = budgets.localExact.timings;
    const remote = budgets.maintainedHardware.remoteTimingMaxInclusive;
    expect(remote.transaction.medianMs).toBe(local.transaction.medianMs * factor);
    expect(remote.transaction.p95Ms).toBe(local.transaction.p95Ms * factor);
    expect(remote.layout.medianMs).toBe(local.layout.medianMs * factor);
    expect(remote.layout.p95Ms).toBe(local.layout.p95Ms * factor);
    expect(remote.paint.medianMs).toBe(local.paint.medianMs * factor);
    expect(remote.paint.p95Ms).toBe(local.paint.p95Ms * factor);
    expect(remote.total.medianMs).toBe(local.total.medianMs * factor);
    expect(remote.total.p95Ms).toBe(local.total.p95Ms * factor);
    expect(budgets.maintainedHardware.rssDeltaMaxInclusive.editThroughPaint).toBe(
      budgets.localExact.memory.rssDeltaMedian.editThroughPaint * budgets.ratios.rssMaxInclusive
    );
    expect(baseline.memory.heapUsedDeltaMedian.editThroughPaint).toBe(0);
    expect(budgets.maintainedHardware.browserTyping).toEqual({
      eligibleMedianMs: 16.7,
      eligibleP95Ms: 33.4,
      surface: 'Chromium beforeinput presentation, not happy-dom paint',
    });
  });

  test('pins collaboration replication off the local transact path', () => {
    expect(budgets.keystrokePath).toEqual({
      replicationInsideTransact: false,
      yjsUpdatesDuringLocalTransactMustBe: 0,
      flushSeam: 'CollaborationDocumentPort.flushPendingJournals',
    });
  });
});
