/**
 * Comment Parser - Parse comments.xml and commentsExtensible.xml
 *
 * Parses OOXML comments (w:comment) from comments.xml file.
 * Cross-references with commentsExtensible.xml (or commentsExtended.xml)
 * to obtain reliable UTC timestamps via w16cex:dateUtc.
 *
 * Note: Microsoft Word stores w:date as local time WITHOUT timezone offset,
 * which is ambiguous. The reliable UTC timestamp lives in the separate
 * commentsExtensible.xml part (Word 2016+).
 *
 * OOXML Reference:
 * - Comments: w:comments
 * - Comment: w:comment (w:id, w:author, w:date, w:initials)
 * - Comment content: child w:p elements
 */

import type { Comment, Paragraph, Theme, RelationshipMap, MediaFile } from '../types/document';
import type { StyleMap } from './styleParser';
import { parseXml, findChild, getChildElements, getAttribute } from './xmlParser';
import { parseParagraph } from './paragraphParser';

/**
 * Build a lookup from paraId → dateUtc from commentsExtensible.xml
 *
 * The XML structure is:
 * <w16cex:commentsExtensible>
 *   <w16cex:comment w16cex:paraId="..." w16cex:dateUtc="2024-02-10T14:30:45Z"/>
 * </w16cex:commentsExtensible>
 */
function parseCommentsExtensible(xml: string): Map<string, string> {
  const dateUtcByParaId = new Map<string, string>();

  const root = parseXml(xml);
  if (!root) return dateUtcByParaId;

  // Find the root element (may be w16cex:commentsExtensible or similar)
  const container = findChild(root, 'w16cex', 'commentsExtensible') ?? root;
  for (const child of getChildElements(container)) {
    const localName = child.name?.replace(/^.*:/, '') ?? '';
    if (localName !== 'comment') continue;

    // Try multiple namespace prefixes since they vary between Word versions
    const paraId =
      getAttribute(child, 'w16cex', 'paraId') ??
      getAttribute(child, 'w15', 'paraId') ??
      child.attributes?.['w16cex:paraId'] ??
      child.attributes?.['w15:paraId'];

    const dateUtc =
      getAttribute(child, 'w16cex', 'dateUtc') ??
      getAttribute(child, 'w15', 'dateUtc') ??
      child.attributes?.['w16cex:dateUtc'] ??
      child.attributes?.['w15:dateUtc'];

    if (paraId && dateUtc) {
      dateUtcByParaId.set(String(paraId).toUpperCase(), String(dateUtc));
    }
  }

  return dateUtcByParaId;
}

/**
 * Parse commentsExtended.xml (w15:commentsEx) for reply threading.
 * Returns a map of paraId → paraIdParent.
 */
function parseCommentsExtended(xml: string): {
  parentByParaId: Map<string, string>;
  doneByParaId: Map<string, boolean>;
} {
  const parentByParaId = new Map<string, string>();
  const doneByParaId = new Map<string, boolean>();

  const root = parseXml(xml);
  if (!root) return { parentByParaId, doneByParaId };

  const container = findChild(root, 'w15', 'commentsEx') ?? root;
  for (const child of getChildElements(container)) {
    const localName = child.name?.replace(/^.*:/, '') ?? '';
    if (localName !== 'commentEx') continue;

    const paraId = getAttribute(child, 'w15', 'paraId') ?? child.attributes?.['w15:paraId'];
    const paraIdParent =
      getAttribute(child, 'w15', 'paraIdParent') ?? child.attributes?.['w15:paraIdParent'];
    const done = getAttribute(child, 'w15', 'done') ?? child.attributes?.['w15:done'];

    if (paraId) {
      const pid = String(paraId).toUpperCase();
      if (paraIdParent) {
        parentByParaId.set(pid, String(paraIdParent).toUpperCase());
      }
      if (done === '1') {
        doneByParaId.set(pid, true);
      }
    }
  }

  return { parentByParaId, doneByParaId };
}

/**
 * Parse comments.xml into an array of Comment objects.
 *
 * If commentsExtensibleXml is provided, UTC timestamps are cross-referenced
 * via paraId and preferred over the ambiguous w:date local time.
 *
 * If commentsExtendedXml is provided, reply threading (paraIdParent) and
 * resolved state (done) are cross-referenced via paraId.
 */
