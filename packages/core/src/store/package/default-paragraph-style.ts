// The default paragraph style of a styles part: the style a paragraph without a usable
// `w:pStyle` takes. Layout, automation, the copy lanes, and the rendered-font index each walk
// `w:style` definitions their own way, and all of them resolve the default through this rule,
// so the page, the style reads, and the clipboard agree on it.
//
// 1. The last paragraph definition with `w:default` on (ECMA-376 Part 1 §17.7.4.17). A later
//    duplicate of that `w:styleId` without the flag keeps the id as the default; the duplicate
//    rule of the caller still decides which definition's properties apply.
//    §17.7.4.17: "If this attribute is specified by multiple styles, then the last instance of
//    a style with this property shall be used."
// 2. When no paragraph definition carries the flag, the last paragraph style whose `w:name` is
//    "Normal", compared trimmed and case-folded. A styles part can name its base style "Normal"
//    under any `w:styleId` and omit the flag.
//    This step departs from the specification on purpose. §17.7.4.17 says: "If this attribute
//    is not specified for any style, then no properties shall be applied to objects of the
//    specified style type." Styles parts in this state usually base their other paragraph
//    styles on the style named "Normal", and with no default they lay out with `w:docDefaults`
//    alone. Character and table styles keep the specification rule.
//
// Only a paragraph definition sets the flag, so a later duplicate of another type leaves it. The
// style chain then finds no paragraph style under the id, and paragraphs keep `w:docDefaults`.
// A definition whose `w:styleId` layout rejects (`isValidStyleId`) never counts.

import type { OoxmlElement } from './ooxml-tree.ts';
import { validStyleId } from './run-defaults.ts';
import { isDangerousKey } from './safe-record.ts';

/**
 * The `w:style` children a reader without definitions of its own passes to the rule: the same
 * bound as layout's `MAX_STYLE_DEFINITIONS`, so it resolves the default the page paints.
 */
export const MAX_DEFAULT_STYLE_CANDIDATES = 4096;

/** What the rule reads from one `w:style` definition. */
export interface DefaultParagraphStyleCandidate {
  readonly styleId: string;
  /** The `w:type`, or an empty string where the definition states none. */
  readonly type: string;
  /** The `w:val` of the first `w:name`, or null/undefined where there is none. */
  readonly name?: string | null;
  /** Whether `w:default` is on. */
  readonly isDefault: boolean;
}

/**
 * The longest `w:name` the rule compares. Callers keep names up to different caps; a longer
 * name never counts, so every caller reaches the same answer.
 */
const MAX_COMPARED_NAME = 128;

/** Whether a `w:name` value names the base paragraph style "Normal". */
export function isNormalStyleName(name: string | null | undefined): boolean {
  return (
    typeof name === 'string' &&
    name.length <= MAX_COMPARED_NAME &&
    name.trim().toLowerCase() === 'normal'
  );
}

/**
 * The default paragraph style id, from every definition in document order, duplicates
 * included, or null where the part has none. Callers bound the walk themselves.
 */
export function defaultParagraphStyleIdOf(
  definitions: Iterable<DefaultParagraphStyleCandidate>
): string | null {
  let flagged: string | null = null;
  // The last definition of each id, which is the one that wins a duplicate id.
  const last = new Map<
    string,
    { readonly type: string; readonly normal: boolean; order: number }
  >();
  let order = 0;
  for (const definition of definitions) {
    const { styleId } = definition;
    if (validStyleId(styleId) === null || isDangerousKey(styleId)) continue;
    if (definition.type === 'paragraph' && definition.isDefault) flagged = styleId;
    last.set(styleId, {
      type: definition.type,
      normal: isNormalStyleName(definition.name),
      order,
    });
    order += 1;
  }
  if (flagged !== null) return flagged;
  let named: string | null = null;
  let namedOrder = -1;
  for (const [styleId, entry] of last) {
    if (entry.type !== 'paragraph' || !entry.normal || entry.order < namedOrder) continue;
    named = styleId;
    namedOrder = entry.order;
  }
  return named;
}

function attributeOf(element: OoxmlElement, localName: string): string | undefined {
  return element.attributes.find((attribute) => attribute.localName === localName)?.value;
}

/** Whether a `w:default` value is on: `ST_OnOff` has three on-spellings. */
function isOn(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'on';
}

/**
 * What the rule reads from one `w:style` element, or null where it has no `w:styleId`. For
 * readers that keep no style definitions of their own.
 */
export function defaultParagraphStyleCandidateOf(
  style: OoxmlElement
): DefaultParagraphStyleCandidate | null {
  const styleId = attributeOf(style, 'styleId');
  if (!styleId) return null;
  let name: string | undefined;
  for (const child of style.children) {
    if (child.kind === 'textValue' || child.localName !== 'name') continue;
    name = attributeOf(child, 'val');
    break;
  }
  return {
    styleId,
    type: attributeOf(style, 'type') ?? '',
    name,
    isDefault: isOn(attributeOf(style, 'default')),
  };
}

/** The default paragraph style id of `w:style` elements in document order, or null. */
export function defaultParagraphStyleIdOfElements(styles: Iterable<OoxmlElement>): string | null {
  const candidates: DefaultParagraphStyleCandidate[] = [];
  for (const style of styles) {
    const candidate = defaultParagraphStyleCandidateOf(style);
    if (candidate) candidates.push(candidate);
  }
  return defaultParagraphStyleIdOf(candidates);
}
