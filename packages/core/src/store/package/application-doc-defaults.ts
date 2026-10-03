// The defaults the application supplies when a document omits its own (§17.7.5).
//
// Each half of `w:docDefaults` falls back on its own. An omitted `w:rPrDefault` gives runs
// application kerning and 12pt in both size lanes; an omitted `w:pPrDefault` gives paragraphs
// 8pt after and 278/240 automatic line spacing. A package with no styles part, and a styles
// part with no `w:docDefaults`, omit both halves. An authored empty half keeps the format
// defaults (10pt, no spacing), and so does an `w:rPrDefault` without `w:sz`. Layout, the
// formatting readers, and the clipboard all read omission here, so they agree on one answer.

import { WML_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';
import type { OoxmlProperty } from '../store/tree-op-types.ts';

/** The run size an omitted `w:rPrDefault` supplies, in half-points. */
export const APPLICATION_FONT_SIZE_HALF_POINTS = 24;

/** Run properties an omitted `w:rPrDefault` supplies. */
export const APPLICATION_RUN_PROPERTIES: readonly OoxmlProperty[] = Object.freeze([
  Object.freeze({ localName: 'kern', attributes: Object.freeze({ val: '2' }) }),
  Object.freeze({
    localName: 'sz',
    attributes: Object.freeze({ val: String(APPLICATION_FONT_SIZE_HALF_POINTS) }),
  }),
  Object.freeze({
    localName: 'szCs',
    attributes: Object.freeze({ val: String(APPLICATION_FONT_SIZE_HALF_POINTS) }),
  }),
]);

/** Paragraph properties an omitted `w:pPrDefault` supplies. */
export const APPLICATION_PARAGRAPH_PROPERTIES: readonly OoxmlProperty[] = Object.freeze([
  Object.freeze({
    localName: 'spacing',
    attributes: Object.freeze({ after: '160', line: '278', lineRule: 'auto' }),
  }),
]);

/** Which halves of the document defaults a styles part leaves to the application. */
export interface OmittedDocDefaults {
  readonly run: boolean;
  readonly paragraph: boolean;
}

const BOTH: OmittedDocDefaults = Object.freeze({ run: true, paragraph: true });
const NEITHER: OmittedDocDefaults = Object.freeze({ run: false, paragraph: false });

/**
 * The halves of `w:docDefaults` a styles root omits. `null` is a package with no styles part.
 * A root outside the WordprocessingML namespace is not a styles part, so it supplies nothing.
 */
export function omittedDocDefaults(stylesRoot: OoxmlElement | null): OmittedDocDefaults {
  if (!stylesRoot) return BOTH;
  if (stylesRoot.namespaceUri !== WML_NAMESPACE_URI) return NEITHER;
  const defaults = stylesRoot.children.find(
    (child): child is OoxmlElement =>
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === 'docDefaults'
  );
  if (!defaults || defaults.kind === 'textValue') return BOTH;
  const has = (localName: string): boolean =>
    defaults.children.some(
      (child) =>
        child.kind !== 'textValue' &&
        child.namespaceUri === WML_NAMESPACE_URI &&
        child.localName === localName
    );
  return { run: !has('rPrDefault'), paragraph: !has('pPrDefault') };
}
