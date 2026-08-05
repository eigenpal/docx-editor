// Value-typed chrome slots as a hook — wrap and alt text for images today.
//
// Built on the shared `toolbarCommandState` / `runToolbarCommand` path so adapters never
// duplicate engine can-before-exec or invent a parallel value channel.

import { useCallback, useMemo, useRef } from 'react';
import {
  IMAGE_WRAP_TARGETS,
  runToolbarCommand,
  toolbarCommandState,
  type ImageWrapTarget,
} from '@docx-editor.dev/core-contract/editor';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';

/**
 * Live state for a value-typed toolbar control.
 *
 * @public
 */
export interface EditorValueCommandState<T extends string | number> {
  readonly execute: (value: T) => void;
  readonly value: T | null;
  readonly options: readonly T[];
  readonly isEnabled: boolean;
  readonly disabledReason: string | null;
}

interface ValueSlice {
  readonly value: string | null;
  readonly enabled: boolean;
  readonly disabledReason: string | null;
}

function valueSliceEqual(a: ValueSlice, b: ValueSlice): boolean {
  return a.value === b.value && a.enabled === b.enabled && a.disabledReason === b.disabledReason;
}

/**
 * Bind a value-typed chrome slot (`image.wrap`, `image.altText`) to the editor.
 *
 * @public
 */
export function useEditorValueCommand(
  slotId: 'image.wrap'
): EditorValueCommandState<ImageWrapTarget>;
/**
 * @public
 */
export function useEditorValueCommand(slotId: 'image.altText'): EditorValueCommandState<string>;
export function useEditorValueCommand(
  slotId: 'image.wrap' | 'image.altText'
): EditorValueCommandState<ImageWrapTarget> | EditorValueCommandState<string> {
  const editor = useDocxEditor();
  const latest = useRef(slotId);
  latest.current = slotId;

  const selectSlice = useCallback(
    (_snapshot: unknown): ValueSlice => {
      const current = latest.current;
      const state = toolbarCommandState(editor, current);
      return {
        value: state.value ?? null,
        enabled: state.enabled,
        disabledReason: state.disabledReason,
      };
    },
    [editor, slotId]
  );

  const slice = useEditorState(selectSlice, valueSliceEqual);

  const wrapState = useMemo(
    (): EditorValueCommandState<ImageWrapTarget> => ({
      execute: (value) => runToolbarCommand(editor, 'image.wrap', value),
      value: (slice.value as ImageWrapTarget | null) ?? null,
      options: IMAGE_WRAP_TARGETS,
      isEnabled: slice.enabled,
      disabledReason: slice.disabledReason,
    }),
    [editor, slice]
  );

  const altState = useMemo(
    (): EditorValueCommandState<string> => ({
      execute: (value) => runToolbarCommand(editor, 'image.altText', value),
      value: slice.value,
      options: [],
      isEnabled: slice.enabled,
      disabledReason: slice.disabledReason,
    }),
    [editor, slice]
  );

  return slotId === 'image.wrap' ? wrapState : altState;
}

/** Convenience export for hosts composing wrap menus. @public */
export type { ImageWrapTarget };
