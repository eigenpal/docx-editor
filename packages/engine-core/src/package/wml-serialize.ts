// WordprocessingML leaf serializers (document-engine task 2.10). Regenerate a single
// block's XML from the authored model. Attacker-derived text is XML-escaped. These are
// intentionally minimal (only the modeled run content); a caller that needs byte-faithful
// output uses verbatim preservation instead and only regenerates fully-captured blocks.

import { escapeXml } from './sinks.ts';
import { type Block, type ParagraphRecord, type RunRecord } from '../model/index.ts';

function runXml(run: RunRecord): string {
  const props = run.props;
  const rPr =
    props?.bold || props?.italic
      ? `<w:rPr>${props.bold ? '<w:b/>' : ''}${props.italic ? '<w:i/>' : ''}</w:rPr>`
      : '';
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(run.text)}</w:t></w:r>`;
}

export function paragraphXml(p: ParagraphRecord): string {
  return `<w:p>${p.runs.map(runXml).join('')}</w:p>`;
}

/** Regenerate one block's XML. Only paragraphs are regenerated; a TABLE or block-level
 *  SDT (content control) cannot be regenerated faithfully from the coarse model (grid,
 *  borders, w14/w15 control payload would be lost), so it fails closed — its verbatim
 *  preservation range is the only byte-faithful source and is reused while unchanged. */
export function blockXml(block: Block): string {
  if (block.kind === 'paragraph') return paragraphXml(block);
  throw new Error('table/SDT regeneration is not implemented: byte-faithful output requires the verbatim preservation range');
}
