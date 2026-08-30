import { WML_NAMESPACE_URI, type OoxmlElement } from '../store/package/ooxml-tree.ts';
import { attributeValueOf } from '../store/store/tree-op-nodes.ts';
import { MAX_NUMBERING_DEFINITIONS } from '../layout/numbering-index.ts';
import { isElement, wmlChild, wmlVal } from './clipboard-html-write-tree.ts';

export interface HtmlNumberingIndex {
  readonly numToAbstract: ReadonlyMap<string, string>;
  readonly levelFormats: ReadonlyMap<string, ReadonlyMap<string, string>>;
  readonly levelStarts: ReadonlyMap<string, ReadonlyMap<string, number>>;
  readonly startOverrides: ReadonlyMap<string, number>;
  /** `w:lvlOverride/w:lvl` replacement formats, keyed `numId:ilvl`. */
  readonly formatOverrides: ReadonlyMap<string, string>;
  /** `w:numStyleLink` per abstract id: the numbering style holding the real levels. */
  readonly styleLinks: ReadonlyMap<string, string>;
}

/** Same 9999 clamp the layout lane's numbering index applies to `w:start`. */
function boundedStart(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d{1,5}$/.test(raw)) return null;
  return Math.min(Math.max(Number.parseInt(raw, 10), 1), 9_999);
}

export function htmlNumberingIndexOf(root: OoxmlElement | null): HtmlNumberingIndex {
  const numToAbstract = new Map<string, string>();
  const levelFormats = new Map<string, Map<string, string>>();
  const levelStarts = new Map<string, Map<string, number>>();
  const startOverrides = new Map<string, number>();
  const formatOverrides = new Map<string, string>();
  const styleLinks = new Map<string, string>();
  if (!root) {
    return {
      numToAbstract,
      levelFormats,
      levelStarts,
      startOverrides,
      formatOverrides,
      styleLinks,
    };
  }

  let definitionsLeft = MAX_NUMBERING_DEFINITIONS;
  for (const child of root.children) {
    if (!isElement(child) || child.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (definitionsLeft <= 0) break;
    definitionsLeft -= 1;
    if (child.localName === 'num') {
      const numId = attributeValueOf(child, 'numId', WML_NAMESPACE_URI);
      const abstractId = wmlVal(wmlChild(child, 'abstractNumId'));
      if (numId && abstractId) numToAbstract.set(numId, abstractId);
      if (!numId) continue;
      for (const override of child.children) {
        if (
          !isElement(override) ||
          override.localName !== 'lvlOverride' ||
          override.namespaceUri !== WML_NAMESPACE_URI
        ) {
          continue;
        }
        const ilvl = attributeValueOf(override, 'ilvl', WML_NAMESPACE_URI);
        if (ilvl === undefined) continue;
        const start = boundedStart(wmlVal(wmlChild(override, 'startOverride')));
        if (start !== null) startOverrides.set(`${numId}:${ilvl}`, start);
        // A replacement `w:lvl` inside the override carries its own format/start.
        const replacement = wmlChild(override, 'lvl');
        if (replacement !== null) {
          const format = wmlVal(wmlChild(replacement, 'numFmt'));
          if (format !== undefined) formatOverrides.set(`${numId}:${ilvl}`, format);
          const replacementStart = boundedStart(wmlVal(wmlChild(replacement, 'start')));
          if (replacementStart !== null) startOverrides.set(`${numId}:${ilvl}`, replacementStart);
        }
      }
      continue;
    }
    if (child.localName !== 'abstractNum') continue;
    const abstractId = attributeValueOf(child, 'abstractNumId', WML_NAMESPACE_URI);
    if (!abstractId) continue;
    const styleLink = wmlVal(wmlChild(child, 'numStyleLink'));
    if (styleLink !== undefined) styleLinks.set(abstractId, styleLink);
    const formats = new Map<string, string>();
    const starts = new Map<string, number>();
    for (const level of child.children) {
      if (
        !isElement(level) ||
        level.localName !== 'lvl' ||
        level.namespaceUri !== WML_NAMESPACE_URI
      ) {
        continue;
      }
      const ilvl = attributeValueOf(level, 'ilvl', WML_NAMESPACE_URI);
      if (ilvl === undefined) continue;
      const format = wmlVal(wmlChild(level, 'numFmt'));
      const start = boundedStart(wmlVal(wmlChild(level, 'start')));
      if (format !== undefined) formats.set(ilvl, format);
      if (start !== null) starts.set(ilvl, start);
    }
    levelFormats.set(abstractId, formats);
    levelStarts.set(abstractId, starts);
  }
  return { numToAbstract, levelFormats, levelStarts, startOverrides, formatOverrides, styleLinks };
}
