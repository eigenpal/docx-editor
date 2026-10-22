/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Outline paths and turns for text box shapes, in PDF user space.
//
// Layout points run down the page; PDF space runs up. A clockwise turn on the page is a
// negative angle in PDF space, about the same point.

import type { LayoutBox, TextboxOutlineProjection } from '@docx-editor.dev/core/layout';
import { number as n } from './context.ts';

/** Control distance of a cubic quarter circle, as a share of its radius. */
const KAPPA = 0.5522847498;

/** A `cm` that turns user space `degrees` clockwise on the page about page point (x, y). */
export function turnAbout(x: number, y: number, degrees: number, pageHeight: number): string {
  const radians = (-degrees * Math.PI) / 180;
  const a = Math.cos(radians),
    b = Math.sin(radians),
    c = -Math.sin(radians),
    d = Math.cos(radians);
  const px = x,
    py = pageHeight - y;
  const e = px - a * px - c * py,
    f = py - b * px - d * py;
  return `${n(a)} ${n(b)} ${n(c)} ${n(d)} ${n(e)} ${n(f)} cm`;
}

/**
 * The path of `outline` in `box` (page points, top-left origin), shrunk by `inset` on every
 * side so a stroke of twice that width stays inside the box. Each path runs clockwise on the
 * page from the start a dash pattern counts from: an ellipse from its left middle, a rectangle
 * from its top-left corner, a rounded one from below its top-left arc.
 */
export function outlinePath(
  outline: TextboxOutlineProjection,
  box: LayoutBox,
  inset: number,
  pageHeight: number,
  turnDegrees = 0
): string {
  const left = box.x + inset,
    top = box.y + inset;
  const width = Math.max(0, box.width - 2 * inset),
    height = Math.max(0, box.height - 2 * inset);
  // A turned path turns its points clockwise about the box centre, in page space.
  const radians = (turnDegrees * Math.PI) / 180;
  const cos = Math.cos(radians),
    sin = Math.sin(radians);
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  const P = (x: number, y: number) => {
    const dx = left + x - cx,
      dy = top + y - cy;
    return `${n(cx + dx * cos - dy * sin)} ${n(pageHeight - (cy + dx * sin + dy * cos))}`;
  };
  if (outline.kind === 'ellipse') {
    const rx = width / 2,
      ry = height / 2;
    const kx = rx * KAPPA,
      ky = ry * KAPPA;
    return [
      `${P(0, ry)} m`,
      `${P(0, ry - ky)} ${P(rx - kx, 0)} ${P(rx, 0)} c`,
      `${P(rx + kx, 0)} ${P(width, ry - ky)} ${P(width, ry)} c`,
      `${P(width, ry + ky)} ${P(rx + kx, height)} ${P(rx, height)} c`,
      `${P(rx - kx, height)} ${P(0, ry + ky)} ${P(0, ry)} c h`,
    ].join(' ');
  }
  if (outline.kind === 'roundRect') {
    // The radius follows the box's shorter side.
    const r = Math.min(
      Math.max(0, outline.arc * Math.min(box.width, box.height) - inset),
      width / 2,
      height / 2
    );
    const k = r * (1 - KAPPA);
    return [
      `${P(0, r)} m`,
      `${P(0, k)} ${P(k, 0)} ${P(r, 0)} c`,
      `${P(width - r, 0)} l`,
      `${P(width - k, 0)} ${P(width, k)} ${P(width, r)} c`,
      `${P(width, height - r)} l`,
      `${P(width, height - k)} ${P(width - k, height)} ${P(width - r, height)} c`,
      `${P(r, height)} l`,
      `${P(k, height)} ${P(0, height - k)} ${P(0, height - r)} c h`,
    ].join(' ');
  }
  // Polygon points are shares of the box; every subpath is closed.
  return outline.subpaths
    .map(
      (points) =>
        points.map((p, k) => `${P(p.x * width, p.y * height)} ${k ? 'l' : 'm'}`).join(' ') + ' h'
    )
    .join(' ');
}
