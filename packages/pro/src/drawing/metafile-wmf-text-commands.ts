/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Replayed WMF text commands in the character set and face their font records name; see
// `metafile-wmf-text.ts`.

import type { MetafileCommand } from './metafile-recording.ts';
import { wmfTextMatcher, type WmfTextRecord } from './metafile-wmf-text.ts';

/**
 * The replayed commands with each text command re-decoded in its record's character set and
 * set in its record's face. A text command with no matching record is left as replayed.
 */
export function withWmfText(
  commands: readonly MetafileCommand[],
  records: readonly WmfTextRecord[]
): readonly MetafileCommand[] {
  if (!records.length) return commands;
  const match = wmfTextMatcher(records);
  let changed = false;
  const out = commands.map((command) => {
    if (command.kind !== 'text') return command;
    const found = match(command.text);
    if (!found) return command;
    const family = found.face || command.font.family;
    if (
      found.text === command.text &&
      family === command.font.family &&
      found.baseline === command.baseline &&
      found.align === command.align
    )
      return command;
    changed = true;
    return {
      ...command,
      text: found.text,
      font: { ...command.font, family },
      baseline: found.baseline,
      align: found.align,
    };
  });
  return changed ? out : commands;
}
