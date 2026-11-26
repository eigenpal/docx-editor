// The document settings that place a section's side margins and gutter, read once at the
// boundary: `w:mirrorMargins` (CT_OnOff, ECMA-376 Part 1 §17.15.1.57) and `w:gutterAtTop`
// (CT_OnOff, §17.15.1.50) from settings.xml, and `w:evenAndOddHeaders` (§17.10.1), which
// layout resolves beside the header and footer variants.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { settingsOnOff } from '../store/package/settings-onoff.ts';
import type { PageGeometry } from './page-geometry.ts';
import {
  geometryOfSection,
  type PageMarginSettings,
  type SectionProperties,
} from './section-properties.ts';

type DocumentMarginSettings = Pick<PageMarginSettings, 'mirrorMargins' | 'gutterAtTop'>;

const MIRROR: DocumentMarginSettings = Object.freeze({ mirrorMargins: true });
const AT_TOP: DocumentMarginSettings = Object.freeze({ gutterAtTop: true });
const MIRROR_AT_TOP: DocumentMarginSettings = Object.freeze({
  mirrorMargins: true,
  gutterAtTop: true,
});

/**
 * `w:mirrorMargins` and `w:gutterAtTop` of a settings part, or undefined when both are off.
 * The same settings give the same object, so a consumer can compare by identity.
 */
export function pageMarginSettingsFrom(
  settingsRoot: OoxmlElement | null | undefined
): Pick<PageMarginSettings, 'mirrorMargins' | 'gutterAtTop'> | undefined {
  if (!settingsRoot) return undefined;
  const mirror = settingsOnOff(settingsRoot, 'mirrorMargins');
  const atTop = settingsOnOff(settingsRoot, 'gutterAtTop');
  if (mirror) return atTop ? MIRROR_AT_TOP : MIRROR;
  return atTop ? AT_TOP : undefined;
}

/** What `geometryOfSection` reads, or undefined when no setting changes a section's sides. */
export function sectionMarginSettings(
  document: DocumentMarginSettings | undefined,
  evenAndOddHeaders: boolean | undefined
): PageMarginSettings | undefined {
  if (!evenAndOddHeaders) return document;
  return { ...document, evenAndOddHeaders: true };
}

/**
 * A section's geometry under the layout options of a single-section pass. Without the
 * document's `evenAndOddHeaders` value the section's furniture carries the flag.
 */
export function geometryForLayout(
  section: SectionProperties,
  options: {
    readonly pageMarginSettings?: DocumentMarginSettings;
    readonly evenAndOddHeaders?: boolean;
  },
  furniture: { readonly evenAndOddHeaders: boolean } | undefined
): PageGeometry {
  const evenAndOddHeaders = options.evenAndOddHeaders ?? furniture?.evenAndOddHeaders;
  return geometryOfSection(
    section,
    sectionMarginSettings(options.pageMarginSettings, evenAndOddHeaders)
  );
}

/**
 * Whether the document has facing pages: distinct even and odd headers, or mirrored margins.
 * A section that restarts its page numbering then starts on a sheet of the restarted
 * number's parity (`page-parity-sheet.ts`). A gutter at the top stops the side margins from
 * mirroring (`geometryOfSection`), but the pages still face each other.
 */
export function documentHasFacingPages(
  document: DocumentMarginSettings | undefined,
  evenAndOddHeaders: boolean
): boolean {
  return evenAndOddHeaders || document?.mirrorMargins === true;
}

/**
 * A section's text area in twips: the page less its margins and its gutter. The gutter
 * (`w:pgMar/@w:gutter`, CT_PageMar, ECMA-376 Part 1 §17.6.11) narrows the text area, or
 * shortens it when the document sets `w:gutterAtTop` (CT_OnOff, §17.15.1.50). The values are
 * not clamped: a caller applies its own minimum.
 */
export function sectionTextAreaTwips(
  section: SectionProperties,
  settingsRoot: OoxmlElement | null | undefined
): { readonly widthTwips: number; readonly heightTwips: number } {
  const { pageSize, margins } = section;
  const atTop = pageMarginSettingsFrom(settingsRoot)?.gutterAtTop === true;
  const gutter = Math.max(0, margins.gutterTwips);
  return {
    widthTwips: pageSize.widthTwips - margins.leftTwips - margins.rightTwips - (atTop ? 0 : gutter),
    heightTwips:
      pageSize.heightTwips - margins.topTwips - margins.bottomTwips - (atTop ? gutter : 0),
  };
}
