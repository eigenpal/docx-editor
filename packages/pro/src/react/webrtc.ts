/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * `@docx-editor.dev/pro/react/webrtc` — React hook that owns a WebRTC room.
 *
 * Import this subpath only when you use WebRTC. `@docx-editor.dev/pro/react`
 * does not load a network provider.
 *
 * @packageDocumentation
 * @public
 */

export {
  useWebrtcCollaboration,
  type UseWebrtcCollaborationBootstrap,
  type UseWebrtcCollaborationConnectOptions,
  type UseWebrtcCollaborationOptions,
  type UseWebrtcCollaborationReturn,
} from './useWebrtcCollaboration.ts';
