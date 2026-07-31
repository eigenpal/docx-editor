// Shared OOXML shading fill resolution (paragraph, run, table cell).
//
// `w:shd/@w:fill` is attacker-controlled. Only a strict 6-hex RRGGBB leaves this boundary;
// `auto`/`nil`, theme fills, CSS/URL payloads, and pattern rendering are rejected or deferred.
// Measurement never reads shading — resolve and paint only.

import type { OoxmlElement, OoxmlProperty } from '@docx-editor.dev/core-contract/store';

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
 * Theme fills (`themeFill`) are deferred — never invent a colour from a theme reference.
 * `val="nil"` clears shading. Pattern vals are not rendered; a valid solid `fill` still
 * paints as a clear fill until pattern support lands.
 */
export function resolveOoxmlShadingFill(
  attributes: Readonly<Record<string, string>> | undefined
): string | undefined {
  if (!attributes) return undefined;
  if (attributes.themeFill !== undefined) return undefined;
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
