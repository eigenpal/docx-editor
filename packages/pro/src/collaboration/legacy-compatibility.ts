/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type {
  CollaborationFailureCode,
  EditorCollaborationSession,
} from '@docx-editor.dev/core/collaboration';

/**
 * Protocol identifier for the retired text-only collaboration format.
 * @deprecated Use COLLABORATION_FORMAT_VERSION for full-document connection checks.
 * @public
 */
export const PROTOCOL_VERSION = 1;

/**
 * Schema identifier for the retired text-only collaboration format.
 * @deprecated Use COLLABORATION_FORMAT_VERSION for full-document connection checks.
 * @public
 */
export const SCHEMA_VERSION = 1;

/**
 * Historical baseline byte limit for the retired text-only collaboration factory.
 * This value does not configure full-document collaboration limits.
 * @deprecated Use the full-document factory's validation and typed failure codes.
 * @public
 */
export const MAX_BASELINE_BYTES = 20 * 1024 * 1024;

/**
 * Retained type for integrations with the retired text-only collaboration factory.
 * @deprecated Use DocumentCollaborationSession for full-document collaboration.
 * @public
 */
export interface TextCollaborationSession extends EditorCollaborationSession {
  setTransportStatus(
    status: 'ready' | 'disconnected' | 'error',
    reason?: CollaborationFailureCode,
    detail?: string
  ): void;
}
