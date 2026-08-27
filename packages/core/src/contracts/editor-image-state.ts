/**
 * The selected-image read model, split out of `editor.ts`.
 *
 * Separated so the facade file stays under the max-lines gate while the image vocabulary
 * stays one cohesive shape. Re-exported from `editor.ts`, so consumers keep importing
 * `@docx-editor.dev/core/contracts/editor`.
 */

import type {
  DrawingKind,
  DrawingLocks,
  DrawingPositionInput,
  ImageWrapTarget,
} from '../store/package/drawing-projection.ts';
import type { ImageCropPercent } from '../store/package/image-crop-units.ts';
import type { ImageResourceState } from '../store/package/image-resources.ts';

/**
 * Canonical selected-image read model shared by {@link EditorSnapshot.image} and
 * {@link Editor.getSelectedImage}.
 *
 * @public
 */
export interface SelectedImageState {
  readonly id: string;
  readonly kind: DrawingKind;
  readonly widthEmu: number;
  readonly heightEmu: number;
  /** Crop inset per edge in UI percent (0–100); OOXML stores permille (×1000). */
  readonly crop: ImageCropPercent;
  readonly rotationDegrees: number;
  readonly wrap: ImageWrapTarget;
  readonly position: DrawingPositionInput | null;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly hyperlink: string | null;
  readonly locks: DrawingLocks;
  readonly hidden: boolean;
  readonly resourceStatus: ImageResourceState['kind'];
  readonly intrinsic: Readonly<{
    readonly pixelWidth: number;
    readonly pixelHeight: number;
    readonly dpiX: number;
    readonly dpiY: number;
  }> | null;
  readonly canResize: boolean;
  readonly canMove: boolean;
  readonly canChangeWrap: boolean;
  readonly canCrop: boolean;
}

/**
 * The selected image and what may be done to it — the `imageContext` query's answer.
 *
 * An alias of `SelectedImageState`, kept as its own name because it is the query's result type
 * and chrome is written against it.
 *
 * @public
 */
export type ImageContext = SelectedImageState;
