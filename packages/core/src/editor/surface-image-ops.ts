// Guarded image mutation commits for the paginated surface (task 13 fix round 1).
//
// Routes drawing tree ops and package image intents through the same applyOps / commit path
// as keystrokes — viewing refusal, suggesting attribution, and layout/paint refresh.

import type { TreeDocxSession } from '@docx-editor.dev/core/binding';
import type { SemanticSelection } from '@docx-editor.dev/core/layout';
import type { StoryScope } from '@docx-editor.dev/core/store';
import type { ImageDecodePort, SupportedImageMime } from '../store/package/image-resources.ts';
import type {
  InsertImageInput,
  ApplyImagePropertiesInput,
  ImageIntentResult,
} from '../store/store/tree-package-images.ts';
import type { DrawingTreeDocOp } from '../store/store/tree-op-types.ts';
import type { SurfaceEditingMode } from './paginated-surface-contract.ts';

const VIEWING_REFUSAL = 'the document is open for viewing';
const SUGGESTING_IMAGE_REFUSAL = 'image property edits are not supported in suggesting mode';
const TRACKED_DRAWING_DELETION = 'trackedDrawingDeletionUnsupported';

export function createImageOps(deps: {
  session: TreeDocxSession;
  applyOps: (
    ops: readonly DrawingTreeDocOp[],
    before?: { paragraphId: string; start: number; end: number } | null,
    after?: { paragraphId: string; start: number; end: number } | null
  ) => ReturnType<TreeDocxSession['applyTreeOps']>;
  commit: (
    run: () => ReturnType<TreeDocxSession['applyTreeOps']> | boolean,
    selectionAfter?: () => SemanticSelection | null
  ) => void;
  storyScope: () => StoryScope;
  selectionMark: () => { paragraphId: string; start: number; end: number } | null;
  editingMode: () => SurfaceEditingMode;
  author: () => string | undefined;
  trackedDate: () => string;
  decodePort: () => ImageDecodePort;
}): {
  applyDrawingOps: (
    ops: readonly DrawingTreeDocOp[]
  ) => ReturnType<TreeDocxSession['applyTreeOps']>;
  applyImageProperties: (input: ApplyImagePropertiesInput) => ImageIntentResult;
  deleteImage: (drawingNodeId: string) => ImageIntentResult;
  insertImage: (input: Omit<InsertImageInput, 'decodePort'>) => Promise<ImageIntentResult>;
  replaceImage: (
    drawingNodeId: string,
    bytes: Uint8Array,
    mime: SupportedImageMime,
    options: {
      readonly expectedPackageRevision: number;
      readonly commitGuard?: () => boolean;
    }
  ) => Promise<ImageIntentResult>;
} {
  function refuseViewing(): ReturnType<TreeDocxSession['applyTreeOps']> {
    return {
      committed: false,
      rejected: true,
      opCount: 0,
      reason: VIEWING_REFUSAL,
    };
  }

  function refuseSuggestingPropertyEdit(): ReturnType<TreeDocxSession['applyTreeOps']> {
    return {
      committed: false,
      rejected: true,
      opCount: 0,
      reason: SUGGESTING_IMAGE_REFUSAL,
    };
  }

  return {
    applyDrawingOps(ops) {
      if (deps.editingMode() === 'view') return refuseViewing();
      if (deps.editingMode() === 'suggest') return refuseSuggestingPropertyEdit();
      const mark = deps.selectionMark();
      return deps.applyOps(ops, mark, mark);
    },

    applyImageProperties(input) {
      if (deps.editingMode() === 'view') {
        return { ok: false, reason: 'invalidArgs', detail: VIEWING_REFUSAL };
      }
      if (deps.editingMode() === 'suggest') {
        return { ok: false, reason: 'invalidArgs', detail: SUGGESTING_IMAGE_REFUSAL };
      }
      let result: ImageIntentResult = { ok: false, reason: 'invalidArgs' };
      deps.commit(() => {
        result = deps.session.applyImageProperties(deps.storyScope(), input);
        return {
          committed: result.ok,
          rejected: !result.ok,
          opCount: result.ok ? 1 : 0,
          ...(result.ok ? {} : { reason: result.detail ?? result.reason }),
        };
      });
      return result;
    },

    deleteImage(drawingNodeId) {
      if (deps.editingMode() === 'view') {
        return { ok: false, reason: 'invalidArgs', detail: VIEWING_REFUSAL };
      }
      if (deps.editingMode() === 'suggest') {
        return {
          ok: false,
          reason: 'invalidArgs',
          detail: TRACKED_DRAWING_DELETION,
        };
      }
      let result: ImageIntentResult = { ok: false, reason: 'invalidArgs' };
      deps.commit(() => {
        result = deps.session.deleteImage(deps.storyScope(), drawingNodeId);
        return {
          committed: result.ok,
          rejected: !result.ok,
          opCount: result.ok ? 1 : 0,
          ...(result.ok ? {} : { reason: result.detail ?? result.reason }),
        };
      });
      return result;
    },

    insertImage(input) {
      if (deps.editingMode() === 'view') {
        return Promise.resolve({ ok: false, reason: 'invalidArgs', detail: VIEWING_REFUSAL });
      }
      if (deps.editingMode() === 'suggest') {
        return Promise.resolve({
          ok: false,
          reason: 'invalidArgs',
          detail: SUGGESTING_IMAGE_REFUSAL,
        });
      }
      return deps.session.insertImage(deps.storyScope(), {
        ...input,
        decodePort: deps.decodePort(),
      });
    },

    replaceImage(drawingNodeId, bytes, mime, options) {
      if (deps.editingMode() === 'view') {
        return Promise.resolve({ ok: false, reason: 'invalidArgs', detail: VIEWING_REFUSAL });
      }
      if (deps.editingMode() === 'suggest') {
        return Promise.resolve({
          ok: false,
          reason: 'invalidArgs',
          detail: SUGGESTING_IMAGE_REFUSAL,
        });
      }
      return deps.session.replaceImage(
        deps.storyScope(),
        drawingNodeId,
        bytes,
        mime,
        deps.decodePort(),
        options
      );
    },
  };
}
