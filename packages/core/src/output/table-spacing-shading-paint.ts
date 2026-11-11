// Paints a spaced table's own fill in its cell-spacing gaps, from layout-published regions.
//
// Each region is a row band less the cells inside it; the cells keep painting their own fill,
// or none. The band is one element under the rows, cut by an even-odd clip path, so the gaps
// fill and every unshaded cell keeps showing the page behind it.

import { tableSpacingShadingRegions } from '../layout/table-spacing-shading.ts';
import type { TableFragmentRecord } from '../layout/semantic-records.ts';

const HEX = /^[0-9A-Fa-f]{6}$/;

/** Class of a gap band; table retention replaces these leading layers on every repaint. */
export const TABLE_SPACING_SHADING_CLASS = 'docx-table-spacing-shading';

/** Fixed-point numbers keep the clip path short and free of exponent notation. */
const px = (value: number): string => String(Math.round(value * 100) / 100);

/** The gap bands of `fragment`, positioned in the fragment's own box, bottom layer first. */
export function paintTableSpacingShading(
  document: Document,
  fragment: TableFragmentRecord,
  scale: number
): HTMLElement[] {
  const bands: HTMLElement[] = [];
  for (const region of tableSpacingShadingRegions(fragment)) {
    // Validated at the sink again, like every other file-derived colour.
    if (!HEX.test(region.fill)) continue;
    const { box } = region;
    const band = document.createElement('div');
    band.className = TABLE_SPACING_SHADING_CLASS;
    band.setAttribute('aria-hidden', 'true');
    const style = band.style;
    style.position = 'absolute';
    style.left = `${(box.x - fragment.box.x) * scale}px`;
    style.top = `${(box.y - fragment.box.y) * scale}px`;
    style.width = `${box.width * scale}px`;
    style.height = `${box.height * scale}px`;
    style.backgroundColor = `#${region.fill}`;
    style.pointerEvents = 'none';
    if (region.holes.length > 0) {
      let path = `M0 0H${px(box.width * scale)}V${px(box.height * scale)}H0Z`;
      for (const hole of region.holes) {
        const left = (hole.x - box.x) * scale;
        const top = (hole.y - box.y) * scale;
        path += `M${px(left)} ${px(top)}H${px(left + hole.width * scale)}`;
        path += `V${px(top + hole.height * scale)}H${px(left)}Z`;
      }
      style.clipPath = `path(evenodd, "${path}")`;
    }
    bands.push(band);
  }
  return bands;
}
