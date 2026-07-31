// Bounded projection of `/word/numbering.xml` for semantic list layout.
//
// Projection only — never mutation or serialization authority. Hostile values are dropped
// or clamped; missing definitions resolve to "no list" rather than guessing.

import type {
  OoxmlElement,
  OoxmlNode,
  OoxmlProperty,
} from '@docx-editor.dev/core-contract/store';
import { WML_NAMESPACE_URI } from '@docx-editor.dev/core-contract/store';
import { propertiesOfRunContainer } from './field-projection.ts';

/** Soft ceiling on abstractNum / num entries read from one part. */
export const MAX_NUMBERING_DEFINITIONS = 512;

/** Soft ceiling on override entries per `w:num`. */
export const MAX_LVL_OVERRIDES = 9;

/** Maximum hanging / indent from a level, in points (≈22"). */
export const MAX_LEVEL_INDENT_PT = 31_680 / 20;

export type ListSuffix = 'tab' | 'space' | 'nothing';
export type ListMarkerAlign = 'left' | 'center' | 'right';

export interface NumberingLevelIndent {
  readonly left: number;
  readonly right: number;
  readonly hanging: number;
  readonly firstLine: number;
}

export interface NumberingLevel {
  readonly ilvl: number;
  readonly start: number;
  readonly numFmt: string;
  readonly lvlText: string;
  readonly lvlJc: ListMarkerAlign;
  readonly suff: ListSuffix;
  readonly indent: NumberingLevelIndent;
  /** Level `w:rPr` as flat properties (for marker face / vanish). */
  readonly runProperties: readonly OoxmlProperty[];
  /** True when level run props request vanish — marker must not paint. */
  readonly vanish: boolean;
}

export interface LevelOverride {
  readonly startOverride?: number;
  /** Full level replacement when `w:lvl` is present under the override. */
  readonly level?: NumberingLevel;
}

export interface AbstractNumDefinition {
  readonly abstractNumId: string;
  readonly levels: ReadonlyMap<number, NumberingLevel>;
}

export interface NumDefinition {
  readonly numId: string;
  readonly abstractNumId: string;
  readonly overrides: ReadonlyMap<number, LevelOverride>;
}

export interface NumberingIndex {
  readonly abstractNums: ReadonlyMap<string, AbstractNumDefinition>;
  readonly nums: ReadonlyMap<string, NumDefinition>;
}

function isWml(node: OoxmlNode, localName: string): node is OoxmlElement {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === localName
  );
}

function attr(element: OoxmlElement, localName: string): string | undefined {
  for (const a of element.attributes) {
    if (a.localName === localName) return a.value;
  }
  return undefined;
}

function child(element: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const c of element.children) {
    if (isWml(c, localName)) return c;
  }
  return undefined;
}

function integerAttr(raw: string | undefined, allowNegative = false): number | null {
  if (raw === undefined) return null;
  if (!(allowNegative ? /^-?\d{1,9}$/ : /^\d{1,9}$/).test(raw)) return null;
  return Number(raw);
}

function clampNonNegativePt(twips: number): number {
  const pt = twips / 20;
  if (!Number.isFinite(pt) || pt <= 0) return 0;
  return pt > MAX_LEVEL_INDENT_PT ? MAX_LEVEL_INDENT_PT : pt;
}

function parseIndent(pPr: OoxmlElement | undefined): NumberingLevelIndent {
  const empty = { left: 0, right: 0, hanging: 0, firstLine: 0 };
  if (!pPr) return empty;
  const ind = child(pPr, 'ind');
  if (!ind) return empty;
  const leftTwips = integerAttr(attr(ind, 'left') ?? attr(ind, 'start'), true);
  const rightTwips = integerAttr(attr(ind, 'right') ?? attr(ind, 'end'), true);
  const hangingTwips = integerAttr(attr(ind, 'hanging'));
  const firstLineTwips = integerAttr(attr(ind, 'firstLine'), true);
  return {
    left: leftTwips === null ? 0 : clampNonNegativePt(Math.max(0, leftTwips)),
    right: rightTwips === null ? 0 : clampNonNegativePt(Math.max(0, rightTwips)),
    hanging: hangingTwips === null ? 0 : clampNonNegativePt(hangingTwips),
    firstLine: firstLineTwips === null ? 0 : clampNonNegativePt(Math.max(0, firstLineTwips)),
  };
}

function parseSuffix(raw: string | undefined): ListSuffix {
  if (raw === 'space') return 'space';
  if (raw === 'nothing') return 'nothing';
  return 'tab';
}

function parseAlign(raw: string | undefined): ListMarkerAlign {
  if (raw === 'center') return 'center';
  if (raw === 'right' || raw === 'end') return 'right';
  return 'left';
}

function toggleOn(props: readonly OoxmlProperty[], localName: string): boolean {
  for (const property of props) {
    if (property.localName !== localName) continue;
    const val = property.attributes?.val;
    if (val === '0' || val === 'false') return false;
    return true;
  }
  return false;
}

