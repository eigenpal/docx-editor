import type { ReviewRevisionItem } from './review-items.ts';
// Formatting details for the review queue; language names belong to localized chrome.
import { WML_NAMESPACE_URI, type OoxmlElement } from '../package/ooxml-tree.ts';
import type { RevisionSite } from './tree-op-revisions.ts';

export function changedLanguages(site: RevisionSite): string[] {
  if (!site.propertyChange || !site.parent) return [];
  const language = (
    properties: OoxmlElement | undefined,
    attribute: string
  ): string | undefined => {
    const lang = properties?.children.find(
      (child) =>
        child.kind !== 'textValue' &&
        child.namespaceUri === WML_NAMESPACE_URI &&
        child.localName === 'lang'
    );
    return lang && lang.kind !== 'textValue'
      ? lang.attributes.find(
          (entry) => entry.namespaceUri === WML_NAMESPACE_URI && entry.localName === attribute
        )?.value
      : undefined;
  };
  const previous = site.node.children.find(
    (child) => child.kind !== 'textValue' && child.localName === site.parent!.localName
  );
  const codes: string[] = [];
  for (const attribute of ['val', 'eastAsia', 'bidi']) {
    const current = language(site.parent, attribute);
    const old = language(previous?.kind !== 'textValue' ? previous : undefined, attribute);
    if (current && current !== old && !codes.includes(current)) codes.push(current);
  }
  return codes;
}

/** Direct formatting values that changed; null means return to inherited formatting. */
export type ReviewFormattingChange = NonNullable<ReviewRevisionItem['formattingChanges']>[number];

const FORMATTING_PROPERTIES: readonly {
  property: ReviewFormattingChange['property'];
  element: string;
  attribute: string;
  kind?: 'toggle' | 'halfPoints' | 'twips';
}[] = [
  { property: 'bold', element: 'b', attribute: 'val', kind: 'toggle' },
  { property: 'italic', element: 'i', attribute: 'val', kind: 'toggle' },
  { property: 'underline', element: 'u', attribute: 'val' },
  { property: 'strike', element: 'strike', attribute: 'val', kind: 'toggle' },
  { property: 'fontFamily', element: 'rFonts', attribute: 'ascii' },
  { property: 'fontSize', element: 'sz', attribute: 'val', kind: 'halfPoints' },
  { property: 'color', element: 'color', attribute: 'val' },
  { property: 'alignment', element: 'jc', attribute: 'val' },
  { property: 'leftIndent', element: 'ind', attribute: 'left', kind: 'twips' },
  { property: 'rightIndent', element: 'ind', attribute: 'right', kind: 'twips' },
  { property: 'firstLineIndent', element: 'ind', attribute: 'firstLine', kind: 'twips' },
  { property: 'hangingIndent', element: 'ind', attribute: 'hanging', kind: 'twips' },
  { property: 'spaceBefore', element: 'spacing', attribute: 'before', kind: 'twips' },
  { property: 'spaceAfter', element: 'spacing', attribute: 'after', kind: 'twips' },
];

export function changedFormatting(site: RevisionSite): ReviewFormattingChange[] {
  if (!site.propertyChange || !site.parent) return [];
  const old = site.node.children.find(
    (child) =>
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === site.parent!.localName
  );
  const changes: ReviewFormattingChange[] = [];
  for (const spec of FORMATTING_PROPERTIES) {
    const valueOf = (properties: OoxmlElement | undefined): string | null => {
      const element = properties?.children.find(
        (child) =>
          child.kind !== 'textValue' &&
          child.namespaceUri === WML_NAMESPACE_URI &&
          child.localName === spec.element
      );
      if (!element || element.kind === 'textValue') return null;
      const raw = element.attributes.find(
        (attr) => attr.namespaceUri === WML_NAMESPACE_URI && attr.localName === spec.attribute
      )?.value;
      if (spec.kind === 'toggle')
        return raw === '0' || raw === 'false' || raw === 'off' ? 'false' : 'true';
      if (raw === undefined) return null;
      if (spec.kind === 'halfPoints' || spec.kind === 'twips') {
        const numeric = Number(raw);
        return Number.isFinite(numeric)
          ? String(numeric / (spec.kind === 'halfPoints' ? 2 : 20))
          : raw;
      }
      return raw;
    };
    const value = valueOf(site.parent);
    if (value !== valueOf(old?.kind !== 'textValue' ? old : undefined))
      changes.push({ property: spec.property, value });
  }
  return changes;
}
