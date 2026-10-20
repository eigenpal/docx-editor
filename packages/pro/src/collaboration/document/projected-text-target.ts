/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { LogicalId } from './identity.ts';

/**
 * Where a text edit the editor made in a split-text slice lands in the slice's source. The
 * projection rewrites the edit to address the source and keeps the slice's own address here,
 * for the decisions that depend on which slice owns a boundary.
 */
export interface ProjectedTextTarget {
  readonly logicalId: LogicalId;
  readonly utf16Start: number;
}

/**
 * `effect` carrying `target`. The target is part of the effect's data, so a copy of the
 * effect keeps it.
 */
export function withProjectedTarget<T extends object>(effect: T, target: ProjectedTextTarget): T {
  return { ...effect, projectedTarget: target };
}

/** The slice address a projected text edit carries, or undefined for any other effect. */
export function projectedTextTarget(effect: object): ProjectedTextTarget | undefined {
  return (effect as { readonly projectedTarget?: ProjectedTextTarget }).projectedTarget;
}
