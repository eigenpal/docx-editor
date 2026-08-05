import { getHyperlinkText, getRunText } from './helpers.ts';
import type { Paragraph } from './types.ts';
import { isTrackedChangeItem, trackedChangeText } from './legacy-model.ts';

/** Plain editable text of a legacy paragraph (drawings/generic are omitted from the projection). */
export function legacyParagraphPlainText(para: Paragraph): string {
  const parts: string[] = [];
  for (const item of para.content) {
    if (item.type === 'run') parts.push(getRunText(item));
    else if (item.type === 'hyperlink') parts.push(getHyperlinkText(item));
    else if (isTrackedChangeItem(item)) parts.push(trackedChangeText(item.content));
  }
  return parts.join('');
}

/** Smallest single edit explaining a plain-text change, or null when equal. */
export function plainTextEdit(
  before: string,
  after: string
): { readonly start: number; readonly deleteLength: number; readonly insertText: string } | null {
  if (before === after) return null;
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before.charCodeAt(prefix) === after.charCodeAt(prefix)
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  const deleteLength = before.length - prefix - suffix;
  const insertText = after.slice(prefix, after.length - suffix);
  return Object.freeze({ start: prefix, deleteLength, insertText });
}
