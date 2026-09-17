// `ST_Border` → painted CSS, shared by every border a document draws.
//
// One mapping, two callers today: the paragraph rules of `w:pBdr` and the page frame of
// `w:pgBorders`. They are the same complex type in the schema (`CT_Border`) and the same ink on
// the page, so a second copy of this switch would be a second place for `dotDotDash` to quietly
// become a solid line on one surface only.
//
// THICKNESS IS NOT DECIDED HERE. Layout publishes the stroke box, already inflated for the
// compound styles (`border-metrics.ts`), and these functions only choose how to fill it.

/** Compound `ST_Border` values that layout already inflated — do not hairline-snap. */
export function isCompoundParagraphBorder(val: string): boolean {
  return (
    val === 'double' ||
    val === 'triple' ||
    val === 'doubleWave' ||
    val.startsWith('thinThick') ||
    val.startsWith('thickThin')
  );
}

/**
 * Map authored `ST_Border` onto the painted rule.
 *
 * CSS gives `double` / `dashed` / `dotted` / `groove` / `ridge` / `inset` / `outset` almost
 * for free. Decorative art borders (apples, bats, …) stay solid — a deliberate approximation.
 */
export function applyParagraphBorderStyle(
  rule: HTMLElement,
  val: string,
  color: string,
  vertical: boolean,
  thicknessPx: number,
  scale: number
): void {
  switch (val) {
    case 'dashed':
    case 'dashSmallGap':
    case 'dotDash':
    case 'dotDotDash':
    case 'dashDotStroked': {
      const period = Math.max(4, 4 * scale);
      // The gaps are the gradient's transparent stops. Both callers fill the rule with the ink
      // colour first, so that fill must go, or every gap shows the same colour and the rule reads
      // solid.
      rule.style.backgroundColor = 'transparent';
      rule.style.backgroundImage = `linear-gradient(to ${vertical ? 'bottom' : 'right'}, #${color} 60%, transparent 60%)`;
      rule.style.backgroundSize = vertical ? `100% ${period}px` : `${period}px 100%`;
      return;
    }
    case 'dotted': {
      const period = Math.max(3, 3 * scale);
      rule.style.backgroundColor = 'transparent';
      rule.style.backgroundImage = `linear-gradient(to ${vertical ? 'bottom' : 'right'}, #${color} 35%, transparent 35%)`;
      rule.style.backgroundSize = vertical ? `100% ${period}px` : `${period}px 100%`;
      return;
    }
    case 'double':
    case 'doubleWave':
    case 'triple':
    case 'thinThickSmallGap':
    case 'thickThinSmallGap':
    case 'thinThickThinSmallGap':
    case 'thinThickMediumGap':
    case 'thickThinMediumGap':
    case 'thinThickThinMediumGap':
    case 'thinThickLargeGap':
    case 'thickThinLargeGap':
    case 'thinThickThinLargeGap': {
      // Two hairlines inside the published box — layout owns the band (incl. thin-double floor).
      // Triple and thinThick* compound vals approximate as double; decorative art stays solid.
      const line = Math.max(1, thicknessPx / 3);
      rule.style.backgroundColor = 'transparent';
      if (vertical) {
        rule.style.borderLeft = `${line}px solid #${color}`;
        rule.style.borderRight = `${line}px solid #${color}`;
      } else {
        rule.style.borderTop = `${line}px solid #${color}`;
        rule.style.borderBottom = `${line}px solid #${color}`;
      }
      rule.style.boxSizing = 'border-box';
      return;
    }
    case 'threeDEmboss':
    case 'ridge': {
      rule.style.backgroundColor = 'transparent';
      const side = vertical ? 'borderLeft' : 'borderTop';
      rule.style[side] = `${Math.max(1, thicknessPx)}px ridge #${color}`;
      if (vertical) rule.style.width = '0px';
      else rule.style.height = '0px';
      return;
    }
    case 'threeDEngrave':
    case 'groove': {
      rule.style.backgroundColor = 'transparent';
      const side = vertical ? 'borderLeft' : 'borderTop';
      rule.style[side] = `${Math.max(1, thicknessPx)}px groove #${color}`;
      if (vertical) rule.style.width = '0px';
      else rule.style.height = '0px';
      return;
    }
    case 'inset': {
      rule.style.backgroundColor = 'transparent';
      const side = vertical ? 'borderLeft' : 'borderTop';
      rule.style[side] = `${Math.max(1, thicknessPx)}px inset #${color}`;
      if (vertical) rule.style.width = '0px';
      else rule.style.height = '0px';
      return;
    }
    case 'outset': {
      rule.style.backgroundColor = 'transparent';
      const side = vertical ? 'borderLeft' : 'borderTop';
      rule.style[side] = `${Math.max(1, thicknessPx)}px outset #${color}`;
      if (vertical) rule.style.width = '0px';
      else rule.style.height = '0px';
      return;
    }
    case 'single':
    case 'thick':
    case 'wave':
    default:
      // Solid fill already set. Art borders and unrecognised vals stay solid.
      return;
  }
}
