/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The three props a collaborative Root must take from the room, taken for you — the Vue twin
// of the React component. See it for why these three and not others.

import { defineComponent, h, type PropType, type VNode } from 'vue';
import { DocxEditorRoot } from '@docx-editor.dev/vue';
import type { EditorModule } from '@docx-editor.dev/core/editor';
import type { CollaborationSession } from '../collaboration/session.ts';

/**
 * What this component needs from a room, which every collaboration composable already
 * returns.
 *
 * Structural on purpose: `useHocuspocusCollaboration`, `useWebrtcCollaboration` and
 * `useDocumentCollaboration` all satisfy it, and so does a host that owns its own resources.
 *
 * @public
 */
export interface CollaborationRootSource {
  readonly document: Uint8Array | null;
  readonly modules: readonly EditorModule[];
  readonly session: CollaborationSession | null;
}

/**
 * Props for {@link DocxEditorCollaborationRoot}.
 *
 * Everything `DocxEditorRoot` takes except the three this component owns, which arrive as
 * fallthrough attributes.
 *
 * @public
 */
export interface DocxEditorCollaborationRootProps {
  /** The room, straight from a collaboration composable. */
  readonly collaboration: CollaborationRootSource;
  /**
   * Rendered before the room has a document — while connecting, or after a failure.
   *
   * This component does not decide what "connecting" looks like, so without the `fallback`
   * slot nothing renders. Keep branching on the composable's `pending` and `error` for
   * anything more specific.
   */
  readonly fallback?: VNode | VNode[];
}

/**
 * A `DocxEditorRoot` wired to a collaboration room.
 *
 * ```html
 * <DocxEditorCollaborationRoot :collaboration="collaboration">
 *   <DocxEditorToolbar />
 *   <DocxEditorViewport>
 *     <DocxEditorContent />
 *     <DocxEditorCollaboration.CaretLabels />
 *   </DocxEditorViewport>
 *   <template #fallback><p>Connecting…</p></template>
 * </DocxEditorCollaborationRoot>
 * ```
 *
 * The presence parts take no `session`: they read it from the editor this mounts.
 *
 * @public
 */
export const DocxEditorCollaborationRoot = defineComponent({
  name: 'DocxEditorCollaborationRoot',
  // Written explicitly below, so they must not also land as fallthrough attributes.
  inheritAttrs: false,
  props: {
    collaboration: {
      type: Object as PropType<CollaborationRootSource>,
      required: true,
    },
  },
  setup(props, { slots, attrs }) {
    return () => {
      const { document, modules, session } = props.collaboration;
      if (!document) return slots.fallback?.() ?? null;
      // The identity is one person, so the two places that name them agree by default. Set
      // apart, `author` and the room's display name drift — and `author` is the one the SAVED
      // FILE keeps, so a reviewer opening it months later reads a name the room never showed.
      const author = (attrs['author'] as string | undefined) ?? session?.identity.name;
      return h(
        DocxEditorRoot,
        {
          ...attrs,
          // On the CHILD, which is what makes it work: a component cannot key itself, but it
          // can key what it renders. A new session is a new document, and remounting is how
          // the editor drops the previous one's undo history and caret.
          key: session?.sessionId ?? 'local',
          document,
          modules,
          ...(author !== undefined ? { author } : {}),
        },
        slots.default ? { default: slots.default } : undefined
      );
    };
  },
});
