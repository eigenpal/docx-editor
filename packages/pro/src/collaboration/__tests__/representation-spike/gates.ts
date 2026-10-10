/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type {
  AllocationGateEvidence,
  BackendKind,
  GateVerdict,
  MoveGateEvidence,
} from './contract.ts';

export function allocationVerdict(localAllocated: number, remoteAllocated: number): GateVerdict {
  if (localAllocated <= 0) return remoteAllocated <= 0 ? 'pass' : 'kill';
  const ratio = remoteAllocated / localAllocated;
  if (ratio >= 10) return 'kill';
  if (ratio >= 3) return 'optimize';
  return 'pass';
}

export function allocationEvidence(
  backend: BackendKind,
  localAllocated: number,
  remoteAllocated: number
): AllocationGateEvidence {
  const ratio =
    localAllocated <= 0 ? (remoteAllocated <= 0 ? 0 : Infinity) : remoteAllocated / localAllocated;
  return {
    backend,
    localAllocated,
    remoteAllocated,
    ratio,
    verdict: allocationVerdict(localAllocated, remoteAllocated),
  };
}

export interface TimingSummary {
  readonly medianMs: number;
  readonly p95Ms: number;
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 1) return sorted[0]!;
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low]!;
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (index - low);
}

export function timingSummary(values: readonly number[]): TimingSummary {
  return { medianMs: percentile(values, 0.5), p95Ms: percentile(values, 0.95) };
}

export function timingVerdict(measured: TimingSummary, ceiling: TimingSummary): GateVerdict {
  if (measured.medianMs <= ceiling.medianMs && measured.p95Ms <= ceiling.p95Ms) return 'pass';
  return 'kill';
}

export function moveEvidence(
  backend: BackendKind,
  logicalIdSurvived: boolean,
  descendantEditSurvived: boolean
): MoveGateEvidence {
  return {
    backend,
    logicalIdSurvived,
    descendantEditSurvived,
    verdict: logicalIdSurvived && descendantEditSurvived ? 'pass' : 'kill',
  };
}
