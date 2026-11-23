import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { releaseData } from './catalog.mjs';
import { RELEASE_DATA, ROOT } from './common.mjs';

const release = (version: string, format: string) => ({ version, format });

describe('release data', () => {
  test('marks each release whose format differs from the one before', () => {
    const data = JSON.parse(
      releaseData({
        releases: [
          release('2.18.0', 'docx-collaboration:1.3.1.1'),
          release('2.19.0', 'docx-collaboration:1.3.1.1'),
          release('2.28.0', 'docx-collaboration:1.4.2.1'),
        ],
      })
    );
    expect(data).toEqual({
      releases: [
        { version: '2.18.0', format: 'docx-collaboration:1.3.1.1', formatChanged: false },
        { version: '2.19.0', format: 'docx-collaboration:1.3.1.1', formatChanged: false },
        { version: '2.28.0', format: 'docx-collaboration:1.4.2.1', formatChanged: true },
      ],
    });
  });

  test('holds only the fields a deployment check reads', () => {
    const data = releaseData({
      releases: [{ ...release('2.18.0', 'f'), commit: 'abc', packages: { name: {} } }],
    });
    expect(data).not.toContain('commit');
    expect(data).not.toContain('packages');
  });

  test('the committed file is the data of the committed catalog', () => {
    expect(readFileSync(resolve(ROOT, RELEASE_DATA), 'utf8')).toBe(releaseData());
  });
});
