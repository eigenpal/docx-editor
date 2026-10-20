import { test, expect } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { strToU8, zipSync, unzipSync } from 'fflate';

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

function projectedDocument(kind: 'image' | 'hidden') {
  const entries = unzipSync(documentBytes('Synthetic visible text.'));
  const picture = `<w:r><w:drawing
    xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
    xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
    xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
    xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0"
      relativeHeight="0" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">
      <wp:simplePos x="0" y="0"/>
      <wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>
      <wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>
      <wp:extent cx="127000" cy="127000"/><wp:wrapNone/>
      <wp:docPr id="1" name="Synthetic image"/><wp:cNvGraphicFramePr/>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="Synthetic image"/>
          <pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="image"/>
          <a:stretch><a:fillRect/></a:stretch></pic:blipFill>
          <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="127000" cy="127000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
        </pic:pic></a:graphicData></a:graphic>
    </wp:anchor></w:drawing></w:r>`;
  const prefix =
    kind === 'image'
      ? picture
      : '<w:r><w:t xml:space="preserve">Visible </w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>Hidden</w:t></w:r>';
  entries['word/document.xml'] = strToU8(
    new TextDecoder().decode(entries['word/document.xml']).replace('<w:p>', `<w:p>${prefix}`)
  );
  if (kind === 'image') {
    entries['word/_rels/document.xml.rels'] = strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/pixel.png"/></Relationships>'
    );
    entries['word/media/pixel.png'] = new Uint8Array(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6N8AAAAASUVORK5CYII=',
        'base64'
      )
    );
    entries['[Content_Types].xml'] = strToU8(
      new TextDecoder()
        .decode(entries['[Content_Types].xml'])
        .replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>')
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
  for (const kind of ['image', 'hidden'] as const)
    jobs.push({
      input: join(directory, `${kind}.docx`),
      output: join(directory, `${kind}.json`),
      bytes: projectedDocument(kind),
    });
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
  for (const job of jobs.slice(3)) {
    const projected = JSON.parse(await readFile(job.output, 'utf8'));
    expect(projected.status).toBe('passed');
    expect(projected.checks.layoutUpdated).toBe(true);
    expect(projected.checks.intendedTextOnly).toBe(true);
    expect(projected.checks.complete).toBe(true);
    expect(projected.geometryHashes.incremental).toBe(projected.geometryHashes.reopened);
  }
}, 130_000);
