/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * `@docx-editor.dev/pro/vue/hocuspocus` — Vue composable that owns a Hocuspocus room.
 *
 * Import this subpath only when you use Hocuspocus. `@docx-editor.dev/pro/vue`
 * does not load a network provider.
 *
 * @packageDocumentation
 * @public
 */

export {
  useHocuspocusCollaboration,
  type CollaborationSession,
  type UseHocuspocusCollaborationBootstrap,
  type UseHocuspocusCollaborationConnectOptions,
  type UseHocuspocusCollaborationOptions,
  type UseHocuspocusCollaborationReturn,
} from './useHocuspocusCollaboration.ts';
export type { CollaborationIdentityUpdate } from '../collaboration/session.ts';
