/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import type { CSSProperties } from 'vue';
import type { DocxEditorInstance, ReviewAuthorInfo } from '@docx-editor.dev/core/editor';
import type { ReviewItemView } from './useReview.ts';
import { AUTHOR_SLOTS } from './review-shared.ts';

export function authorAccent(info: ReviewAuthorInfo | undefined, fallbackSlot: number): string {
  return info?.color ?? `var(--doc-review-author-${fallbackSlot % AUTHOR_SLOTS})`;
}

export function authorCardStyle(
  author: string | undefined,
  info: ReviewAuthorInfo | undefined,
  fallbackSlot: number
): CSSProperties {
  if (!author) return {};
  return {
    '--doc-review-author-current': authorAccent(info, fallbackSlot),
  } as CSSProperties;
}

export function authorSlot(info: ReviewAuthorInfo | undefined, fallbackSlot: number): number {
  return (info?.slot ?? fallbackSlot) % AUTHOR_SLOTS;
}

export function resolveReviewAuthorInfo(
  roster: readonly ReviewAuthorInfo[],
  items: readonly ReviewItemView[],
  authorSlots: ReadonlyMap<string, number>,
  editor: DocxEditorInstance | null,
  synthetic: Map<string, ReviewAuthorInfo>
): ReadonlyMap<string, ReviewAuthorInfo> {
  const byAuthor = new Map<string, ReviewAuthorInfo>();
  for (const info of roster) byAuthor.set(info.author, info);
  const authors = [...items.map((entry) => entry.author), editor?.getConfiguredAuthor()];
  for (const author of authors) {
    if (!author || byAuthor.has(author)) continue;
    const slot = authorSlots.get(author) ?? 0;
    const style = editor?.getReviewAuthorStyle(author);
    const color = style?.color ?? `var(--doc-review-author-${slot % AUTHOR_SLOTS})`;
    const cached = synthetic.get(author);
    const resolved: ReviewAuthorInfo =
      cached?.slot === slot && cached.color === color && cached.style === style
        ? cached
        : { author, slot, color, ...(style ? { style } : {}) };
    synthetic.set(author, resolved);
    byAuthor.set(author, resolved);
  }
  return byAuthor;
}
