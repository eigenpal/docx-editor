// Paints a spaced table's own fill in its cell-spacing gaps, from layout-published regions.
//
// Each region is a row band less the cells inside it; the cells keep painting their own fill,
// or none. The band is one element under the rows, cut by an even-odd clip path, so the gaps
// fill and every unshaded cell keeps showing the page behind it.

import { tableSpacingShadingRegions } from '../layout/table-spacing-shading.ts';
import type { TableFragmentRecord } from '../layout/semantic-records.ts';

const HEX = /^[0-9A-Fa-f]{6}$/;

/** Class of a gap band: the leading layers of a table fragment, under its rows. */
export const TABLE_SPACING_SHADING_CLASS = 'docx-table-spacing-shading';

/** Each painted band's styles, so a repaint that changes nothing keeps the element. */
const bandStyles = new WeakMap<Element, string>();

/** Fixed-point numbers keep the clip path short and free of exponent notation. */
const px = (value: number): string => String(Math.round(value * 100) / 100);

/**
 * The gap bands of `fragment`, positioned in the fragment's own box, bottom layer first. A
 * band of `previous` (the fragment's earlier element) that paints the same is reused, so
 * typing in a cell does not rebuild the bands of every other row.
 */
export function paintTableSpacingShading(
  document: Document,
  fragment: TableFragmentRecord,
  scale: number,
  previous?: HTMLElement
): HTMLElement[] {
  const reusable = new Map<string, Element>();
  for (const child of previous?.children ?? []) {
    if (!child.classList.contains(TABLE_SPACING_SHADING_CLASS)) break;
    const key = bandStyles.get(child);
    if (key !== undefined && !reusable.has(key)) reusable.set(key, child);
  }
  const bands: HTMLElement[] = [];
  for (const region of tableSpacingShadingRegions(fragment)) {
    // Validated at the sink again, like every other file-derived colour.
    if (!HEX.test(region.fill)) continue;
    const { box } = region;
    let clip = '';
    if (region.holes.length > 0) {
      let path = `M0 0H${px(box.width * scale)}V${px(box.height * scale)}H0Z`;
      for (const hole of region.holes) {
        const left = (hole.x - box.x) * scale;
        const top = (hole.y - box.y) * scale;
        path += `M${px(left)} ${px(top)}H${px(left + hole.width * scale)}`;
        path += `V${px(top + hole.height * scale)}H${px(left)}Z`;
      }
      clip = `path(evenodd, "${path}")`;
    }
    const left = `${(box.x - fragment.box.x) * scale}px`;
    const top = `${(box.y - fragment.box.y) * scale}px`;
    const width = `${box.width * scale}px`;
    const height = `${box.height * scale}px`;
    const key = [region.fill, left, top, width, height, clip].join('|');
    const kept = reusable.get(key);
    if (kept) {
      reusable.delete(key);
      bands.push(kept as HTMLElement);
      continue;
    }
    const band = document.createElement('div');
    band.className = TABLE_SPACING_SHADING_CLASS;
    band.setAttribute('aria-hidden', 'true');
    const style = band.style;
    style.position = 'absolute';
    style.left = left;
    style.top = top;
    style.width = width;
    style.height = height;
    style.backgroundColor = `#${region.fill}`;
    style.pointerEvents = 'none';
    if (clip) style.clipPath = clip;
    bandStyles.set(band, key);
    bands.push(band);
  }
  return bands;
}
