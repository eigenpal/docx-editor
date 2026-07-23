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

/** Regenerate one block's XML. Paragraphs are supported; a TABLE cannot be regenerated
 *  yet, so an edited table/cell fails closed (its verbatim range is only reused while
 *  unchanged). */
export function blockXml(block: Block): string {
  if (block.kind === 'paragraph') return paragraphXml(block);
  throw new Error('table/cell editing must fail closed: table regeneration is not implemented (fidelity slice 1)');
}
