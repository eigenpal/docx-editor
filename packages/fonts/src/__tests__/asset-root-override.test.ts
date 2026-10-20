import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, cpSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FONT_ASSET_ROOT_ENV, packagedAssetRootOverride } from '../asset-root.ts';

const here = fileURLToPath(new URL('./', import.meta.url));
const packageRoot = join(here, '..', '..');

describe('packagedAssetRootOverride', () => {
  test('ignores an unset, empty, or relative value', () => {
    expect(packagedAssetRootOverride(undefined)).toBeUndefined();
    expect(packagedAssetRootOverride('')).toBeUndefined();
    expect(packagedAssetRootOverride('   ')).toBeUndefined();
    expect(packagedAssetRootOverride('assets')).toBeUndefined();
    expect(packagedAssetRootOverride('./assets/')).toBeUndefined();
  });

  test('accepts a POSIX directory with or without a trailing slash', () => {
    expect(packagedAssetRootOverride('/opt/app/fonts')?.href).toBe('file:///opt/app/fonts/');
    expect(packagedAssetRootOverride('/opt/app/fonts/')?.href).toBe('file:///opt/app/fonts/');
    expect(packagedAssetRootOverride('/opt/my fonts')?.href).toBe('file:///opt/my%20fonts/');
  });

  test('accepts a Windows directory', () => {
    expect(packagedAssetRootOverride('C:\\app\\fonts')?.href).toBe('file:///C:/app/fonts/');
    expect(packagedAssetRootOverride('C:/app/fonts/')?.href).toBe('file:///C:/app/fonts/');
  });

  test('accepts a file: URL and refuses every other scheme', () => {
    expect(packagedAssetRootOverride('file:///srv/fonts')?.href).toBe('file:///srv/fonts/');
    expect(packagedAssetRootOverride('https://cdn.example/fonts/')).toBeUndefined();
    expect(packagedAssetRootOverride('data:text/plain,x')).toBeUndefined();
  });

  test('refuses a filesystem root, which the trusted reader would reject by throwing', () => {
    expect(packagedAssetRootOverride('/')).toBeUndefined();
    expect(packagedAssetRootOverride('file:///')).toBeUndefined();
    expect(packagedAssetRootOverride('C:\\')).toBeUndefined();
  });
});

describe(`${FONT_ASSET_ROOT_ENV} at module scope`, () => {
  // The variable is read once when `index.ts` loads, so a fresh process is the only
  // honest observer. The child copies the packaged faces to a scratch directory and
  // loads Word's defaults from there, proving both the root and every face URL moved.
  test('relocates FONT_ASSET_ROOT and the faces loadDefaultFonts reads', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'docx-fonts-root-'));
    cpSync(join(packageRoot, 'assets'), scratch, { recursive: true });
    const script = `
      import { FONT_ASSET_ROOT, loadDefaultFonts } from ${JSON.stringify(join(packageRoot, 'src', 'index.ts'))};
      import { readFile } from 'node:fs/promises';
      import { fileURLToPath } from 'node:url';
      const seen = [];
      const fetcher = async (input) => {
        const url = input instanceof URL ? input : new URL(String(input));
        seen.push(url.href);
        return new Response(await readFile(fileURLToPath(url)));
      };
      const fragment = await loadDefaultFonts({ fetcher });
      console.log(JSON.stringify({
        root: FONT_ASSET_ROOT.href,
        seen,
        sources: fragment.sources.length,
        failures: fragment.failures.map((f) => f.diagnostic),
      }));
    `;
    const child = spawnSync(process.execPath, ['-e', script], {
      env: { ...process.env, [FONT_ASSET_ROOT_ENV]: scratch },
      encoding: 'utf8',
    });
    expect(child.stderr).toBe('');
    const report = JSON.parse(child.stdout.trim()) as {
      root: string;
      seen: string[];
      sources: number;
      failures: string[];
    };
    const expectedRoot = pathToFileURL(scratch + '/').href;
    expect(report.root).toBe(expectedRoot);
    expect(report.failures).toEqual([]);
    expect(report.sources).toBeGreaterThan(0);
    expect(report.seen.length).toBeGreaterThan(0);
    for (const href of report.seen) expect(href.startsWith(expectedRoot)).toBe(true);
    const files = new Set(readdirSync(scratch));
    for (const href of report.seen) expect(files.has(href.slice(expectedRoot.length))).toBe(true);
  });
});
