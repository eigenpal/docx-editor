/**
 * Image-actions composable — owns the `selectedImage` /
 * `imageInteracting` refs plus the toolbar/menu handlers that mutate
 * an image's wrap type, transform, or insert a fresh image at the
 * caret. Consumed downstream by `useContextMenus`, `usePagesPointer`,
 * and the selection-overlay update in the parent (which writes back
 * into `selectedImage` when the PM doc holds a NodeSelection on an
 * image). Does NOT own the right-click menus — those live in
 * `useContextMenus`.
 */

import { computed, shallowRef, ref, type Ref, type ShallowRef } from 'vue';
import type { EditorView } from 'prosemirror-view';
import {
  captureInlinePositionEmu,
  toolbarValueToLayoutTarget,
} from '@eigenpal/docx-editor-core/layout-painter';
import type { ImageSelectionInfo } from '../components/imageSelectionTypes';

type Commands = Record<string, ((...args: unknown[]) => unknown) | undefined>;

export interface UseImageActionsOptions {
  editorView: Ref<EditorView | null>;
  zoom: Ref<number>;
  stateTick: Ref<number>;
  getCommands: () => Commands;
}

export interface ImageToolbarContext {
  wrapType: string;
  displayMode: string;
  cssFloat: string | null;
}

export interface UseImageActionsReturn {
  selectedImage: import('vue').ShallowRef<ImageSelectionInfo | null>;
  imageInteracting: import('vue').Ref<boolean>;
  imageToolbarContext: import('vue').ComputedRef<ImageToolbarContext | null>;
  handleInsertImage: (data: { src: string; width: number; height: number; alt: string }) => void;
  handleToolbarImageWrap: (value: string) => void;
  handleImageTransform: (action: 'rotateCW' | 'rotateCCW' | 'flipH' | 'flipV') => void;
}

export function useImageActions(opts: UseImageActionsOptions): UseImageActionsReturn {
  // shallowRef so the wrapped HTMLElement isn't proxied — identity comparisons
  // downstream (ImageSelectionOverlay) rely on raw element references.
  const selectedImage: ShallowRef<ImageSelectionInfo | null> = shallowRef(null);

  // True while the overlay is mid-resize / move / rotate — gates the pages
  // mousedown handler so an in-flight image gesture isn't clobbered by a stray
  // click (mirrors React's PagedEditor.isImageInteractingRef).
  const imageInteracting = ref(false);

  // Toolbar image group: read the live image attrs from the PM doc at the
  // selected image's position so the wrap dropdown highlights the correct
  // active option. Only the three fields the toolbar dropdown reads — wrap
  // dropdown is the only UI element wired to this context in v1.
  const imageToolbarContext = computed<ImageToolbarContext | null>(() => {
    void opts.stateTick.value;
    const view = opts.editorView.value;
    const sel = selectedImage.value;
    if (!view || !sel) return null;
    const node = view.state.doc.nodeAt(sel.pmPos);
    if (!node || node.type.name !== 'image') return null;
    return {
      wrapType: (node.attrs.wrapType as string) ?? 'inline',
      displayMode: (node.attrs.displayMode as string) ?? 'inline',
      cssFloat: (node.attrs.cssFloat as string) ?? null,
    };
  });

  function handleInsertImage(data: { src: string; width: number; height: number; alt: string }) {
    const view = opts.editorView.value;
    if (!view) return;
    const imageNodeType = view.state.schema.nodes.image;
    if (!imageNodeType) return;
    const node = imageNodeType.create({
      src: data.src,
      alt: data.alt,
      width: data.width,
      height: data.height,
    });
    const { from } = view.state.selection;
    const tr = view.state.tr.insert(from, node);
    view.dispatch(tr.scrollIntoView());
    view.focus();
  }

  // Toolbar wrap dropdown → core PM command. Translates the legacy
  // toolbar vocabulary via `toolbarValueToLayoutTarget` so this path
  // shares `setImageWrapType` with the right-click menu.
  function handleToolbarImageWrap(value: string) {
    const view = opts.editorView.value;
    const sel = selectedImage.value;
    if (!view || !sel) return;
    const target = toolbarValueToLayoutTarget(value);
    if (!target) return;
    const node = view.state.doc.nodeAt(sel.pmPos);
    const cmds = opts.getCommands();
    const optsArg =
      node?.attrs.wrapType === 'inline' && target !== 'inline'
        ? { initialPositionEmu: captureInlinePositionEmu(sel.element, opts.zoom.value) }
        : undefined;
    const cmd = cmds.setImageWrapType?.(sel.pmPos, target, optsArg) as
      | ((
          state: EditorView['state'],
          dispatch: EditorView['dispatch'],
          view: EditorView
        ) => boolean)
      | undefined;
    if (!cmd) return;
    cmd(view.state, (tr) => view.dispatch(tr), view);
    view.focus();
  }

  // Toolbar transform dropdown → mutate the selected image's
  // `transform` attribute. Rotate is folded mod 360, flip toggles bit
  // flags, then the parts are joined back into a CSS transform string.
  function handleImageTransform(action: 'rotateCW' | 'rotateCCW' | 'flipH' | 'flipV') {
    const view = opts.editorView.value;
    const sel = selectedImage.value;
    if (!view || !sel) return;
    const node = view.state.doc.nodeAt(sel.pmPos);
    if (!node || node.type.name !== 'image') return;

    const current = (node.attrs.transform as string | null) || '';
    const rotateMatch = current.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/);
    let rotation = rotateMatch ? parseFloat(rotateMatch[1]) : 0;
    let flipH = /scaleX\(-1\)/.test(current);
    let flipV = /scaleY\(-1\)/.test(current);

    if (action === 'rotateCW') rotation = (rotation + 90) % 360;
    else if (action === 'rotateCCW') rotation = (rotation - 90 + 360) % 360;
    else if (action === 'flipH') flipH = !flipH;
    else if (action === 'flipV') flipV = !flipV;

    const parts: string[] = [];
    if (rotation !== 0) parts.push(`rotate(${rotation}deg)`);
    if (flipH) parts.push('scaleX(-1)');
    if (flipV) parts.push('scaleY(-1)');
    const next = parts.length > 0 ? parts.join(' ') : null;

    const tr = view.state.tr.setNodeMarkup(sel.pmPos, undefined, {
      ...node.attrs,
      transform: next,
    });
    view.dispatch(tr.scrollIntoView());
    view.focus();
  }

  return {
    selectedImage,
    imageInteracting,
    imageToolbarContext,
    handleInsertImage,
    handleToolbarImageWrap,
    handleImageTransform,
  };
}
