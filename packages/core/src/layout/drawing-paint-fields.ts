// The paint fields a drawing record copies from its projection: the picture crop and
// transform, effects, hyperlink, vector shape, and the placeholder kind of a graphic that
// does not render.

import type { DrawingImageEffects } from '../store/package/drawing-image-effects.ts';
import type {
  DrawingProjection,
  DrawingTransform,
  SourceCrop,
  VectorShapeProjection,
} from '../store/package/drawing-projection.ts';
import type { PictureFrameEffects } from '../store/package/drawing-picture-frame.ts';
import type { DrawingGroupPictureRecord } from './drawing-layout.ts';

// A Map, not an object literal: the key is a `graphicData@uri` out of the file, so a value
// of `__proto__` or `constructor` must answer undefined, not a prototype member.
const GRAPHIC_URI_KIND: ReadonlyMap<string, string> = new Map([
  ['http://schemas.openxmlformats.org/drawingml/2006/chart', 'chart'],
  ['http://schemas.openxmlformats.org/drawingml/2006/diagram', 'diagram'],
  // A legacy drawing on the line that cannot paint (`legacy-vml-placeholder.ts`).
  ['legacy-vml', 'shape'],
  ['http://schemas.microsoft.com/office/word/2010/wordprocessingGroup', 'group'],
  ['http://schemas.microsoft.com/office/word/2010/wordprocessingShape', 'textbox'],
  ['http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas', 'canvas'],
]);

const EMPTY_TRANSFORM: DrawingTransform = Object.freeze({
  rotationDegrees: 0,
  flipHorizontal: false,
  flipVertical: false,
  offsetEmu: Object.freeze({ x: 0, y: 0 }),
  extentEmu: Object.freeze({ cx: 0, cy: 0 }),
});

const EMPTY_CROP: SourceCrop = Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 });

export function drawingPaintFields(projection: DrawingProjection): {
  readonly hyperlinkHref: string | null;
  readonly effects: DrawingImageEffects;
  readonly crop: SourceCrop;
  readonly transform: DrawingTransform;
  readonly placeholderGraphicKind: string | null;
  readonly vectorShape: VectorShapeProjection | null;
  readonly frameEffects?: PictureFrameEffects;
  readonly groupPicture?: DrawingGroupPictureRecord;
} {
  const picture = projection.picture;
  let placeholderGraphicKind: string | null = null;
  if (!picture) {
    for (const diagnostic of projection.diagnostics) {
      if (diagnostic.code !== 'unsupported-graphic') continue;
      const uri = diagnostic.detail ?? '';
      placeholderGraphicKind = GRAPHIC_URI_KIND.get(uri) ?? 'graphic';
      break;
    }
    if (placeholderGraphicKind === null) placeholderGraphicKind = 'graphic';
  }
  return Object.freeze({
    hyperlinkHref: projection.hyperlinkHref,
    effects: projection.effects,
    crop: picture?.crop ?? projection.groupPicture?.crop ?? EMPTY_CROP,
    transform: picture?.transform ?? EMPTY_TRANSFORM,
    placeholderGraphicKind:
      picture || projection.legacyGraphic || projection.textArt ? null : placeholderGraphicKind,
    vectorShape: projection.vectorShape,
    ...(picture?.frameEffects ? { frameEffects: picture.frameEffects } : {}),
    ...(projection.groupPicture
      ? {
          groupPicture: Object.freeze({
            alternateContent: projection.groupPicture.alternateContent,
          }),
        }
      : {}),
  });
}
