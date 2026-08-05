// Shared OOXML shading fill resolution (paragraph, run, table cell).
//
// `w:shd/@w:fill` is attacker-controlled. Only a strict 6-hex RRGGBB leaves this boundary;
// `auto`/`nil`, theme fills, CSS/URL payloads, and pattern rendering are rejected or deferred.
// Measurement never reads shading — resolve and paint only.
//
// Paragraph shading geometry is the line/content band only: Word does not extend `w:pPr/w:shd`
// into before/after spacing or bottom-border extent. Layout publishes that box; paint must not
// invent it from the fragment outer box.

import type { OoxmlElement, OoxmlProperty } from '@docx-editor.dev/core/store';
import type { LayoutBox } from './semantic-records.ts';

const STRICT_HEX = /^[0-9A-Fa-f]{6}$/;

/**
 * Strict hex fill: exactly six hex digits. Rejects `auto`, `nil`, and any non-hex payload
 * (CSS functions, URLs, short hex, theme tokens).
 */
export function resolveStrictHexFill(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === 'auto' || raw === 'nil') return undefined;
  if (!STRICT_HEX.test(raw)) return undefined;
  return raw.toUpperCase();
}

/**
 * Resolve a `w:shd` attribute bag to a validated RRGGBB fill, or undefined.
 *
 * `w:themeFill` is a REFERENCE, and Word always writes the value it resolved to alongside
 * it: `<w:shd w:val="clear" w:fill="D9E2F3" w:themeFill="accent1" w:themeFillTint="33"/>`.
 * Reading `w:fill` in that case is not inventing a colour from the theme — it is reading
 * the colour the producer computed. Dropping the fill because a theme reference sat next
 * to it left every accent-shaded cell and paragraph unpainted.
 *
 * `val="nil"` clears shading. Pattern vals are not rendered; a valid solid `fill` still
 * paints as a clear fill until pattern support lands. A theme reference with no usable
 * `w:fill` still resolves to nothing rather than a guess.
 */
export function resolveOoxmlShadingFill(
  attributes: Readonly<Record<string, string>> | undefined
): string | undefined {
  if (!attributes) return undefined;
  if (attributes.val === 'nil') return undefined;
  return resolveStrictHexFill(attributes.fill);
}

/** Read `w:shd` from a typed/generic element (table `tcPr`, nested `pPr`, …). */
export function shadingFillFromElement(shd: OoxmlElement | undefined): string | undefined {
  if (!shd || shd.localName !== 'shd') return undefined;
  const attributes: Record<string, string> = {};
  for (const attribute of shd.attributes) {
    attributes[attribute.localName] = attribute.value;
  }
  return resolveOoxmlShadingFill(attributes);
}

/**
 * Resolve paragraph shading from cascaded flat `w:pPr` properties.
 *
 * Later `w:shd` entries win (defaults → style → direct), matching spacing/border cascade.
 */
export function paragraphShading(props: readonly OoxmlProperty[]): string | undefined {
  let fill: string | undefined;
  for (const property of props) {
    if (property.localName !== 'shd') continue;
    fill = resolveOoxmlShadingFill(property.attributes);
  }
  return fill;
}

/**
 * Page-content box for paragraph shading: union of this fragment's line boxes.
 *
 * Excludes collapsed before/after spacing and bottom-border extent so the painted band
 * matches Word's content-area fill (character shading height on a single line).
 */
export function paragraphShadingBox(
  lines: readonly { readonly box: LayoutBox }[],
  x: number,
  width: number
): LayoutBox | undefined {
  if (lines.length === 0) return undefined;
  const top = lines[0]!.box.y;
  const last = lines[lines.length - 1]!.box;
  return {
    x,
    y: top,
    width,
    height: Math.max(last.y + last.height - top, 0),
  };
}
