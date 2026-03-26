/**
 * Comment Serializer
 *
 * Serializes Comment[] to OOXML comments.xml and commentsExtended.xml.
 *
 * comments.xml: the main comment content (w:comment elements)
 * commentsExtended.xml: reply threading via w15:commentEx with paraId/paraIdParent
 *
 * Each comment paragraph gets a w14:paraId. The last paragraph's paraId is used
 * in commentsExtended.xml to link replies to parents via w15:paraIdParent.
 */

import type { Comment, Paragraph, Run } from '../../types/content';
import { escapeXml } from './xmlUtils';

/** Create a per-invocation paraId generator (avoids shared mutable module state) */
function createParaIdGenerator(): () => string {
  let counter = 0;
  const timeSeed = Date.now() & 0xffff;
  return () => {
    const id = ((timeSeed << 16) | (++counter & 0xffff)) >>> 0;
    return id.toString(16).toUpperCase().padStart(8, '0');
  };
}

function serializeRunContent(run: Run): string {
  let xml = '<w:r>';
  // Run properties (minimal — just preserve formatting basics)
  const rPr: string[] = [];
  if (run.formatting?.bold) rPr.push('<w:b/>');
  if (run.formatting?.italic) rPr.push('<w:i/>');
  if (rPr.length > 0) xml += `<w:rPr>${rPr.join('')}</w:rPr>`;

  for (const c of run.content) {
    if (c.type === 'text') {
      const preserveSpace = c.text !== c.text.trim() || c.text.includes('  ');
      xml += preserveSpace
        ? `<w:t xml:space="preserve">${escapeXml(c.text)}</w:t>`
        : `<w:t>${escapeXml(c.text)}</w:t>`;
    } else if (c.type === 'break') {
      xml += '<w:br/>';
    }
  }
  xml += '</w:r>';
  return xml;
}

function serializeParagraph(p: Paragraph, paraId: string): string {
  let xml = `<w:p w14:paraId="${paraId}" w14:textId="77777777">`;
  for (const item of p.content) {
    if (item.type === 'run') {
      xml += serializeRunContent(item);
    }
  }
  xml += '</w:p>';
  return xml;
}

/** Serialize a paragraph, prepending an annotationRef run (required by Word in first paragraph of a comment) */
function serializeParagraphWithAnnotationRef(p: Paragraph, paraId: string): string {
  let xml = `<w:p w14:paraId="${paraId}" w14:textId="77777777">`;
  xml += '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>';
  for (const item of p.content) {
    if (item.type === 'run') {
      xml += serializeRunContent(item);
    }
  }
  xml += '</w:p>';
  return xml;
}

interface CommentParaInfo {
  commentId: number;
  lastParaId: string;
  parentId?: number;
  done?: boolean;
}

function serializeComment(
  comment: Comment,
  paraInfos: CommentParaInfo[],
  generateParaId: () => string
): string {
  const attrs: string[] = [`w:id="${comment.id}"`];
  if (comment.author) attrs.push(`w:author="${escapeXml(comment.author)}"`);
  if (comment.initials) attrs.push(`w:initials="${escapeXml(comment.initials)}"`);
  if (comment.date) attrs.push(`w:date="${escapeXml(comment.date)}"`);
  if (comment.done) attrs.push('w:done="1"');
  if (comment.parentId != null) attrs.push(`w16cid:parentId="${comment.parentId}"`);

  let xml = `<w:comment ${attrs.join(' ')}>`;
  let lastParaId = '';

  if (comment.content && comment.content.length > 0) {
    // First paragraph must contain an annotationRef run for Word to link the comment
    const firstParaId = comment.content[0].paraId || generateParaId();
    xml += serializeParagraphWithAnnotationRef(comment.content[0], firstParaId);
    lastParaId = firstParaId;

    for (let i = 1; i < comment.content.length; i++) {
      const pid = comment.content[i].paraId || generateParaId();
      xml += serializeParagraph(comment.content[i], pid);
      lastParaId = pid;
    }
  } else {
    // Empty comment — still needs a paragraph with annotationRef
    lastParaId = generateParaId();
    xml += `<w:p w14:paraId="${lastParaId}" w14:textId="77777777"><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r></w:p>`;
  }
  xml += '</w:comment>';

  // Track para info for commentsExtended.xml
  paraInfos.push({
    commentId: comment.id,
    lastParaId,
    parentId: comment.parentId,
    done: comment.done,
  });

  return xml;
}

