import { escapeXmlAttribute } from '../store/package/sinks.ts';
import { strToU8, writeZip } from '../store/package/zip.ts';

const RELS_XMLNS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT_XMLNS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const RELS_CT = 'application/vnd.openxmlformats-package.relationships+xml';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const PART_TYPES: Readonly<Record<string, string>> = {
  document: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  numbering: 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml',
  footnotes: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml',
  endnotes: 'application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml',
};

export interface HtmlFragmentRel {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly external: boolean;
}

export interface HtmlFragmentPackageInput {
  readonly documentXml: string;
  readonly rels: readonly HtmlFragmentRel[];
  readonly numberingXml?: string;
  readonly footnotesXml?: string;
  readonly endnotesXml?: string;
  readonly media: ReadonlyMap<string, Uint8Array>;
  readonly mediaExtensions: ReadonlyMap<string, string>;
}

function relationshipXml(rels: readonly HtmlFragmentRel[]): string {
  const rows = rels
    .map(
      (rel) =>
        `<Relationship Id="${escapeXmlAttribute(rel.id)}" Type="${escapeXmlAttribute(rel.type)}" ` +
        `Target="${escapeXmlAttribute(rel.target)}"${rel.external ? ' TargetMode="External"' : ''}/>`
    )
    .join('');
  return `${XML_DECL}<Relationships xmlns="${RELS_XMLNS}">${rows}</Relationships>`;
}

export function writeHtmlFragmentPackage(input: HtmlFragmentPackageInput): Uint8Array {
  const entries = new Map<string, Uint8Array>();
  entries.set('word/document.xml', strToU8(input.documentXml));
  entries.set('word/_rels/document.xml.rels', strToU8(relationshipXml(input.rels)));
  entries.set(
    '_rels/.rels',
    strToU8(
      relationshipXml([
        {
          id: 'rId1',
          type: `${R_NS}/officeDocument`,
          target: 'word/document.xml',
          external: false,
        },
      ])
    )
  );
  const optionalParts = [
    ['numbering', input.numberingXml],
    ['footnotes', input.footnotesXml],
    ['endnotes', input.endnotesXml],
  ] as const;
  let overrides = `<Override PartName="/word/document.xml" ContentType="${PART_TYPES.document}"/>`;
  for (const [name, xml] of optionalParts) {
    if (xml === undefined) continue;
    entries.set(`word/${name}.xml`, strToU8(xml));
    overrides += `<Override PartName="/word/${name}.xml" ContentType="${PART_TYPES[name]}"/>`;
  }
  for (const [name, bytes] of input.media) entries.set(name, bytes);
  let defaults =
    `<Default Extension="rels" ContentType="${RELS_CT}"/>` +
    '<Default Extension="xml" ContentType="application/xml"/>';
  for (const [extension, contentType] of input.mediaExtensions) {
    defaults += `<Default Extension="${extension}" ContentType="${contentType}"/>`;
  }
  entries.set(
    '[Content_Types].xml',
    strToU8(`${XML_DECL}<Types xmlns="${CT_XMLNS}">${defaults}${overrides}</Types>`)
  );
  return writeZip(entries);
}
