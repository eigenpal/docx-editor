/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { PDFName, type PDFDocument, type PDFPage } from 'pdf-lib';
import type {
  FontBackedExportCapabilities,
  ExportAdmittedFontIdentity,
} from '@docx-editor.dev/core/export';
import {
  baselineShiftPtOf,
  noteSeparatorRuleBox,
  glyphSizeFactorOf,
  styleForFontSlot,
  TAB_LEADER_GLYPH,
  tabLeaderPattern,
  type SemanticSpanVisit,
  type ShapedRun,
} from '@docx-editor.dev/core/layout';
import { underlineGap } from './underline-gap.ts';
import { paragraphGridOffsetX } from './paragraph-grid-origin.ts';
import { EmbeddedFace } from './fonts.ts';
import { color, number as n, rect, Work } from './context.ts';

/** Grid the reference puts painted baselines on. Paint only; layout never sees it. */
const PDF_PAINT_GRID_PT = 0.24;

/** Largest `TJ` adjustment the writer's number formatter accepts. */
const MAX_TJ_ADJUSTMENT = 1_000_000;

/**
 * Pen positions for a run, summed from the UNROUNDED advances.
 *
 * A glyph's position is the running sum of the advances before it, written either as the `Tm`
 * that opens its batch or as the `TJ` adjustment that precedes it. `ShapedGlyph.originX` is that sum over advances already rounded to
 * the fixed-point grid, which biases every instance of a character the same way: the error
 * does not cancel, it grows with the glyph count. Summing before rounding and rounding once,
 * at the absolute position, removes it. Worth 0.0022pt at the end of a 90-glyph 11pt line in
 * `footnote-overlap-regression.docx` — small, because the layout grid is 1/1000pt. The larger
 * residual against the reference on that page is the REFERENCE's own quantisation: it shows a
 * whole run at once and lets the consumer accumulate integer 1/1000-em widths, which is
 * 0.0055pt of step at 11pt. See `.cache/pdf/claude-advance-exact/`.
 *
 * Layout is untouched: line breaking still measures the rounded advances, and this only
 * decides where a glyph is drawn inside a span whose own origin layout already fixed.
 *
 * Indexed by glyph, so it makes no assumption about the order paint walks clusters in.
 */
function penOrigins(run: ShapedRun): readonly number[] | undefined {
  const advances = run.exactAdvancesX;
  if (!advances || advances.length !== run.glyphs.length) return undefined;
  const origins: number[] = [];
  let pen = 0;
  for (const advance of advances) {
    origins.push(pen);
    pen += advance;
  }
  return origins;
}

/**
 * Collects consecutive glyphs on one baseline into a single `Tm` and one `TJ` array.
 *
 * A glyph per `Tm` writes an absolute text matrix — about 40 bytes — for every character on
 * the page. `TJ` carries the same positions in about 10: the viewer advances the pen by the
 * width this PDF declares for the code, and each number in the array nudges it by the
 * remainder. On a 521-page document that is the difference between 9.6 kB and 2.6 kB of
 * content stream per page.
 *
 * The positions are identical, not approximated. An adjustment moves the pen by
 * `-value / 1000 * size * horizontal`, so for a glyph that must land at `next` after one
 * declared at `x` with width `w` (1/1000 em), the value is
 * `1000 * (x - next) / (size * horizontal) + w`. Anything that changes how the pen advances
 * — a new face, a new size, a different baseline — ends the batch.
 */
