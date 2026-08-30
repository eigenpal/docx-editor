// Bounded styles.xml definition parsing, kept separate from cascade resolution.

import type { OoxmlElement, OoxmlNode, OoxmlProperty } from '@docx-editor.dev/core/store';
import { isDangerousKey } from '../store/package/safe-record.ts';
import { styleOutlineLevel } from '../store/package/style-outline.ts';
import { propertiesOf } from './paragraph-flow.ts';

const STYLE_ID_MAX = 128;
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;
const MAX_CONDITIONAL_TABLE_FORMATS = 32;

export interface StyleDefinition {
  readonly styleId: string;
  readonly type: string;
  readonly basedOn: string | null;
  /** `w:next` — the authoring style for a following paragraph. */
  readonly next: string | null;
  readonly outlineLevel: number | null;
  readonly paragraphProperties: readonly OoxmlProperty[];
  readonly runProperties: readonly OoxmlProperty[];
  readonly paragraphPropertiesNode: OoxmlElement | undefined;
  readonly tablePropertiesNode: OoxmlElement | undefined;
  readonly tableRowPropertiesNode: OoxmlElement | undefined;
  readonly conditionalTableFormats: ReadonlyMap<string, OoxmlElement>;
}

export function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

export function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

export function childNamed(parent: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of parent.children) {
    if (isElement(child) && child.localName === localName) return child;
  }
  return undefined;
}

export function isValidStyleId(raw: string | undefined): raw is string {
  if (raw === undefined || raw.length === 0 || raw.length > STYLE_ID_MAX) return false;
  return !CONTROL_CHARS.test(raw) && !isDangerousKey(raw);
}

function isDefaultFlag(raw: string | undefined): boolean {
  return raw === '1' || raw === 'true' || raw === 'on';
}

export function findRunProperties(container: OoxmlElement | undefined): OoxmlElement | undefined {
  if (!container) return undefined;
  for (const child of container.children) {
    if (isElement(child) && (child.kind === 'runProperties' || child.localName === 'rPr')) {
      return child;
    }
  }
  return undefined;
}

export function findParagraphProperties(
  container: OoxmlElement | undefined
): OoxmlElement | undefined {
  if (!container) return undefined;
  for (const child of container.children) {
    if (isElement(child) && (child.kind === 'paragraphProperties' || child.localName === 'pPr')) {
      return child;
    }
  }
  return undefined;
}

const STYLE_CHANGE_RECORDS: ReadonlySet<string> = new Set([
  'rPrChange',
  'pPrChange',
  'ins',
  'del',
  'moveFrom',
  'moveTo',
]);

export function withoutChangeRecords(props: OoxmlProperty[]): OoxmlProperty[] {
  return props.some((property) => STYLE_CHANGE_RECORDS.has(property.localName))
    ? props.filter((property) => !STYLE_CHANGE_RECORDS.has(property.localName))
    : props;
}

export function readDocDefaults(stylesRoot: OoxmlElement): {
  run: readonly OoxmlProperty[];
  paragraph: readonly OoxmlProperty[];
  paragraphNode: OoxmlElement | undefined;
} {
  const docDefaults = childNamed(stylesRoot, 'docDefaults');
  if (!docDefaults) return { run: [], paragraph: [], paragraphNode: undefined };
  const runNode = findRunProperties(childNamed(docDefaults, 'rPrDefault'));
  const paragraphNode = findParagraphProperties(childNamed(docDefaults, 'pPrDefault'));
  return {
    run: withoutChangeRecords(propertiesOf(runNode)),
    paragraph: withoutChangeRecords(propertiesOf(paragraphNode)),
    paragraphNode,
  };
}

export function readStyleDefinition(
  node: OoxmlElement
): (StyleDefinition & { isDefault: boolean }) | null {
  const styleId = attributeValue(node, 'styleId');
  if (!isValidStyleId(styleId)) return null;
  const type = attributeValue(node, 'type') ?? '';
  const basedOnNode = childNamed(node, 'basedOn');
  const basedOnRaw = basedOnNode ? attributeValue(basedOnNode, 'val') : undefined;
  const basedOn = isValidStyleId(basedOnRaw) ? basedOnRaw : null;
  const nextNode = childNamed(node, 'next');
  const nextRaw = nextNode ? attributeValue(nextNode, 'val') : undefined;
  const next = isValidStyleId(nextRaw) ? nextRaw : null;
  const paragraphPropertiesNode = findParagraphProperties(node);
  const runPropertiesNode = findRunProperties(node);
  const conditionalTableFormats = new Map<string, OoxmlElement>();
  let seenConditional = 0;
  for (const child of node.children) {
    if (child.kind === 'textValue' || child.localName !== 'tblStylePr') continue;
    if (seenConditional >= MAX_CONDITIONAL_TABLE_FORMATS) break;
    seenConditional += 1;
    const conditionType = attributeValue(child, 'type');
    if (conditionType && !conditionalTableFormats.has(conditionType)) {
      conditionalTableFormats.set(conditionType, child);
    }
  }
  return {
    styleId,
    type,
    basedOn,
    next,
    outlineLevel: styleOutlineLevel(node),
    isDefault: isDefaultFlag(attributeValue(node, 'default')),
    paragraphProperties: withoutChangeRecords(propertiesOf(paragraphPropertiesNode)),
    runProperties: withoutChangeRecords(propertiesOf(runPropertiesNode)),
    paragraphPropertiesNode,
    tablePropertiesNode: childNamed(node, 'tblPr'),
    tableRowPropertiesNode: childNamed(node, 'trPr'),
    conditionalTableFormats,
  };
}
