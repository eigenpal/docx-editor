/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import {
  MAX_BASELINE_BYTES,
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
  type TextCollaborationSession,
} from '../index';
import type { DocumentCollaborationSession } from '../document-session';

// Existing public session consumers can accept a full-document session.
const retainSessionType = (session: DocumentCollaborationSession): TextCollaborationSession =>
  session;

describe('deprecated public collaboration exports', () => {
  test('preserves the published values without presenting them as the current format', () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(SCHEMA_VERSION).toBe(1);
    expect(MAX_BASELINE_BYTES).toBe(20 * 1024 * 1024);
    expect(retainSessionType).toBeFunction();
  });
});
