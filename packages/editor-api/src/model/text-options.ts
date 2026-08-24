/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { fail, type AutomationTextProjection } from '../runtime/model-support.ts';

/**
 * Which revision text a read or search exposes.
 *
 * `all` includes pending insertions, deletions, and both sides of replacements. It is the default
 * for compatibility. `vanilla` describes the document before pending changes are accepted:
 * pending deletions remain visible, pending insertions stay hidden, and a replacement shows only
 * its deleted original.
 *
 * @public
 */
export type TextProjection = 'all' | 'vanilla';

/** Options for an explicit text read. */
export interface TextReadOptions {
  /** The revision projection. Omitted means `all`. */
  readonly projection?: TextProjection;
}

/** Validate a public text projection and return the protocol spelling. */
export function textProjection(
  options: TextReadOptions | undefined,
  target: string
): AutomationTextProjection | undefined {
  if (options === undefined) return undefined;
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    fail({ code: 'InvalidArgument', target });
  }
  for (const name of Object.keys(options)) {
    if (name !== 'projection') fail({ code: 'InvalidArgument', target: `${target}.${name}` });
  }
  const projection = options.projection;
  if (projection !== undefined && projection !== 'all' && projection !== 'vanilla') {
    fail({ code: 'InvalidArgument', target: `${target}.projection` });
  }
  return projection;
}
