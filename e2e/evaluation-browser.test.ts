import { test, expect } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { strToU8, zipSync } from 'fflate';

function documentBytes(text: string, protectedDocument = false) {
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    ),
    'word/document.xml': strToU8(
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="Liberation Sans" w:hAnsi="Liberation Sans"/></w:rPr><w:t>${text}</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`
    ),
  };
  if (protectedDocument) {
    entries['word/_rels/document.xml.rels'] = strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>'
    );
    entries['word/settings.xml'] = strToU8(
      '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:documentProtection w:edit="readOnly" w:enforcement="1"/></w:settings>'
    );
    entries['[Content_Types].xml'] = strToU8(
      new TextDecoder()
        .decode(entries['[Content_Types].xml'])
        .replace(
          '</Types>',
          '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>'
        )
    );
  }
  return zipSync(entries);
}

test('browser probe checks real edits and distinguishes unsupported recipes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'docx-evaluation-browser-'));
  const jobs = ['Synthetic browser editing probe.', '', 'Protected synthetic paragraph.'].map(
    (text, index) => ({
      input: join(directory, `${index}.docx`),
      output: join(directory, `${index}.json`),
      bytes: documentBytes(text, index === 2),
    })
  );
  for (const job of jobs) await writeFile(job.input, job.bytes);
  const manifest = join(directory, 'jobs.json');
  await writeFile(manifest, JSON.stringify(jobs.map(({ input, output }) => ({ input, output }))));
  const command = spawnSync('bun', ['e2e/evaluation-browser.ts', '--manifest', manifest], {
    cwd: resolve(import.meta.dir, '..'),
    timeout: 120_000,
    encoding: 'utf8',
  });
  expect(command.error).toBeUndefined();
  expect(command.status).toBe(1);
  const passed = JSON.parse(await readFile(jobs[0]!.output, 'utf8'));
  expect(passed.status).toBe('passed');
  expect(passed.checks.complete).toBe(true);
  expect(passed.change.changedParagraphs).toBe(1);
  expect(passed.change.afterCharacters).toBe(passed.change.beforeCharacters + 1);
  expect(passed.change.beforeTextHash).not.toBe(passed.change.afterTextHash);
  expect(passed.geometryHashes.incremental).toBe(passed.geometryHashes.reopened);
  expect(passed.evidence).toEqual({});
  const blocked = JSON.parse(await readFile(jobs[1]!.output, 'utf8'));
  expect(blocked.status).toBe('blocked');
  expect(blocked.failure.stage).toBe('pointer');
  expect(blocked.coverage.insert).toBe(false);
  expect(blocked.evidence.screenshot).toBeDefined();
  expect(blocked.evidence.trace).toBeDefined();
  expect(blocked.identity).toEqual(passed.identity);
  const protectedResult = JSON.parse(await readFile(jobs[2]!.output, 'utf8'));
  expect(protectedResult.status).toBe('blocked');
  expect(protectedResult.failure.stage).toBe('editAdmission');
  expect(protectedResult.failure.message).toContain('locked');
  expect(protectedResult.coverage.insert).toBe(false);
  expect(protectedResult.change).toBeNull();
}, 130_000);
