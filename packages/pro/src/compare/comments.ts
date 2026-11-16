/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Comments of a compare: the result keeps the original's comments and adds the revised
 * document's comments under the smallest ids the original does not use. A comment both
 * documents hold appears twice, once at each anchor, as the reference result shows it.
 */
import type { OoxmlPackage } from '@docx-editor.dev/core/store';
import type { StoryOutput } from './stories.ts';
import { storyXml } from './stories.ts';
import { freeIds, referencedIds } from './free-ids.ts';

const COMMENT_MARKERS = new Set(['commentRangeStart', 'commentRangeEnd', 'commentReference']);
import { fromPlaceholder, MARK, SideContext } from './units.ts';
import { attributeOf, elementChildren, NamespaceScope, type ElementNode } from './xml-fragments.ts';
import { freePartName, relatedPart } from './related-parts.ts';

const COMMENTS_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const COMMENTS_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';
const PLACEHOLDER = new RegExp(`${MARK}CMT:([^§"]+)§`, 'g');

/** The comment id a placeholder names, as the comments part's attribute reads it. */
const commentId = (encoded: string) => fromPlaceholder(encoded);

const commentsPart = (pkg: OoxmlPackage) => relatedPart(pkg, 'comments');

/**
 * Numbers the revised comments the stories refer to, rewrites their placeholders, and returns
 * the stories with the comments part they need. A marker of a comment the revised document
 * does not define is removed.
 */
export function mergeComments(
  base: OoxmlPackage,
  revised: OoxmlPackage,
  stories: readonly StoryOutput[]
): StoryOutput[] {
  const used = new Set<string>();
  for (const story of stories)
    for (const match of story.xml.matchAll(PLACEHOLDER)) used.add(commentId(match[1]!));
  if (used.size === 0) return [...stories];
  const basePart = commentsPart(base);
  const revisedPart = commentsPart(revised);
  const revisedComments = new Map<string, ElementNode>();
  for (const child of revisedPart ? elementChildren(revisedPart.root as ElementNode) : []) {
    const id = child.localName === 'comment' ? attributeOf(child, 'id') : undefined;
    if (id !== undefined && used.has(id)) revisedComments.set(id, child);
  }
  const baseIds: string[] = [];
  for (const child of basePart ? elementChildren(basePart.root as ElementNode) : []) {
    const id = attributeOf(child, 'id');
    if (id !== undefined) baseIds.push(id);
  }
  const nextId = freeIds([...baseIds, ...referencedIds(base, COMMENT_MARKERS, 'id')], 0);
  const ids = new Map<string, string>();
  for (const id of revisedComments.keys()) ids.set(id, nextId());
  const rewritten = stories.map((story) => ({
    ...story,
    xml: story.xml
      // A marker of a comment the revised document does not define is dropped.
      .replace(
        new RegExp(
          `<w:comment(?:RangeStart|RangeEnd)\\b[^>]*w:id="${MARK}CMT:([^§"]+)§"[^>]*/>`,
          'g'
        ),
        (whole, id: string) => (ids.has(commentId(id)) ? whole : '')
      )
      .replace(
        new RegExp(
          `<w:r>(?:(?!</w:r>).)*?<w:commentReference\\b[^>]*w:id="${MARK}CMT:([^§"]+)§"[^>]*/></w:r>`,
          'gs'
        ),
        (whole, id: string) => (ids.has(commentId(id)) ? whole : '')
      )
      .replace(PLACEHOLDER, (_, id: string) => ids.get(commentId(id)) ?? ''),
  }));
  if (ids.size === 0) return rewritten;

  const scope = new NamespaceScope();
  const partName = basePart?.name ?? freePartName(base, '/word/comments.xml');
  const baseSide = basePart ? new SideContext('base', base, basePart.name, scope) : null;
  const revisedSide = new SideContext('revised', revised, revisedPart!.name, scope);
  const root = (basePart ?? revisedPart)!.root as ElementNode;
  const xml = storyXml(scope, root, () => {
    let inner = '';
    for (const child of basePart ? elementChildren(basePart.root as ElementNode) : [])
      inner += baseSide!.serialize(child);
    for (const [id, comment] of revisedComments) {
      inner += revisedSide
        .serialize(comment)
        .replace(/\bw:id="[^"]*"/, `w:id="${ids.get(id)}"`)
        // Paragraph identities could repeat the original's; the reader assigns new ones.
        .replace(/\s\w+:(?:paraId|textId)="[^"]*"/g, '');
    }
    return inner;
  });
  rewritten.push({
    partName,
    contentType: basePart?.contentType || COMMENTS_CONTENT_TYPE,
    xml,
    isNew: !basePart,
    ...(basePart ? {} : { relType: COMMENTS_TYPE }),
  });
  return rewritten;
}
