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

/** Same 0..9999 clamp the layout lane's numbering index applies to `w:start`. */
function boundedStart(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d{1,5}$/.test(raw)) return null;
  return Math.min(Math.max(Number.parseInt(raw, 10), 0), 9_999);
}

/** Canonical decimal key for a file-supplied `w:ilvl` ('03' and '3' are one level). */
function canonicalIlvl(raw: string | undefined): string | null {
  if (raw === undefined || !/^\d{1,2}$/.test(raw)) return null;
  return String(Number.parseInt(raw, 10));
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

  // Separate budgets, like layout/numbering-index.ts: unrelated children are free,
  // and a template heavy in abstractNum cannot starve the w:num mapping.
  let abstractLeft = MAX_NUMBERING_DEFINITIONS;
  let numLeft = MAX_NUMBERING_DEFINITIONS;
  for (const child of root.children) {
    if (!isElement(child) || child.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (child.localName === 'num') {
      if (numLeft <= 0) continue;
      numLeft -= 1;
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
        const ilvl = canonicalIlvl(attributeValueOf(override, 'ilvl', WML_NAMESPACE_URI));
        if (ilvl === null) continue;
        const start = boundedStart(wmlVal(wmlChild(override, 'startOverride')));
        if (start !== null) startOverrides.set(`${numId}:${ilvl}`, start);
        // A replacement `w:lvl` inside the override carries its own format/start —
        // but per ECMA-376 §17.9.11 an explicit `w:startOverride` outranks the
        // replacement level's `w:start`, so it never overwrites one already stored.
        const replacement = wmlChild(override, 'lvl');
        if (replacement !== null) {
          const format = wmlVal(wmlChild(replacement, 'numFmt'));
          if (format !== undefined) formatOverrides.set(`${numId}:${ilvl}`, format);
          if (start === null) {
            const replacementStart = boundedStart(wmlVal(wmlChild(replacement, 'start')));
            if (replacementStart !== null) startOverrides.set(`${numId}:${ilvl}`, replacementStart);
          }
        }
      }
      continue;
    }
    if (child.localName !== 'abstractNum') continue;
    if (abstractLeft <= 0) continue;
    abstractLeft -= 1;
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
      const ilvl = canonicalIlvl(attributeValueOf(level, 'ilvl', WML_NAMESPACE_URI));
      if (ilvl === null) continue;
      const format = wmlVal(wmlChild(level, 'numFmt'));
      const start = boundedStart(wmlVal(wmlChild(level, 'start')));
      // First definition of a duplicated level wins, like the layout index.
      if (format !== undefined && !formats.has(ilvl)) formats.set(ilvl, format);
      if (start !== null && !starts.has(ilvl)) starts.set(ilvl, start);
    }
    levelFormats.set(abstractId, formats);
    levelStarts.set(abstractId, starts);
  }
  return { numToAbstract, levelFormats, levelStarts, startOverrides, formatOverrides, styleLinks };
}
