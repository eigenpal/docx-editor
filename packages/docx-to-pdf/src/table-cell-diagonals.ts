/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { TableCellFragmentRecord } from '@docx-editor.dev/core/layout';
import { color, number as n, rect } from './context.ts';
/** PDF uses the same layout-owned endpoints, widths and physical clip as DOM paint. */
export function cellDiagonalCommands(
  cell: TableCellFragmentRecord,
  x: number,
  y: number,
  height: number
): string[] {
  const records = cell.borders?.diagonals;
  if (!records?.length) return [];
  const first = records[0]!;
  const commands = [
    `q ${rect({ x: cell.box.x, y: cell.box.y, width: first.clipWidth, height: first.clipHeight }, x, y, height)} W n 0 J`,
  ];
  for (const stroke of records) {
    const dash =
      stroke.cssStyle === 'solid'
        ? '[]'
        : `[${n(stroke.widthPt * (stroke.cssStyle === 'dotted' ? 1 : 3))} ${n(stroke.widthPt * 2)}]`;
    commands.push(
      `${color(stroke.color)} RG ${n(stroke.widthPt)} w ${dash} 0 d ${n(x + cell.box.x + stroke.x1)} ${n(height - y - cell.box.y - stroke.y1)} m ${n(x + cell.box.x + stroke.x2)} ${n(height - y - cell.box.y - stroke.y2)} l S`
    );
  }
  commands.push('Q');
  return commands;
}
