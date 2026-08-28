// The numbering part the external-HTML projection assembles for its lists — split from
// clipboard-html-read.ts at the max-lines cap. Same shape the store's numbering writer
// produces; the projection allocates the numIds and this module renders the definitions.

import { escapeXmlAttribute } from '../store/package/sinks.ts';

const WML_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

export type HtmlListAllocation = { readonly numId: string; readonly kind: 'ordered' | 'bullet' };

// Symbol-font codepoints Word writes (private-use range), as escapes so they are not
// invisible literals in the source; see store/package/numbering-part.ts.
const BULLET_LEVELS = [
  { text: '\uF0B7', font: 'Symbol' },
  { text: 'o', font: 'Courier New' },
  { text: '\uF0A7', font: 'Wingdings' },
] as const;

/** One `w:lvl` in strict CT_Lvl order: start, numFmt, lvlText, lvlJc, pPr, rPr. */
function levelXml(kind: 'ordered' | 'bullet', ilvl: number): string {
  const left = 720 * (ilvl + 1);
  const indent = `<w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr>`;
  if (kind === 'bullet') {
    const bullet = BULLET_LEVELS[ilvl % BULLET_LEVELS.length]!;
    return (
      `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="bullet"/>` +
      `<w:lvlText w:val="${escapeXmlAttribute(bullet.text)}"/><w:lvlJc w:val="left"/>${indent}` +
      `<w:rPr><w:rFonts w:ascii="${bullet.font}" w:hAnsi="${bullet.font}" w:hint="default"/></w:rPr>` +
      '</w:lvl>'
    );
  }
  return (
    `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="decimal"/>` +
    `<w:lvlText w:val="%${ilvl + 1}."/><w:lvlJc w:val="left"/>${indent}</w:lvl>`
  );
}

export function numberingPartXml(allocations: readonly HtmlListAllocation[]): string {
  const abstracts = allocations
    .map((allocation, index) => {
      const levels = Array.from({ length: 9 }, (_, ilvl) => levelXml(allocation.kind, ilvl)).join(
        ''
      );
      return (
        `<w:abstractNum w:abstractNumId="${index}">` +
        `<w:multiLevelType w:val="hybridMultilevel"/>${levels}</w:abstractNum>`
      );
    })
    .join('');
  const nums = allocations
    .map(
      (allocation, index) =>
        `<w:num w:numId="${allocation.numId}"><w:abstractNumId w:val="${index}"/></w:num>`
    )
    .join('');
  return `${XML_DECL}<w:numbering xmlns:w="${WML_NS}">${abstracts}${nums}</w:numbering>`;
}