export function parseComments(
  commentsXml: string | null,
  styles: StyleMap | null,
  theme: Theme | null,
  rels: RelationshipMap,
  media: Map<string, MediaFile>,
  commentsExtensibleXml?: string | null,
  commentsExtendedXml?: string | null
): Comment[] {
  if (!commentsXml) return [];

  const root = parseXml(commentsXml);
  if (!root) return [];

  // Build UTC date lookup from commentsExtensible.xml (if available)
  const dateUtcByParaId = commentsExtensibleXml
    ? parseCommentsExtensible(commentsExtensibleXml)
    : new Map<string, string>();

  // Build threading lookup from commentsExtended.xml (if available)
  const extended = commentsExtendedXml ? parseCommentsExtended(commentsExtendedXml) : null;

  const commentsEl = findChild(root, 'w', 'comments') ?? root;
  const children = getChildElements(commentsEl);
  const comments: Comment[] = [];
  // Track each comment's last paragraph paraId for threading resolution
  const lastParaIdByCommentIdx: string[] = [];

  for (const child of children) {
    const localName = child.name?.replace(/^.*:/, '') ?? '';
    if (localName !== 'comment') continue;

    const id = parseInt(getAttribute(child, 'w', 'id') ?? '0', 10);
    const author = getAttribute(child, 'w', 'author') ?? 'Unknown';
    const rawInitials = getAttribute(child, 'w', 'initials');
    const initials = rawInitials != null ? String(rawInitials) : undefined;
    const rawDate = getAttribute(child, 'w', 'date');
    const localDate = rawDate != null ? String(rawDate) : undefined;

    // Try to find the UTC date from commentsExtensible.xml via paraId
    const paraId =
      getAttribute(child, 'w14', 'paraId') ??
      child.attributes?.['w14:paraId'] ??
      getAttribute(child, 'w', 'paraId');
    const dateUtc = paraId ? dateUtcByParaId.get(String(paraId).toUpperCase()) : undefined;

    // Prefer UTC date over ambiguous local date
    const date = dateUtc ?? localDate;

    // Parse w:done attribute (resolved/done state)
    const rawDone = getAttribute(child, 'w', 'done') ?? child.attributes?.['w:done'];
    let done = rawDone === '1' || rawDone === 'true' ? true : undefined;

    // Parse parent comment ID for replies (w16cid:parentId on w:comment)
    const rawParentId =
      getAttribute(child, 'w16cid', 'parentId') ??
      getAttribute(child, 'w', 'parentId') ??
      child.attributes?.['w16cid:parentId'] ??
      child.attributes?.['w:parentId'];
    const parentId = rawParentId != null ? parseInt(String(rawParentId), 10) : undefined;

    // Parse comment content (paragraphs) and track the last paragraph's paraId
    const paragraphs: Paragraph[] = [];
    let lastParagraphParaId = '';
    for (const contentChild of getChildElements(child)) {
      const contentName = contentChild.name?.replace(/^.*:/, '') ?? '';
      if (contentName === 'p') {
        const paragraph = parseParagraph(contentChild, styles, theme, null, rels, media);
        paragraphs.push(paragraph);
        // Get w14:paraId from the paragraph element
        const pParaId =
          getAttribute(contentChild, 'w14', 'paraId') ?? contentChild.attributes?.['w14:paraId'];
        if (pParaId) lastParagraphParaId = String(pParaId).toUpperCase();
      }
    }

    // Cross-reference done state from commentsExtended.xml
    if (done == null && extended && lastParagraphParaId) {
      const extDone = extended.doneByParaId.get(lastParagraphParaId);
      if (extDone) done = true;
    }

    lastParaIdByCommentIdx.push(lastParagraphParaId);

    comments.push({
      id,
      author,
      initials,
      date,
      content: paragraphs,
      ...(done != null ? { done } : {}),
      ...(parentId != null && !isNaN(parentId) ? { parentId } : {}),
    });
  }

  // Resolve reply threading from commentsExtended.xml (w15:paraIdParent)
  // Word stores threading here, not as w16cid:parentId on w:comment
  if (extended && extended.parentByParaId.size > 0) {
    // Build reverse lookup: paraId → comment id
    const commentIdByParaId = new Map<string, number>();
    for (let i = 0; i < comments.length; i++) {
      const pid = lastParaIdByCommentIdx[i];
      if (pid) commentIdByParaId.set(pid, comments[i].id);
    }

    for (let i = 0; i < comments.length; i++) {
      if (comments[i].parentId != null) continue; // already has parentId
      const pid = lastParaIdByCommentIdx[i];
      if (!pid) continue;
      const parentParaId = extended.parentByParaId.get(pid);
      if (!parentParaId) continue;
      const parentCommentId = commentIdByParaId.get(parentParaId);
      if (parentCommentId != null) {
        comments[i] = { ...comments[i], parentId: parentCommentId };
      }
    }
  }

  return comments;
}
