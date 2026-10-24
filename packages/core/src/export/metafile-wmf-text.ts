// Replayed WMF text commands in the character set and face their font records name; see
// `store/package/metafile-wmf-text.ts`.

import type { MetafileCommand } from './metafile-recording.ts';
import { wmfTextMatcher, type WmfTextRecord } from '../store/package/metafile-wmf-text.ts';

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
    if (found.text === command.text && family === command.font.family) return command;
    changed = true;
    return { ...command, text: found.text, font: { ...command.font, family } };
  });
  return changed ? out : commands;
}
