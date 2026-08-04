import { describe, test, expect } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { parseTarEntries, extractFileFromTarGzip } from '../../../scripts/lib/tar.mjs';

/** Builds a minimal single-entry USTAR tar archive (test-only helper). */
function buildTar(entries: { name: string; content: string }[]): Buffer {
  const chunks: Buffer[] = [];
  for (const { name, content } of entries) {
    const header = Buffer.alloc(512);
    header.write(name, 0, 'ascii');
    const contentBuf = Buffer.from(content, 'utf8');
    const sizeOctal = contentBuf.length.toString(8).padStart(11, '0');
    header.write(sizeOctal, 124, 'ascii');
    header[156] = '0'.charCodeAt(0); // regular file typeflag
    chunks.push(header);
    chunks.push(contentBuf);
    const padding = (512 - (contentBuf.length % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024)); // two zeroed end-of-archive blocks
  return Buffer.concat(chunks);
}

describe('parseTarEntries', () => {
  test('reads a single small file entry', () => {
    const tar = buildTar([{ name: 'package/index.d.ts', content: 'declare namespace Word {}' }]);
    const entries = parseTarEntries(tar);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('package/index.d.ts');
    expect(entries[0].content.toString('utf8')).toBe('declare namespace Word {}');
  });

  test('reads multiple entries and skips correctly across 512-byte padding', () => {
    const tar = buildTar([
      { name: 'package/README.md', content: 'hello' },
      { name: 'package/index.d.ts', content: 'x'.repeat(600) },
      { name: 'package/package.json', content: '{}' },
    ]);
    const entries = parseTarEntries(tar);
    expect(entries.map((e) => e.name)).toEqual([
      'package/README.md',
      'package/index.d.ts',
      'package/package.json',
    ]);
    expect(entries[1].content.toString('utf8')).toHaveLength(600);
  });
});

describe('extractFileFromTarGzip', () => {
  test('extracts the requested file from a gzip-compressed tar archive', () => {
    const tar = buildTar([
      { name: 'package/package.json', content: '{"name":"@types/office-js"}' },
      { name: 'package/index.d.ts', content: 'declare namespace Word { function run(): void; }' },
    ]);
    const gz = gzipSync(tar);
    const content = extractFileFromTarGzip(gz, 'package/index.d.ts');
    expect(content?.toString('utf8')).toBe(
      'declare namespace Word { function run(): void; }'
    );
  });

  test('returns null when the target file is not present', () => {
    const tar = buildTar([{ name: 'package/README.md', content: 'hi' }]);
    const gz = gzipSync(tar);
    expect(extractFileFromTarGzip(gz, 'package/index.d.ts')).toBeNull();
  });
});