function createGlyphBatch(out: string[], horizontal: number) {
  let face: EmbeddedFace | null = null;
  let size = 0;
  let baselineY = 0;
  let startX = 0;
  let penX = 0;
  let parts: string[] = [];
  const flush = (): void => {
    if (parts.length === 0) return;
    const show =
      parts.length === 1 && parts[0]!.startsWith('<') ? `${parts[0]} Tj` : `[${parts.join('')}] TJ`;
    out.push(`${n(horizontal)} 0 0 1 ${n(startX)} ${n(baselineY)} Tm ${show}`);
    parts = [];
    face = null;
  };
  return {
    flush,
    add(nextFace: EmbeddedFace, nextSize: number, gx: number, gy: number, code: string): void {
      const unit = nextSize * horizontal;
      const continues = face === nextFace && size === nextSize && baselineY === gy && unit !== 0;
      // An adjustment is a multiple of the em, so a tiny size turns an ordinary gap into a
      // number the writer refuses. Start a new batch instead: the absolute matrix says the
      // same thing, whatever the size.
      const adjustment = continues ? (1000 * (penX - gx)) / unit : Number.NaN;
      if (!Number.isFinite(adjustment) || Math.abs(adjustment) > MAX_TJ_ADJUSTMENT) {
        flush();
        face = nextFace;
        size = nextSize;
        baselineY = gy;
        startX = gx;
        penX = gx;
      } else if (gx !== penX) {
        // Positive moves the pen LEFT, so a glyph that must start further right than the
        // previous advance left it takes a negative number.
        const written = n(adjustment);
        parts.push(written);
        // Follow the pen the VIEWER will have, which is the one the WRITTEN number produces.
        // Tracking the intended position instead lets the rounding in each number accumulate
        // along the line rather than being absorbed by the next one.
        penX -= (Number(written) / 1000) * unit;
      }
      parts.push(`<${code}>`);
      penX += (nextFace.declaredWidth(code) / 1000) * unit;
    },
  };
}

