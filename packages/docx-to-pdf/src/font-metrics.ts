/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { ExportAdmittedFontFace } from '@docx-editor.dev/core/export';

/** Read static SFNT decoration metrics from the same selected face that Core admitted. */
export function strikeMetrics(
  face: ExportAdmittedFontFace
): { position: number; thickness: number } | null {
  const bytes = face.bytes,
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let base = 0;
  if (bytes.length < 12) return null;
  if (view.getUint32(0) === 0x74746366) {
    if (12 + face.faceIndex * 4 + 4 > bytes.length) return null;
    base = view.getUint32(12 + face.faceIndex * 4);
  }
  if (base + 12 > bytes.length) return null;
  const count = view.getUint16(base + 4);
  if (count > 4096 || base + 12 + count * 16 > bytes.length) return null;
  for (let i = 0; i < count; i++) {
    const entry = base + 12 + i * 16;
    if (view.getUint32(entry) !== 0x4f532f32) continue;
    const offset = view.getUint32(entry + 8),
      length = view.getUint32(entry + 12);
    if (length < 30 || offset + length > bytes.length) return null;
    return { thickness: view.getInt16(offset + 26), position: view.getInt16(offset + 28) };
  }
  return null;
}
