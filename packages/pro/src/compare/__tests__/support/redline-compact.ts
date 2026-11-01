/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * A compact, comparable redline: only the paragraphs whose text, mark, or row changed, with long unchanged
 * text cut to its ends. The committed reference stores this form, and the reference test
 * reduces the engine's output the same way before scoring.
 */
import type {
  NormalParagraph,
  NormalStory,
  RedlineNormalForm,
  SegmentMark,
} from './redline-normal-form.ts';

/** Unchanged text longer than this keeps only its ends. */
const KEEP_EQUAL = 40;

export interface CompactParagraph {
  /** Segments as `[mark, text, formatChanged]`. */
  readonly s: readonly (readonly [SegmentMark, string, 0 | 1])[];
  readonly m?: 'ins' | 'del';
  readonly r?: 'ins' | 'del';
  readonly t?: number;
  readonly p?: 1;
  readonly b?: 1;
}

export interface CompactRedline {
  readonly stories: readonly {
    readonly kind: string;
    readonly paragraphs: readonly CompactParagraph[];
  }[];
  readonly counts: Readonly<Record<string, number>>;
}

// Only what the score reads: text, paragraph-mark, and row revisions.
const changed = (p: NormalParagraph) =>
  !!p.mark || !!p.row || p.segments.some((segment) => segment.mark !== 'eq');

const shorten = (text: string) =>
  text.length <= 2 * KEEP_EQUAL ? text : `${text.slice(0, KEEP_EQUAL)}…${text.slice(-KEEP_EQUAL)}`;

export function compactRedline(form: RedlineNormalForm): CompactRedline {
  return {
    stories: form.stories
      .filter((story) => story.kind !== 'comments')
      .map((story) => ({
        kind: story.kind,
        paragraphs: story.paragraphs.filter(changed).map(
          (p): CompactParagraph => ({
            s: p.segments.map((segment) => [
              segment.mark,
              segment.mark === 'eq' && !segment.formatChanged
                ? shorten(segment.text)
                : segment.text,
              segment.formatChanged ? 1 : 0,
            ]),
            ...(p.mark ? { m: p.mark } : {}),
            ...(p.row ? { r: p.row } : {}),
            ...(p.tableDepth ? { t: p.tableDepth } : {}),
            ...(p.propertiesChanged ? { p: 1 as const } : {}),
            ...(p.inTextBox ? { b: 1 as const } : {}),
          })
        ),
      }))
      .filter((story) => story.paragraphs.length > 0),
    counts: form.revisionCounts,
  };
}

/** The normal form a compact redline stands for, for scoring. */
export function expandRedline(compact: CompactRedline): RedlineNormalForm {
  return {
    stories: compact.stories.map(
      (story): NormalStory => ({
        kind: story.kind,
        part: '',
        paragraphs: story.paragraphs.map(
          (p): NormalParagraph => ({
            segments: p.s.map(([mark, text, format]) => ({
              mark,
              text,
              formatChanged: format === 1,
            })),
            mark: p.m ?? null,
            propertiesChanged: p.p === 1,
            row: p.r ?? null,
            tableDepth: p.t ?? 0,
            inTextBox: p.b === 1,
          })
        ),
      })
    ),
    revisionCounts: compact.counts,
    authors: [],
  };
}
