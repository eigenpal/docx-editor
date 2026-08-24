/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// How a search is narrowed, and which of those narrowings this engine actually performs.
//
// EVERY FLAG IS HONOURED OR REFUSED. A search that accepted `matchWildcards` and quietly did a
// plain-text scan would answer the wrong matches to a caller who then edits at those offsets, so
// the unimplemented options are passed through to the host, which refuses them. They are declared
// here — rather than left off the type — because leaving them off would make `{ matchWildcards:
// true }` a TypeScript error in code that is source-compatible with Word, and the honest answer to
// that code is a runtime refusal naming the option, not a compile error naming the type.

import type { AutomationSearchOptions } from '../runtime/model-support.ts';
import { fail } from '../runtime/model-support.ts';

/**
 * How a search is narrowed.
 *
 * Every flag is honoured or REFUSED — never quietly ignored. A search that accepted
 * `matchWildcards` and then ran a plain-text scan would answer the wrong offsets to a caller who
 * edits at them, so the unimplemented options reach the host and come back as `NotSupported`.
 *
 * They are declared here rather than left off the type because omitting them would make
 * `{ matchWildcards: true }` a compile error in code that is otherwise source-compatible with
 * Word. The honest answer to that code is a runtime refusal naming the option, not a type error
 * naming the interface.
 *
 * @public
 */
export interface SearchOptions {
  /** Match the query's case. Off by default, like Word's Find. */
  readonly matchCase?: boolean;
  /** Only match where the query stands alone as a word. */
  readonly matchWholeWord?: boolean;
  /** Not implemented; `true` is refused with `NotSupported`. */
  readonly ignorePunct?: boolean;
  /** Not implemented; `true` is refused with `NotSupported`. */
  readonly ignoreSpace?: boolean;
  /** Not implemented; `true` is refused with `NotSupported`. */
  readonly matchWildcards?: boolean;
}

const KNOWN: ReadonlySet<string> = new Set<keyof SearchOptions>([
  'matchCase',
  'matchWholeWord',
  'ignorePunct',
  'ignoreSpace',
  'matchWildcards',
]);

/**
 * The protocol's own options, with nothing invented.
 *
 * A flag the caller did not set is left OUT rather than sent as `false`: the two are the same to
 * this engine today, and sending a value nobody asked for would make a future host unable to tell
 * "the caller wants case-insensitive" from "the caller said nothing".
 */
export function searchOptions(
  options: SearchOptions | undefined,
  target: string
): AutomationSearchOptions | undefined {
  if (options === undefined) return undefined;
  if (typeof options !== 'object') fail({ code: 'InvalidArgument', target });
  for (const [name, value] of Object.entries(options)) {
    // A name this API does not have is refused rather than dropped. Word narrows a search in more
    // ways than this subset selects (`matchPrefix`, `matchSuffix`, …), and silently ignoring one
    // would answer matches the caller did not ask for — which they would then edit at.
    if (!KNOWN.has(name)) fail({ code: 'InvalidArgument', target: `${target}.${name}` });
    if (value !== undefined && typeof value !== 'boolean') {
      fail({ code: 'InvalidArgument', target: `${target}.${name}` });
    }
  }
  const selected: AutomationSearchOptions = {
    ...(options.matchCase === undefined ? {} : { matchCase: options.matchCase }),
    ...(options.matchWholeWord === undefined ? {} : { matchWholeWord: options.matchWholeWord }),
    ...(options.ignorePunct === undefined ? {} : { ignorePunct: options.ignorePunct }),
    ...(options.ignoreSpace === undefined ? {} : { ignoreSpace: options.ignoreSpace }),
    ...(options.matchWildcards === undefined ? {} : { matchWildcards: options.matchWildcards }),
  };
  return Object.keys(selected).length === 0 ? undefined : selected;
}
