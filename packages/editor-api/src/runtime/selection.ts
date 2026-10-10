/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Which properties a load actually asked for.
//
// Two rules, and the second is the one that matters:
//
// An EMPTY selection means "this object's own properties" — `load()` with no argument is a
// request for everything the object offers, not a request for nothing.
//
// A property this object does not have is `InvalidArgument`, naming it. Not ignored: a typo in a
// selected name is otherwise invisible until an unrelated-looking `PropertyNotLoaded` at the
// read, and the consumer's `load` call — which is where the mistake is — looks fine. The name is
// echoed in `target` because a selected property name is a value the consumer wrote in their own
// source, not data out of a document.

import { fail } from './errors.ts';
import type { ResolvedLoadOptions } from './load-options.ts';

export function selectedProperties(
  request: ResolvedLoadOptions,
  available: readonly string[],
  target: string
): readonly string[] {
  if (request.select.length === 0) return available;
  for (const name of request.select) {
    if (!available.includes(name)) fail({ code: 'InvalidArgument', target: `${target}.${name}` });
  }
  return request.select;
}