/**
 * Serialize comments array to comments.xml content.
 * Also returns para info needed for commentsExtended.xml.
 */
export function serializeCommentsWithInfo(comments: Comment[]): {
  xml: string;
  paraInfos: CommentParaInfo[];
} {
  if (!comments || comments.length === 0) return { xml: '', paraInfos: [] };

  const generateParaId = createParaIdGenerator();

  // Separate top-level comments and replies in a single pass
  const topLevel: Comment[] = [];
  const replies: Comment[] = [];
  for (const c of comments) {
    (c.parentId == null ? topLevel : replies).push(c);
  }

  const paraInfos: CommentParaInfo[] = [];

  let xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:comments xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" ' +
    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
    'xmlns:o="urn:schemas-microsoft-com:office:office" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ' +
    'xmlns:v="urn:schemas-microsoft-com:vml" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:w10="urn:schemas-microsoft-com:office:word" ' +
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ' +
    'xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" ' +
    'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" ' +
    'xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" ' +
    'xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" ' +
    'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
    'xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid" ' +
    'mc:Ignorable="w14 w15 wp14 w16cid">';

  // Serialize top-level comments first, then replies
  for (const comment of topLevel) {
    xml += serializeComment(comment, paraInfos, generateParaId);
  }
  for (const reply of replies) {
    xml += serializeComment(reply, paraInfos, generateParaId);
  }

  xml += '</w:comments>';
  return { xml, paraInfos };
}

/**
 * Serialize comments array to comments.xml content (backwards-compatible wrapper)
 */
export function serializeComments(comments: Comment[]): string {
  return serializeCommentsWithInfo(comments).xml;
}

/**
 * Serialize commentsExtended.xml (w15:commentsEx) for reply threading.
 *
 * This file tells Word/Google Docs which comments are replies (via paraIdParent)
 * and which are resolved (via done). Without it, replies show as separate comments.
 */
export function serializeCommentsExtended(paraInfos: CommentParaInfo[]): string {
  if (paraInfos.length === 0) return '';

  // Build a lookup: commentId → lastParaId (for resolving parentId → paraIdParent)
  const paraIdByCommentId = new Map<number, string>();
  for (const info of paraInfos) {
    paraIdByCommentId.set(info.commentId, info.lastParaId);
  }

  let xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" ' +
    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
    'mc:Ignorable="w15">';

  for (const info of paraInfos) {
    const attrs: string[] = [`w15:paraId="${info.lastParaId}"`];

    // Link reply to parent via paraIdParent
    if (info.parentId != null) {
      const parentParaId = paraIdByCommentId.get(info.parentId);
      if (parentParaId) {
        attrs.push(`w15:paraIdParent="${parentParaId}"`);
      }
    }

    // Resolved state
    attrs.push(`w15:done="${info.done ? '1' : '0'}"`);

    xml += `<w15:commentEx ${attrs.join(' ')}/>`;
  }

  xml += '</w15:commentsEx>';
  return xml;
}

/**
 * Serialize commentsIds.xml (w16cid:commentsIds) for stable comment IDs.
 *
 * Word Online needs this to associate replies with parent comments.
 * Each comment gets a durableId derived from its paraId.
 */
export function serializeCommentsIds(paraInfos: CommentParaInfo[]): string {
  if (paraInfos.length === 0) return '';

  let xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w16cid:commentsIds xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid" ' +
    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
    'mc:Ignorable="w16cid">';

  for (const info of paraInfos) {
    // durableId must differ from paraId — XOR with a constant to derive a distinct stable ID
    const paraNum = parseInt(info.lastParaId, 16) >>> 0;
    const durableId = ((paraNum ^ 0x5a5a5a5a) >>> 0).toString(16).toUpperCase().padStart(8, '0');
    xml += `<w16cid:commentId w16cid:paraId="${info.lastParaId}" w16cid:durableId="${durableId}"/>`;
  }

  xml += '</w16cid:commentsIds>';
  return xml;
}