function parseLevel(lvl: OoxmlElement): NumberingLevel | null {
  const ilvlRaw = integerAttr(attr(lvl, 'ilvl'));
  if (ilvlRaw === null || ilvlRaw < 0 || ilvlRaw > 8) return null;

  const startNode = child(lvl, 'start');
  let startVal = 1;
  if (startNode) {
    const parsed = integerAttr(attr(startNode, 'val'));
    if (parsed !== null && parsed >= 0) startVal = Math.min(parsed, 9999) || 1;
  }

  const numFmtNode = child(lvl, 'numFmt');
  const numFmtVal = (numFmtNode ? attr(numFmtNode, 'val') : undefined) ?? 'decimal';

  const lvlTextNode = child(lvl, 'lvlText');
  const lvlText = lvlTextNode ? (attr(lvlTextNode, 'val') ?? '') : '';

  const lvlJcNode = child(lvl, 'lvlJc');
  const lvlJc = parseAlign(lvlJcNode ? attr(lvlJcNode, 'val') : undefined);

  const suffNode = child(lvl, 'suff');
  const suff = parseSuffix(suffNode ? attr(suffNode, 'val') : undefined);

  const pPr = child(lvl, 'pPr');
  const rPr = child(lvl, 'rPr');
  const runProperties = rPr ? propertiesOfRunContainer(rPr) : [];

  return {
    ilvl: ilvlRaw,
    start: startVal,
    numFmt: numFmtVal.length > 64 ? 'decimal' : numFmtVal,
    lvlText: lvlText.length > 64 ? lvlText.slice(0, 64) : lvlText,
    lvlJc,
    suff,
    indent: parseIndent(pPr),
    runProperties,
    vanish: toggleOn(runProperties, 'vanish'),
  };
}

function parseAbstractNum(node: OoxmlElement): AbstractNumDefinition | null {
  const abstractNumId = attr(node, 'abstractNumId');
  if (abstractNumId === undefined || abstractNumId.length === 0 || abstractNumId.length > 64) {
    return null;
  }
  const levels = new Map<number, NumberingLevel>();
  for (const childNode of node.children) {
    if (!isWml(childNode, 'lvl')) continue;
    if (levels.size >= 9) break;
    const level = parseLevel(childNode);
    if (level && !levels.has(level.ilvl)) levels.set(level.ilvl, level);
  }
  return { abstractNumId, levels };
}

function parseOverride(node: OoxmlElement): { ilvl: number; override: LevelOverride } | null {
  const ilvl = integerAttr(attr(node, 'ilvl'));
  if (ilvl === null || ilvl < 0 || ilvl > 8) return null;
  const startNode = child(node, 'startOverride');
  let startOverride: number | undefined;
  if (startNode) {
    const parsed = integerAttr(attr(startNode, 'val'));
    if (parsed !== null && parsed >= 0) startOverride = Math.min(parsed, 9999) || 1;
  }
  const lvlNode = child(node, 'lvl');
  const level = lvlNode ? parseLevel(lvlNode) ?? undefined : undefined;
  if (startOverride === undefined && level === undefined) {
    return { ilvl, override: {} };
  }
  return {
    ilvl,
    override: {
      ...(startOverride !== undefined ? { startOverride } : {}),
      ...(level ? { level } : {}),
    },
  };
}

function parseNum(node: OoxmlElement): NumDefinition | null {
  const numId = attr(node, 'numId');
  if (numId === undefined || numId.length === 0 || numId.length > 64) return null;
  const absRef = child(node, 'abstractNumId');
  const abstractNumId = absRef ? attr(absRef, 'val') : undefined;
  if (!abstractNumId || abstractNumId.length > 64) return null;

  const overrides = new Map<number, LevelOverride>();
  for (const childNode of node.children) {
    if (!isWml(childNode, 'lvlOverride')) continue;
    if (overrides.size >= MAX_LVL_OVERRIDES) break;
    const parsed = parseOverride(childNode);
    if (parsed && !overrides.has(parsed.ilvl)) overrides.set(parsed.ilvl, parsed.override);
  }
  return { numId, abstractNumId, overrides };
}

/**
 * Build a numbering index from the root of a numbering part (`w:numbering`).
 *
 * Empty / missing roots yield an empty index. Duplicate ids keep the first definition.
 */
export function buildNumberingIndex(root: OoxmlElement | null | undefined): NumberingIndex {
  const abstractNums = new Map<string, AbstractNumDefinition>();
  const nums = new Map<string, NumDefinition>();
  if (!root) {
    return { abstractNums, nums };
  }

  let abstractCount = 0;
  let numCount = 0;
  for (const childNode of root.children) {
    if (isWml(childNode, 'abstractNum')) {
      if (abstractCount >= MAX_NUMBERING_DEFINITIONS) continue;
      abstractCount += 1;
      const def = parseAbstractNum(childNode);
      if (def && !abstractNums.has(def.abstractNumId)) {
        abstractNums.set(def.abstractNumId, def);
      }
      continue;
    }
    if (isWml(childNode, 'num')) {
      if (numCount >= MAX_NUMBERING_DEFINITIONS) continue;
      numCount += 1;
      const def = parseNum(childNode);
      if (def && !nums.has(def.numId)) nums.set(def.numId, def);
    }
  }

  return { abstractNums, nums };
}

/** Resolve the effective level for a `numId` + `ilvl`, applying overrides. */
export function resolveNumberingLevel(
  index: NumberingIndex,
  numId: string,
  ilvl: number
): {
  readonly abstractNumId: string;
  readonly level: NumberingLevel;
  readonly startOverride?: number;
} | null {
  if (ilvl < 0 || ilvl > 8) return null;
  const num = index.nums.get(numId);
  if (!num) return null;
  const abstract = index.abstractNums.get(num.abstractNumId);
  if (!abstract) return null;
  const override = num.overrides.get(ilvl);
  const level = override?.level ?? abstract.levels.get(ilvl);
  if (!level) return null;
  return {
    abstractNumId: num.abstractNumId,
    level,
    ...(override?.startOverride !== undefined
      ? { startOverride: override.startOverride }
      : {}),
  };
}

/** Empty index for tests / documents without numbering. */
export const EMPTY_NUMBERING_INDEX: NumberingIndex = Object.freeze({
  abstractNums: new Map(),
  nums: new Map(),
});
