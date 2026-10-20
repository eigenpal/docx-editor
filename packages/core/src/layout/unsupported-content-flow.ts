import type { FieldAwarePiece } from './field-pieces.ts';
import type { PendingLine } from './pending-line.ts';
import { paragraphSpanMetadata } from './paragraph-span-metadata.ts';

/** Publish a component's reserved box without inventing model characters. */
export function appendUnsupportedContent(
  line: PendingLine,
  piece: FieldAwarePiece,
  paragraphId: string,
  x: number,
  atomWidth: number
): void {
  const unsupported = piece.unsupported!;
  const descent = Math.max(0, line.height - line.baseline);
  line.baseline = Math.max(line.baseline, unsupported.height);
  line.height = line.baseline + descent;
  line.spans.push({
    range: { paragraphId, start: piece.start, end: piece.end },
    text: '\uFFFC',
    props: piece.props,
    style: piece.style,
    projected: true,
    unsupported,
    box: { x: x, y: 0, width: atomWidth, height: unsupported.height },
    ...paragraphSpanMetadata(piece),
  });
  line.width += atomWidth;
  line.end = piece.end;
}
