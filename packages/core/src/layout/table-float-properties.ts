// Bounded positioning and text-distance properties for top-level floating tables.
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type {
  TableFloatAnchor,
  TableFloatPosition,
  TableFloatXSpec,
  TableFloatYSpec,
} from './semantic-table.ts';

function childNamed(node: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of node.children) {
    if (child.kind !== 'textValue' && child.localName === localName) return child;
  }
  return undefined;
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

/**
 * Ceiling on a `w:tblpX`/`w:tblpY` offset (~22"), matching the other bounded geometry
 * reads here. Both are signed, so the clamp is two-sided.
 */
const MAX_TABLE_FLOAT_OFFSET_PT = 31_680 / 20;

function readFloatAnchor(raw: string | undefined): TableFloatAnchor | undefined {
  if (raw === 'page') return 'page';
  if (raw === 'margin') return 'margin';
  if (raw === 'text') return 'text';
  return undefined;
}

function readSignedTwipsPt(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^-?\d{1,9}$/.test(raw)) return undefined;
  const twips = Number(raw);
  if (!Number.isFinite(twips)) return undefined;
  const pt = twips / 20;
  return Math.max(-MAX_TABLE_FLOAT_OFFSET_PT, Math.min(MAX_TABLE_FLOAT_OFFSET_PT, pt));
}

/**
 * Read `w:tblpPr`. Absent anchors default to `text` (17.4.58/17.4.66); an unrecognised
 * spec is dropped rather than guessed at, which leaves the offset to place the table.
 */
export function readTableFloatPosition(
  container: OoxmlElement | undefined
): TableFloatPosition | undefined {
  const tblpPr = container && childNamed(container, 'tblpPr');
  if (!tblpPr) return undefined;
  const rawXSpec = attributeValue(tblpPr, 'tblpXSpec');
  const xSpec: TableFloatXSpec | undefined =
    rawXSpec === 'left' ||
    rawXSpec === 'center' ||
    rawXSpec === 'right' ||
    rawXSpec === 'inside' ||
    rawXSpec === 'outside'
      ? rawXSpec
      : undefined;
  const rawYSpec = attributeValue(tblpPr, 'tblpYSpec');
  const ySpec: TableFloatYSpec | undefined =
    rawYSpec === 'inline' ||
    rawYSpec === 'top' ||
    rawYSpec === 'center' ||
    rawYSpec === 'bottom' ||
    rawYSpec === 'inside' ||
    rawYSpec === 'outside'
      ? rawYSpec
      : undefined;
  return {
    horzAnchor: readFloatAnchor(attributeValue(tblpPr, 'horzAnchor')) ?? 'text',
    vertAnchor: readFloatAnchor(attributeValue(tblpPr, 'vertAnchor')) ?? 'text',
    ...(xSpec ? { xSpec } : {}),
    xPt: readSignedTwipsPt(attributeValue(tblpPr, 'tblpX')) ?? 0,
    ...(ySpec ? { ySpec } : {}),
    yPt: readSignedTwipsPt(attributeValue(tblpPr, 'tblpY')) ?? 0,
    ...(['topFromText', 'rightFromText', 'bottomFromText', 'leftFromText'].some(
      (name) => attributeValue(tblpPr, name) !== undefined
    )
      ? {
          distances: {
            top: Math.max(0, readSignedTwipsPt(attributeValue(tblpPr, 'topFromText')) ?? 0),
            right: Math.max(0, readSignedTwipsPt(attributeValue(tblpPr, 'rightFromText')) ?? 0),
            bottom: Math.max(0, readSignedTwipsPt(attributeValue(tblpPr, 'bottomFromText')) ?? 0),
            left: Math.max(0, readSignedTwipsPt(attributeValue(tblpPr, 'leftFromText')) ?? 0),
          },
        }
      : {}),
  };
}
