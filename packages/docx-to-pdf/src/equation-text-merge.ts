/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { number as n } from './context.ts';
import type { EmbeddedFace } from './fonts.ts';

// Operator spacing lays out each atom of equation text as its own node, and each node paints
// as its own text object. Consecutive nodes in one face, size, colour and baseline merge here
// into one `Tm` and one `TJ` array, with a numeric adjustment for each gap. The glyphs land
// on the same positions: each adjustment is measured from the pen the viewer will have.

/** Largest `TJ` adjustment the writer's number formatter accepts. */
const MAX_TJ_ADJUSTMENT = 1_000_000;

const FILL = /^\S+ \S+ \S+ rg$/;
const FONT = /^\/(\S+) (\S+) Tf$/;
// Each group stops at a space or a bracket, so no pattern here can backtrack.
const SHOW = /^(\S+) 0 (\S+) (\S+) (\S+) (\S+) Tm (?:(<[0-9A-Fa-f]+>) Tj|\[([^\]]+)\] TJ)$/;
const PART = /<[0-9A-Fa-f]+>|-?(?:\d+(?:\.\d*)?|\.\d+)/y;

/**
 * Split a `TJ` array body into glyph strings and numbers, or return null when the body holds
 * anything else. Two numbers in a row are ambiguous, so they also refuse the merge.
 */
function showParts(body: string): string[] | null {
  const parts: string[] = [];
  PART.lastIndex = 0;
  while (PART.lastIndex < body.length) {
    const start = PART.lastIndex;
    const match = PART.exec(body);
    if (!match || match.index !== start) return null;
    const part = match[0];
    if (!part.startsWith('<') && parts.length > 0 && !parts.at(-1)!.startsWith('<')) return null;
    parts.push(part);
  }
  return parts.length > 0 ? parts : null;
}

/** One text object that shows glyphs on one baseline and does nothing else. */
interface SimpleShow {
  readonly fill: string;
  readonly face: EmbeddedFace;
  readonly size: string;
  /** The text matrix without its x: horizontal scale, skew, vertical scale, and y. */
  readonly matrix: string;
  readonly unit: number;
  readonly startX: number;
  /** The pen after the last glyph, as the viewer advances it. */
  readonly penX: number;
  readonly parts: readonly string[];
}

function parseShow(painted: string, faces: ReadonlyMap<string, EmbeddedFace>): SimpleShow | null {
  const lines = painted.split('\n');
  if (lines.length !== 5 || lines[1] !== 'BT' || lines[4] !== 'ET') return null;
  const fill = FILL.exec(lines[0]!)?.[0];
  const font = FONT.exec(lines[2]!);
  const show = SHOW.exec(lines[3]!);
  const face = font ? faces.get(font[1]!) : undefined;
  if (!fill || !font || !show || !face) return null;
  const size = Number(font[2]);
  const horizontal = Number(show[1]);
  const unit = size * horizontal;
  if (!Number.isFinite(unit) || unit === 0) return null;
  const parts = show[6] ? [show[6]] : showParts(show[7]!);
  if (!parts) return null;
  const startX = Number(show[4]);
  let penX = startX;
  for (const part of parts) {
    if (part.startsWith('<')) penX += (face.declaredWidth(part.slice(1, -1)) / 1000) * unit;
    else penX -= (Number(part) / 1000) * unit;
  }
  return {
    fill,
    face,
    size: font[2]!,
    matrix: `${show[1]} 0 ${show[2]} ${show[3]} | ${show[5]}`,
    unit,
    startX,
    penX,
    parts,
  };
}

function writeShow(show: SimpleShow): string {
  const [head, y] = show.matrix.split(' | ');
  const parts = show.parts;
  const text =
    parts.length === 1 && parts[0]!.startsWith('<') ? `${parts[0]} Tj` : `[${parts.join('')}] TJ`;
  return [
    show.fill,
    'BT',
    `/${show.face.name} ${show.size} Tf`,
    `${head} ${n(show.startX)} ${y} Tm ${text}`,
    'ET',
  ].join('\n');
}

/**
 * Merge consecutive painted text objects that share a face, size, colour, and baseline.
 * Anything else, such as a rule or an outline glyph, stays as painted and ends the merge.
 */
export function mergeEquationText(
  painted: readonly string[],
  faces: Iterable<EmbeddedFace>
): string[] {
  const byName = new Map<string, EmbeddedFace>();
  for (const face of faces) byName.set(face.name, face);
  const out: string[] = [];
  let open: SimpleShow | null = null;
  // A text object that merged nothing is written back as painted.
  let openSource = '';
  let merged = false;
  const close = () => {
    if (open) out.push(merged ? writeShow(open) : openSource);
    open = null;
    merged = false;
  };
  for (const item of painted) {
    const show = item ? parseShow(item, byName) : null;
    if (!show) {
      close();
      if (item) out.push(item);
      continue;
    }
    // `close` reassigns `open` inside a closure, which control-flow narrowing does not see.
    const current = open as SimpleShow | null;
    if (
      current &&
      current.fill === show.fill &&
      current.face === show.face &&
      current.size === show.size &&
      current.matrix === show.matrix &&
      // A leading number would run into the adjustment written before it.
      show.parts[0]!.startsWith('<')
    ) {
      const adjustment = (1000 * (current.penX - show.startX)) / current.unit;
      if (Number.isFinite(adjustment) && Math.abs(adjustment) <= MAX_TJ_ADJUSTMENT) {
        const parts: string[] = [...current.parts];
        const written: string = n(adjustment);
        let penX: number = current.penX;
        if (Number(written) !== 0) {
          parts.push(written);
          penX -= (Number(written) / 1000) * current.unit;
        }
        // The second object's own numbers continue from where its first glyph now lands.
        const drift: number = penX - show.startX;
        parts.push(...show.parts);
        open = { ...current, parts, penX: show.penX + drift };
        merged = true;
        continue;
      }
    }
    close();
    open = show;
    openSource = item;
  }
  close();
  return out;
}
