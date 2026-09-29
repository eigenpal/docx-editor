// Section line grid (`w:docGrid`, ECMA-376 §17.6.5) as it applies to paragraph lines.
//
// A section whose grid type is `lines`, `linesAndChars` or `snapToChars` declares a line
// pitch in twips. Every line of a paragraph that snaps to the grid takes a whole number of
// pitches: the natural line box rounds UP to the next multiple, and the glyphs sit centred
// in it. A 12pt line under an 18pt pitch is 18pt tall, and a 20pt heading is 36pt tall.
// This is a height rule, not an absolute position rule: the lines of a paragraph that
// starts part-way down a pitch keep that offset.
//
// A paragraph opts out with `w:pPr/w:snapToGrid w:val="0"` (inherited through the style
// cascade like any other paragraph property). Only `auto` line spacing snaps: an `exact` or
// `atLeast` line keeps the height its own rule gives it (a 20pt `atLeast` line under an 18pt
// pitch is 20pt, not two pitches).
// The run-level `w:rPr/w:snapToGrid` is the CHARACTER grid and never reaches this file.
// Table cells do not snap unless the document sets the `w:adjustLineHeightInTable`
// compatibility option (§17.15.3.1).

import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlProperty,
} from '@docx-editor.dev/core/store';
import type { ParagraphLineSpacing } from './paragraph-style.ts';

/**
 * The glyph box may overhang the pitch by this much before a line takes another pitch.
 * Converting twips and summing font metrics can land a line that exactly fills its pitch a
 * part in 1e12 above it, which would otherwise double the line.
 */
const GRID_FIT_TOLERANCE_PT = 0.001;

/** `ST_OnOff` read as an attribute value: anything but an explicit off is on. */
function isOn(raw: string | undefined): boolean {
  return raw === undefined || (raw !== '0' && raw !== 'false' && raw !== 'off');
}

/**
 * Whether a paragraph's lines snap to an active line grid (`w:pPr/w:snapToGrid`).
 *
 * `props` is the flattened cascade, lowest precedence first, so the LAST entry wins. An
 * absent element snaps: the schema default is on whenever a grid exists.
 */
export function paragraphSnapsToLineGrid(props: readonly OoxmlProperty[]): boolean {
  let snaps = true;
  for (const property of props) {
    if (property.localName === 'snapToGrid') snaps = isOn(property.attributes?.val);
  }
  return snaps;
}

/** Whether settings turn on `w:compat/w:adjustLineHeightInTable`. */
export function adjustLineHeightInTable(settingsRoot: OoxmlElement | null): boolean {
  if (
    !settingsRoot ||
    settingsRoot.namespaceUri !== WML_NAMESPACE_URI ||
    settingsRoot.localName !== 'settings'
  )
    return false;
  let enabled = false;
  for (const compat of settingsRoot.children) {
    if (compat.kind === 'textValue' || compat.localName !== 'compat') continue;
    if (compat.namespaceUri !== WML_NAMESPACE_URI) continue;
    for (const setting of compat.children) {
      if (setting.kind === 'textValue' || setting.namespaceUri !== WML_NAMESPACE_URI) continue;
      if (setting.localName !== 'adjustLineHeightInTable') continue;
      enabled = isOn(
        setting.attributes.find(
          (entry) => entry.namespaceUri === WML_NAMESPACE_URI && entry.localName === 'val'
        )?.value
      );
    }
  }
  return enabled;
}

/**
 * Attach the section's line pitch to a paragraph's resolved line spacing when its lines
 * snap. Returns the input unchanged when no grid applies, including for `exact` and
 * `atLeast` spacing.
 */
export function withLineGrid(
  spacing: ParagraphLineSpacing,
  props: readonly OoxmlProperty[],
  gridPitchPt: number | undefined,
  inTableCell: boolean,
  tableCellsSnap: boolean
): ParagraphLineSpacing {
  if (gridPitchPt === undefined || !(gridPitchPt > 0)) return spacing;
  if (spacing.rule !== 'auto' || (inTableCell && !tableCellsSnap)) return spacing;
  if (!paragraphSnapsToLineGrid(props)) return spacing;
  return { ...spacing, gridPitch: gridPitchPt };
}

/**
 * A snapped `auto` line box: the natural box rounded up to whole pitches with the glyphs
 * centred. The multiple scales the snapped box and adds the extra BELOW, as without a grid; a
 * multiple under one keeps the single pitch, because the grid line is the smallest line a
 * snapping paragraph can have. `trailing` is that multiple's extra, which pagination may let
 * hang past the bottom margin; the centring space is part of the line.
 */
export function gridLineBox(
  spacing: ParagraphLineSpacing & { readonly gridPitch: number },
  naturalHeight: number,
  naturalBaseline: number
): { height: number; baseline: number; trailing: number } {
  const pitch = spacing.gridPitch;
  const pitches = Math.max(1, Math.ceil((naturalHeight - GRID_FIT_TOLERANCE_PT) / pitch));
  const snapped = pitches * pitch;
  const baseline = naturalBaseline + (snapped - naturalHeight) / 2;
  const multiple = Math.max(1, spacing.value / 240);
  const height = snapped * multiple;
  return { height, baseline, trailing: height - snapped };
}
