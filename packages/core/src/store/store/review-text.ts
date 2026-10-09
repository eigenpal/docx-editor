import {
  inlineCharacterTextOf,
  isSymbolElement,
  withDisplayedHyphens,
} from '../package/hyphen-text.ts';
import { symbolDisplayText } from '../package/symbol-glyph.ts';
import type { OoxmlNode } from '../package/ooxml-tree.ts';
import { hardBreakText } from '../package/hard-break.ts';
import { isInstrText } from '../package/field-nodes.ts';
import type { CommentRecord } from './comment-reads.ts';

/**
 * Plain text of a comment's body, as a card shows it: a non-breaking hyphen is U+2011, an
 * optional hyphen shows nothing, and a symbol shows its glyph. A card never re-implements the
 * run walk.
 */
export function commentBodyText(comment: CommentRecord): string {
  return withDisplayedHyphens(commentBodyTextOf(comment, true));
}

/** A comment body in paragraph-text characters, as automation reads it (U+001E, U+001F, "("). */
export function commentBodyModelText(comment: CommentRecord): string {
  return commentBodyTextOf(comment, false);
}

function commentBodyTextOf(comment: CommentRecord, display: boolean): string {
  const parts: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') {
      parts.push(node.value);
      return;
    }
    if (display && isSymbolElement(node)) {
      parts.push(symbolDisplayText(node));
      return;
    }
    // One character each, as in paragraph text; a card maps them for display.
    const hyphen = inlineCharacterTextOf(node);
    if (hyphen !== null) {
      parts.push(hyphen);
      return;
    }
    for (const child of node.children) visit(child);
  };
  for (const block of comment.blocks) visit(block);
  return parts.join('');
}

/** The most initials an avatar or marker shows. `@w:initials` comes from the file, unbounded. */
const MAX_INITIALS = 3;

/**
 * Author initials for an avatar, from `@w:initials` or the name, at most three characters.
 * Characters are code points, so a surrogate pair is never split.
 */
export function commentInitials(comment: CommentRecord): string {
  const declared = comment.initials?.trim();
  if (declared) return Array.from(declared).slice(0, MAX_INITIALS).join('');
  const words = comment.author.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
}

/** Text under a node, counting `w:t` and `w:delText` alike. */
export function textUnder(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  // A tab or a break carries no text value, so a card derived from a tracked one read as
  // EMPTY — the reviewer was asked to accept content they were never shown, and a tab
  // replacing a word presented as a pure deletion. Project the same characters the offset
  // model counts for them.
  if (node.kind === 'tab') return '\t';
  if (node.kind === 'hardBreak') return hardBreakText(node);
  // A card shows a symbol's glyph, not the "(" its model text reads as.
  if (isSymbolElement(node)) return symbolDisplayText(node);
  const hyphen = inlineCharacterTextOf(node);
  if (hyphen !== null) return hyphen;
  // A field's instruction is CODE, not content: it measures nothing in the offset model,
  // and a tracked page field would otherwise present its ` PAGE ` source as inserted
  // words. `isInstrText` covers all three spellings — the typed kind, the parse-demoted
  // generic, and `w:delInstrText`, which a struck field's card would otherwise read out.
  if (isInstrText(node)) return '';
  let text = '';
  for (const child of node.children) text += textUnder(child);
  return text;
}