export class TextWriter {
  readonly faces = new Map<string, EmbeddedFace>();
  private readonly refused = new Map<string, string>();
  constructor(
    readonly doc: PDFDocument,
    readonly session: FontBackedExportCapabilities,
    readonly work: Work,
    readonly showRevisionMarkup: boolean
  ) {}
  paint(visit: SemanticSpanVisit, page: PDFPage): string {
    const { span, line, storyOrigin, absoluteBox } = visit;
    if (span.style.hidden || !span.text) return '';
    if (span.noteSeparator) {
      const box = noteSeparatorRuleBox(span, line);
      return `${color(span.style.color)} rg ${rect(box, storyOrigin.x - visit.page.box.x, storyOrigin.y - visit.page.box.y, page.getHeight(), true)} f`;
    }
    if (/^[\t\n\r\f]+$/.test(span.text)) return span.tabLeader ? this.leader(visit, page) : '';
    const report = (code: string, message: string): string => {
      this.work.report(code, message, visit.page.index);
      return '';
    };
    const shaped = this.session.shapeLaidOutText(span);
    if (!shaped)
      return report('unshaped-text', 'Core could not provide exact shaping for a visible span');
    if (shaped.run.glyphs.some((g) => g.id === 0))
      return report('missing-glyph', 'A visible span contains missing glyphs');
    const face = this.embeddedFace(shaped.font, visit, page);
    if (!face) return '';
    const style = styleForFontSlot(span.style, span.fontSlot);
    const factor = glyphSizeFactorOf(style);
    // The reference emits the drawn size on the same 0.24pt device grid it paints baselines
    // and rules on, never on a half point: 11 draws at 11.04, 13 at 12.96, 10.5 at 10.56 and
    // 21 at 21.12, in every corpus document. Paint only — the shaped advances that position
    // each glyph keep the authored size, so this scales the drawn mark and moves nothing.
    // A super/subscript run is left on the legacy half point: our glyph size factor is 0.65,
    // and the reference's own emitted sizes bound it to [0.636, 0.6436] (11pt draws 6.96,
    // 10pt draws 6.48, 8pt draws 5.04). Gridding a size computed from the wrong factor moves
    // those runs a whole step AWAY from the reference, so the factor is the thing to settle
    // first, with its own captured control.
    const size =
      factor === 1
        ? Number(
            (
              Math.max(1, Math.round(style.fontSizePt / PDF_PAINT_GRID_PT)) * PDF_PAINT_GRID_PT
            ).toFixed(6)
          )
        : (Math.max(1, Math.round(style.fontSizePt * 2)) / 2) * factor;
    const horizontal = style.horizontalScalePercent / 100;
    const scale = factor / shaped.fixedPointScale;
    const x =
      absoluteBox.x - visit.page.box.x + (span.glyphOffsetPt ?? 0) + paragraphGridOffsetX(visit);
    // Reference PDFs put every text baseline on a 0.24pt grid measured from the page top:
    // 109.44, 126.00, 141.84 and 168.72 are 456, 525, 591 and 703 units exactly.
    //
    // TWO snaps, and the order is the whole point. The reference rounds the ascent to a
    // whole device unit FIRST, then accumulates the exact line advance from there, then
    // rounds the result. Rounding only at the end is not the same, because the ascent's
    // own fraction then rides along every line of the paragraph and decides where each one
    // lands. Calibri 11pt ascends 10.4736pt, which is 43.64 units; the reference lays out
    // from 44. On `footnote-overlap-regression.docx` that fraction alone moved the third
    // line of a paragraph a full unit, and snapping the ascent took the corpus from 38 of
    // 56 pages under 1% to 42. See `.cache/pdf/claude-snapped-ascent/FINDING.md`.
    //
    // The line's HEIGHT is still never rounded. Layout keeps its unrounded metrics, so flow
    // and pagination cannot move, and rounding each line's height instead accumulates and is
    // badly wrong (see .cache/pdf/claude-lineheight-grid/FINDING.md).
    //
    // An exact half-unit rounds toward the page TOP, not away from zero. Ties are not rare:
    // any exact line spacing that is an odd multiple of 0.12pt hits one on every other line,
    // and `Math.round` rounds them the wrong way. A captured control of twelve lines at
    // `w:line="300" w:lineRule="exact"` from a story origin on the grid puts six baselines on
    // an exact .5, and the reference takes the lower unit for all six; `Math.round` missed
    // every one of them by 0.24pt. See `.cache/pdf/claude-linerule/`.
    const baselineFromTop =
      storyOrigin.y -
      visit.page.box.y +
      line.box.y +
      Math.round(line.baseline / PDF_PAINT_GRID_PT) * PDF_PAINT_GRID_PT -
      baselineShiftPtOf(style);
    const baseline =
      page.getHeight() - Math.ceil(baselineFromTop / PDF_PAINT_GRID_PT - 0.5) * PDF_PAINT_GRID_PT;
    let foreground = style.color;
    const revisions = this.showRevisionMarkup ? (span.revisions ?? []) : [];
    const insert = revisions.some((r) => r.kind === 'insert' || r.kind === 'moveTo');
    const deleted = revisions.some((r) => r.kind === 'delete' || r.kind === 'moveFrom');
    if (insert) foreground = '008000';
    if (deleted) foreground = 'C00000';
    const out = [`${color(foreground)} rg`, 'BT', `/${face.name} ${n(size)} Tf`];
    if (style.textOutline)
      out.unshift(`q ${color(style.textOutline.color)} RG ${n(style.textOutline.widthPt)} w 2 Tr`);
    const origins = penOrigins(shaped.run);
    const batch = createGlyphBatch(out, horizontal);
    let extra = 0;
    let activeSize = size;
    let activeFace = face;
    let activeIdentity = shaped.font.identity;
    for (const cluster of [...shaped.run.clusters].sort((a, b) => a.glyphStart - b.glyphStart)) {
      const identity = shaped.fonts?.[cluster.fontSpan];
      if (identity && identity.identity !== activeIdentity) {
        const clusterFace = this.embeddedFace(identity, visit, page);
        if (!clusterFace) return '';
        activeFace = clusterFace;
        activeIdentity = identity.identity;
        batch.flush();
        out.push(`/${activeFace.name} ${n(activeSize)} Tf`);
      }
      const text = shaped.run.text.slice(cluster.textStart, cluster.textEnd);
      for (let i = cluster.glyphStart; i < cluster.glyphEnd; i++) {
        this.work.tick();
        const glyph = shaped.run.glyphs[i]!;
        const glyphSize = size * (glyph.drawScale ?? 1);
        if (glyphSize !== activeSize) {
          batch.flush();
          out.push(`/${activeFace.name} ${n(glyphSize)} Tf`);
          activeSize = glyphSize;
        }
        const code = activeFace.encode(glyph.id, i === cluster.glyphStart ? text : '');
        const origin = origins?.[i] ?? glyph.originX;
        const gx = x + (origin + glyph.offsetX) * scale * horizontal + extra;
        const gy = baseline + (glyph.originY + glyph.offsetY) * scale;
        batch.add(activeFace, activeSize, gx, gy, code);
      }
      extra +=
        text.length * style.characterSpacingPt +
        (text.match(/ /g)?.length ?? 0) * (style.shaping?.wordSpacingPt ?? 0);
    }
    batch.flush();
    out.push('ET');
    if (style.textOutline) out.push('Q');
    const metricScale = size / face.font.unitsPerEm;
    const lineRule = (
      y: number,
      thickness: number,
      c: string | null = foreground,
      width = absoluteBox.width
    ): void => {
      out.push(`${color(c)} rg ${n(x)} ${n(y - thickness / 2)} ${n(width)} ${n(thickness)} re f`);
    };
    if (style.underline || insert) {
      const variant = style.underline?.variant ?? 'single';
      const thickness = face.font.underlineThickness * metricScale;
      const position = baseline + face.font.underlinePosition * metricScale;
      if (!(thickness > 0) || !Number.isFinite(position))
        this.work.report(
          'underline-metrics',
          'Font has no valid underline metrics',
          visit.page.index
        );
      else {
        const c = style.underline?.color ?? foreground;
        const supported = [
          'single',
          'double',
          'thick',
          'dotted',
          'dash',
          'dashLong',
          'dotDash',
          'dotDotDash',
          'wave',
          'wavyDouble',
          'wavyHeavy',
          'dottedHeavy',
          'dashedHeavy',
          'dashLongHeavy',
          'dashDotHeavy',
          'dashDotDotHeavy',
          'words',
        ];
        if (!supported.includes(variant))
          this.work.report(
            'underline-style',
            `Unsupported underline: ${variant}`,
            visit.page.index
          );
        const heavy = variant === 'thick' || variant.endsWith('Heavy');
        const weight = thickness * (heavy ? 2 : 1);
        if (variant === 'wave' || variant.startsWith('wavy')) {
          const wave = (y: number): void => {
            const period = Math.max(2, weight * 6),
              amplitude = Math.max(0.6, weight);
            const path = [`${n(x)} ${n(y)} m`];
            for (let dx = 0; dx < absoluteBox.width; dx += period) {
              this.work.tick();
              const end = Math.min(dx + period, absoluteBox.width),
                length = end - dx;
              path.push(
                `${n(x + dx + length / 4)} ${n(y + amplitude)} ${n(x + dx + length / 4)} ${n(y + amplitude)} ${n(x + dx + length / 2)} ${n(y)} c`,
                `${n(x + dx + (3 * length) / 4)} ${n(y - amplitude)} ${n(x + dx + (3 * length) / 4)} ${n(y - amplitude)} ${n(x + end)} ${n(y)} c`
              );
            }
            out.push(`q ${color(c)} RG ${n(weight)} w ${path.join(' ')} S Q`);
          };
          wave(position);
          if (variant === 'wavyDouble') wave(position - weight * 4);
        } else if (variant.startsWith('dot') || variant.toLowerCase().includes('dash')) {
          const dotted = variant.startsWith('dotted');
          const pattern = dotted
            ? [weight, weight * 2]
            : variant.toLowerCase().includes('dotdot')
              ? [weight * 4, weight * 2, weight, weight * 2, weight, weight * 2]
              : variant.toLowerCase().includes('dot')
                ? [weight * 4, weight * 2, weight, weight * 2]
                : [weight * (variant.includes('Long') ? 8 : 4), weight * 2];
          out.push(
            `q ${color(c)} RG ${n(weight)} w [${pattern.map(n).join(' ')}] 0 d ${n(x)} ${n(position)} m ${n(x + absoluteBox.width)} ${n(position)} l S Q`
          );
        } else if (variant === 'words') {
          for (const cluster of shaped.run.clusters) {
            if (/^\s+$/.test(shaped.run.text.slice(cluster.textStart, cluster.textEnd))) continue;
            const glyph = shaped.run.glyphs[cluster.glyphStart]!;
            out.push(
              `${color(c)} rg ${n(x + glyph.originX * scale * horizontal)} ${n(position - thickness / 2)} ${n(cluster.advance * scale * horizontal)} ${n(thickness)} re f`
            );
          }
        } else {
          lineRule(
            position,
            weight,
            c,
            absoluteBox.width + (variant === 'single' ? underlineGap(visit) : 0)
          );
          if (variant === 'double') lineRule(position - thickness * 2, thickness, c);
        }
      }
    }
    if (style.strike || style.doubleStrike || deleted) {
      if (!face.strike || face.strike.thickness <= 0)
        this.work.report('strike-metrics', 'Font has no valid strike metrics', visit.page.index);
      else {
        const thickness = face.strike.thickness * metricScale;
        const position = baseline + face.strike.position * metricScale;
        lineRule(position, thickness);
        if (style.doubleStrike) lineRule(position + thickness * 2, thickness);
      }
    }
    return out.join('\n');
  }
  private embeddedFace(
    font: ExportAdmittedFontIdentity,
    visit: SemanticSpanVisit,
    page: PDFPage
  ): EmbeddedFace | undefined {
    const report = (code: string, message: string): undefined => {
      this.work.report(code, message, visit.page.index);
      return undefined;
    };
    let face = this.faces.get(font.identity);
    try {
      if (this.refused.has(font.identity))
        return report('font-embedding', this.refused.get(font.identity)!);
      if (!face) {
        const admitted = this.session.admittedFontFace(font.request);
        if (!admitted || admitted.identity !== font.identity)
          return report('font-identity', 'The shaped face does not match the admitted font');
        face = new EmbeddedFace(this.doc, admitted, this.faces.size + 1);
        this.faces.set(font.identity, face);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Font embedding refused';
      this.refused.set(font.identity, reason);
      return report('font-embedding', reason);
    }
    page.node.setFontDictionary(PDFName.of(face.name), face.ref);
    return face;
  }
  private leader(visit: SemanticSpanVisit, page: PDFPage): string {
    const glyph = TAB_LEADER_GLYPH.get(visit.span.tabLeader!);
    if (!glyph || visit.absoluteBox.width <= 0) return '';
    const advance = visit.span.tabLeaderAdvancePt;
    if (!advance || advance <= 0) {
      this.work.report(
        'tab-leader-metrics',
        'Tab leader has no measured advance',
        visit.page.index
      );
      return '';
    }
    const x = visit.absoluteBox.x - visit.page.box.x;
    const pattern = tabLeaderPattern(
      visit.textboxDepth ? visit.span.box.x : x,
      visit.absoluteBox.width,
      advance
    );
    const y =
      page.getHeight() -
      (visit.storyOrigin.y + visit.line.box.y - visit.page.box.y) -
      visit.line.box.height;
    const out = [
      `q ${n(x)} ${n(y)} ${n(visit.absoluteBox.width)} ${n(visit.line.box.height)} re W n`,
    ];
    for (let i = 0; i < pattern.count; i++) {
      this.work.tick();
      out.push(
        this.paint(
          {
            ...visit,
            absoluteBox: {
              ...visit.absoluteBox,
              x: visit.absoluteBox.x + pattern.offsetPt + i * advance,
              width: advance,
            },
            span: {
              ...visit.span,
              text: glyph,
              tabLeader: undefined,
              style: {
                ...visit.span.style,
                characterSpacingPt: 0,
                underline: null,
                bold: visit.span.tabLeader === 'heavy' || visit.span.style.bold,
              },
            },
          },
          page
        )
      );
    }
    out.push('Q');
    return out.join('\n');
  }
}
