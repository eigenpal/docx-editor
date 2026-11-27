// The label a drawing shows in place of a picture that cannot paint.

import type { AnchoredDrawingRecord, InlineDrawingRecord } from '../layout/drawing-layout.ts';
import type { DrawingPaintStrings } from './drawing-paint-strings.ts';

// A Map, not an object literal. `ImageResourceState.mime` is a closed union — it comes from
// `sniffImageMime` or from the content-type lookup, both of which already refuse anything
// else — so this is hardening at a sink that is not currently reachable, kept because the
// union is the only thing standing between a file-derived string and this lookup.
const MIME_FORMAT_LABEL: ReadonlyMap<string, string> = new Map([
  ['image/svg+xml', 'SVG'],
  ['image/tiff', 'TIFF'],
  ['image/x-emf', 'EMF'],
  ['image/x-wmf', 'WMF'],
]);
const UNKNOWN_FORMAT_LABEL = 'Unknown';

/** The localized reason that `drawing` shows no picture. */
export function refusalLabel(
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  strings: DrawingPaintStrings
): string {
  const { resource } = drawing;
  switch (resource.kind) {
    case 'external':
      return strings.externalResource;
    case 'missing':
      return strings.missingResource;
    case 'pending':
      return strings.pendingResource;
    case 'unrenderable':
      switch (resource.reason) {
        case 'unsupported-format':
          return strings.unsupportedFormat(
            MIME_FORMAT_LABEL.get(resource.mime) ?? UNKNOWN_FORMAT_LABEL
          );
        case 'non-picture-graphic':
          return strings.nonPictureGraphic(drawing.placeholderGraphicKind ?? 'graphic');
        case 'signature-mismatch':
          return strings.contentMismatch;
        case 'decode-failed':
          return strings.decodeFailed;
        case 'resource-limit':
          return strings.resourceLimit;
        default:
          return strings.invalidResource;
      }
    default:
      return strings.invalidResource;
  }
}
