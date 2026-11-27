// Every packaged font binary matches the input that `assets/sources.json` records, and each
// fallback face carries its own license text in `licenses/`.

import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const assets = new URL('../../assets/', import.meta.url);
const licenses = new URL('../../licenses/', import.meta.url);

test('font binaries match the recorded inputs and carry their own licenses', () => {
  const sources = JSON.parse(readFileSync(new URL('sources.json', assets), 'utf8')) as Record<
    string,
    { installedSha256?: string }
  >;
  let checked = 0;
  for (const [file, record] of Object.entries(sources)) {
    if (record.installedSha256 && /\.(ttf|otf)$/.test(file)) {
      expect(
        createHash('sha256')
          .update(readFileSync(new URL(file, assets)))
          .digest('hex')
      ).toBe(record.installedSha256);
      checked += 1;
    }
    if (file.endsWith('-OFL.txt'))
      expect(readFileSync(new URL(file, licenses), 'utf8')).toContain('SIL OPEN FONT LICENSE');
  }
  expect(checked).toBeGreaterThan(20);
  expect(readFileSync(new URL('TwemojiMozilla-LICENSE.md', licenses), 'utf8')).toContain('CC-BY');
});
