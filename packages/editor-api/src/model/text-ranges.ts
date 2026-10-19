/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Argument checks for the word-range reads that `Range` and `Paragraph` share: `getTextRanges`,
// `getReviewedText`, and `Range.getRange`.
//
// Values arrive from a consumer, often an agent, in a language with no runtime types. Each one is
// checked against the documented vocabulary and refused by name, so a typo such as
// `getReviewedText('current')` fails instead of answering a different view.

import { fail } from '../runtime/model-support.ts';
import { ChangeTrackingVersion, RangeLocation } from './editing-enums.ts';

/** Most ending marks one `getTextRanges` call may name. The host applies the same cap. */
export const MAX_TEXT_RANGE_MARKS = 32;
/** Longest ending mark, in UTF-16 code units. The host applies the same cap. */
export const MAX_TEXT_RANGE_MARK_LENGTH = 32;

/** A copy of the ending marks, or `InvalidArgument`. */
export function textRangeMarks(value: unknown, target: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TEXT_RANGE_MARKS) {
    fail({ code: 'InvalidArgument', target });
  }
  for (const mark of value as unknown[]) {
    if (
      typeof mark !== 'string' ||
      mark.length === 0 ||
      mark.length > MAX_TEXT_RANGE_MARK_LENGTH ||
      hasUnpairedSurrogate(mark)
    )
      fail({ code: 'InvalidArgument', target });
  }
  return [...(value as string[])];
}

/** Whether a mark holds a surrogate half without its partner, which would cut a character. */
function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

/** An optional boolean argument, or `InvalidArgument`. */
export function optionalFlag(value: unknown, target: string): boolean {
  if (value !== undefined && typeof value !== 'boolean') fail({ code: 'InvalidArgument', target });
  return value === true;
}

/** The host's name for a change tracking version. `Current` is the default. */
export function reviewedTextVersion(value: unknown, target: string): 'original' | 'current' {
  if (value === undefined || value === ChangeTrackingVersion.current) return 'current';
  if (value === ChangeTrackingVersion.original) return 'original';
  fail({ code: 'InvalidArgument', target });
}

/** The locations `Range.getRange` answers. */
export type RangeGetRangeLocation = 'Whole' | 'Start' | 'End' | 'Content';

/**
 * A `Range.getRange` location the engine answers.
 *
 * `After` is part of the signature but refuses with `NotSupported`: a range here is a snapshot
 * that never owns the position after its end, so answering `End` instead would place later
 * insertions inside the paragraph where the caller asked for the position after it. Any value
 * outside the signature, `Before` included, is `InvalidArgument`.
 */
export function rangeGetRangeLocation(value: unknown, target: string): RangeGetRangeLocation {
  if (value === undefined) return 'Whole';
  if (value === RangeLocation.after) fail({ code: 'NotSupported', target });
  if (
    value !== RangeLocation.whole &&
    value !== RangeLocation.start &&
    value !== RangeLocation.end &&
    value !== RangeLocation.content
  )
    fail({ code: 'InvalidArgument', target });
  return value as RangeGetRangeLocation;
}
