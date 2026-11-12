// Proofing settings of one run, through the same style cascade as layout: `w:vanish` hides
// the text from a reader, `w:noProof` asks proofing tools to skip it, and `w:lang` names the
// language to check it in. Complex-script text (`w:rtl` or `w:cs`) checks in `w:bidi`.

import type { OoxmlNode, OoxmlProperty } from '@docx-editor.dev/core/store';
import { runPropertiesOf } from './field-run-text.ts';
import { resolveRunStyle } from './run-style.ts';
import {
  cascadeParagraphFormatting,
  cascadeRunProperties,
  type StyleCascadeTable,
} from './style-cascade.ts';

/** What a proofing tool needs to know about one run. @internal */
export interface RunProofing {
  /** The run is hidden text (`w:vanish`), so a reader does not see it. */
  readonly hidden: boolean;
  /** Proofing tools skip the run (`w:noProof`). */
  readonly noProof: boolean;
  /** The language tag to check the run in, or null when no level of the cascade sets one. */
  readonly lang: string | null;
}

const OFF = new Set(['0', 'false', 'off']);

function isOn(property: OoxmlProperty): boolean {
  const value = property.attributes?.val;
  return value === undefined || !OFF.has(String(value).toLowerCase());
}

function languageTag(value: unknown): string | null {
  // A tag is short ASCII; anything else from the file is not a language tag.
  return typeof value === 'string' && /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8}){0,4}$/.test(value)
    ? value
    : null;
}

/** Proofing settings of a run in `paragraph`, read through the document styles. @internal */
export function createRunProofingReader(
  styles: StyleCascadeTable | undefined
): (paragraph: OoxmlNode, run: OoxmlNode) => RunProofing {
  let inheritedFor: OoxmlNode | undefined;
  let inherited: readonly OoxmlProperty[] = [];
  const cascade = styles
    ? (base: readonly OoxmlProperty[], direct: readonly OoxmlProperty[]) =>
        cascadeRunProperties(base, direct, styles)
    : undefined;
  return (paragraph, run) => {
    if (inheritedFor !== paragraph) {
      inheritedFor = paragraph;
      const pPr =
        paragraph.kind === 'textValue'
          ? undefined
          : paragraph.children.find((child) => child.kind === 'paragraphProperties');
      inherited = styles ? cascadeParagraphFormatting(styles, pPr).runProperties : [];
    }
    const props = runPropertiesOf(run, inherited, cascade);
    let noProof = false;
    let complex = false;
    let latin: string | null = null;
    let bidi: string | null = null;
    // Later levels of the cascade come later in the list, so the last value wins.
    for (const property of props) {
      if (property.localName === 'noProof') noProof = isOn(property);
      else if (property.localName === 'rtl' || property.localName === 'cs')
        complex ||= isOn(property);
      else if (property.localName === 'lang') {
        latin = languageTag(property.attributes?.val) ?? latin;
        bidi = languageTag(property.attributes?.bidi) ?? bidi;
      }
    }
    const lang = complex ? (bidi ?? latin) : latin;
    return { hidden: resolveRunStyle(props).hidden, noProof, lang };
  };
}
