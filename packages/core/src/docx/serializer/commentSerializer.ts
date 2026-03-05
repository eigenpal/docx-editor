/**
 * Comment Serializer
 *
 * Serializes Comment[] to OOXML comments.xml format.
 */

import type { Comment, Paragraph, Run } from '../../types/content';

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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

function serializeParagraph(p: Paragraph): string {
  let xml = '<w:p>';
  for (const item of p.content) {
    if (item.type === 'run') {
      xml += serializeRunContent(item);
    }
  }
  xml += '</w:p>';
  return xml;
}

/** Serialize a paragraph, prepending an annotationRef run (required by Word in first paragraph of a comment) */
function serializeParagraphWithAnnotationRef(p: Paragraph): string {
  let xml = '<w:p>';
  xml += '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>';
  for (const item of p.content) {
    if (item.type === 'run') {
      xml += serializeRunContent(item);
    }
  }
  xml += '</w:p>';
  return xml;
}

function serializeComment(comment: Comment): string {
  const attrs: string[] = [`w:id="${comment.id}"`];
  if (comment.author) attrs.push(`w:author="${escapeXml(comment.author)}"`);
  if (comment.initials) attrs.push(`w:initials="${escapeXml(comment.initials)}"`);
  if (comment.date) attrs.push(`w:date="${escapeXml(comment.date)}"`);

  let xml = `<w:comment ${attrs.join(' ')}>`;
  if (comment.content && comment.content.length > 0) {
    // First paragraph must contain an annotationRef run for Word to link the comment
    xml += serializeParagraphWithAnnotationRef(comment.content[0]);
    for (let i = 1; i < comment.content.length; i++) {
      xml += serializeParagraph(comment.content[i]);
    }
  } else {
    // Empty comment — still needs a paragraph with annotationRef
    xml +=
      '<w:p><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r></w:p>';
  }
  xml += '</w:comment>';
  return xml;
}

/**
 * Serialize comments array to comments.xml content
 */
export function serializeComments(comments: Comment[]): string {
  if (!comments || comments.length === 0) return '';

  // Separate top-level comments and replies
  const topLevel = comments.filter((c) => c.parentId == null);
  const replies = comments.filter((c) => c.parentId != null);

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
    'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" ' +
    'xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" ' +
    'xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" ' +
    'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
    'mc:Ignorable="w14 wp14">';

  // Serialize top-level comments first, then replies
  for (const comment of topLevel) {
    xml += serializeComment(comment);
  }
  for (const reply of replies) {
    xml += serializeComment(reply);
  }

  xml += '</w:comments>';
  return xml;
}
