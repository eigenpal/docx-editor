// Paragraph spacing without the HTML rules: `w:doNotUseHTMLParagraphAutoSpacing` (§17.15.3).
//
// By default the larger of one paragraph's after-spacing and the next one's before-spacing
// separates them, and automatic spacing is the HTML `<p>` margin. With the setting on, the two
// gaps add up, and automatic spacing is a fixed 5pt before and 10pt after (`paragraphSpacing`).
// The setting lives in `settings.xml`, outside every paragraph's property chain, so the style
// cascade reads it once and carries it; its cache token covers it.

import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';

/** The settings-derived part of the paragraph spacing rules. */
export interface AdjacentParagraphSpacingSettings {
  /**
   * Adjacent after- and before-spacing add up rather than collapse to the larger one, and
   * automatic spacing resolves to fixed values.
   */
  readonly fixedParagraphSpacing?: true;
}

function wordChild(parent: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of parent.children) {
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri === WML_NAMESPACE_URI && child.localName === localName) return child;
  }
  return undefined;
}

/**
 * Read `w:settings/w:compat/w:doNotUseHTMLParagraphAutoSpacing`. An absent `w:val` means on;
 * `0`, `false` and `off` mean off, like every other `ST_OnOff` value.
 */
export function adjacentParagraphSpacingSettings(
  settings: OoxmlElement | null
): AdjacentParagraphSpacingSettings {
  if (!settings || settings.namespaceUri !== WML_NAMESPACE_URI) return {};
  if (settings.localName !== 'settings') return {};
  const compat = wordChild(settings, 'compat');
  const element = compat && wordChild(compat, 'doNotUseHTMLParagraphAutoSpacing');
  if (!element) return {};
  const value = element.attributes.find(
    (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'val'
  )?.value;
  const on = value === undefined || value === '1' || value === 'true' || value === 'on';
  return on ? { fixedParagraphSpacing: true } : {};
}

/**
 * The part of a paragraph's after-spacing that the next paragraph's before-spacing collapses
 * against. Flow cursors carry this value, so every placement site that collapses the two
 * gaps adds them instead when the document says so.
 */
export function collapsingSpaceAfter(
  after: number,
  settings: AdjacentParagraphSpacingSettings | undefined
): number {
  return settings?.fixedParagraphSpacing ? 0 : after;
}
