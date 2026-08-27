/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The three props a collaborative Root must take from the room, taken for you.
//
// Mounting a room by hand means getting three independent things right, and each fails
// QUIETLY: the `key`, so a new session remounts and `collaborationModule` attaches; the
// `document`, which must be the room's bytes rather than yours; and the `modules`, which must
// be the hook's array rather than the one you passed in. Miss the key and you get a working
// editor that replicates nothing. Miss the modules and the same. Miss the document and you
// edit a different file than the room holds.
//
// None of those throw. This component writes all three, so they cannot be written wrongly.
//
// It is SUGAR, not a replacement: `DocxEditor.Root` with the three props written out stays
// supported and is what you reach for when one page mounts two rooms, or when the bytes come
// from somewhere this component cannot see.

import { DocxEditorRoot } from '@docx-editor.dev/react';
import type { DocxEditorRootProps } from '@docx-editor.dev/react';
import type { EditorModule } from '@docx-editor.dev/core/editor';
import type { ReactNode } from 'react';
import type { CollaborationSession } from '../collaboration/session.ts';

/**
 * What this component needs from a room, which every collaboration hook already returns.
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
 * Everything `DocxEditor.Root` takes except the three this component owns.
 *
 * @public
 */
export interface DocxEditorCollaborationRootProps extends Omit<
  DocxEditorRootProps,
  'document' | 'modules'
> {
  /** The room, straight from a collaboration hook. */
  readonly collaboration: CollaborationRootSource;
  /**
   * What to render before the room has a document — while connecting, or after a failure.
   *
   * This component does not decide what "connecting" looks like, so without it nothing
   * renders. Keep branching on the hook's `pending` and `error` for anything more specific.
   */
  readonly fallback?: ReactNode;
}

/**
 * A `DocxEditor.Root` wired to a collaboration room.
 *
 * ```tsx
 * const collaboration = useHocuspocusCollaboration({ modules: MODULES, room });
 *
 * <DocxEditorCollaborationRoot collaboration={collaboration} fallback={<p>Connecting…</p>}>
 *   <DocxEditor.Toolbar />
 *   <DocxEditor.Viewport>
 *     <DocxEditor.Content />
 *     <DocxEditorCollaboration.CaretLabels />
 *   </DocxEditor.Viewport>
 * </DocxEditorCollaborationRoot>
 * ```
 *
 * The presence parts take no `session`: they read it from the editor this mounts.
 *
 * @public
 */
export function DocxEditorCollaborationRoot({
  collaboration,
  fallback = null,
  author,
  children,
  ...rest
}: DocxEditorCollaborationRootProps) {
  const { document, modules, session } = collaboration;
  if (!document) return <>{fallback}</>;
  // The identity is one person, so the two places that name them agree by default. Set
  // apart, `author` and the room's display name drift — and `author` is the one the SAVED
  // FILE keeps, so a reviewer opening it months later reads a name the room never showed.
  const resolvedAuthor = author ?? session?.identity.name;
  return (
    <DocxEditorRoot
      // On the CHILD, which is what makes it work: a component cannot key itself, but it can
      // key what it renders. A new session is a new document, and remounting is how the
      // editor drops the previous one's undo history and caret.
      key={session?.sessionId ?? 'local'}
      document={document}
      modules={modules}
      {...(resolvedAuthor !== undefined ? { author: resolvedAuthor } : {})}
      {...rest}
    >
      {children}
    </DocxEditorRoot>
  );
}
