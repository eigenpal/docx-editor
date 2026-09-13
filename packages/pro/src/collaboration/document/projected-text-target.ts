/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { CanonicalPrimitiveEffect } from '@docx-editor.dev/core/collaboration/replication';

/** The intended visible target survives translation for source-boundary ownership decisions. */
export const sourceTargets = new WeakMap<
  CanonicalPrimitiveEffect,
  { readonly logicalId: string; readonly utf16Start: number }
>();
export function projectedTextTarget(
  effect: CanonicalPrimitiveEffect
): { readonly logicalId: string; readonly utf16Start: number } | undefined {
  return sourceTargets.get(effect);
}
