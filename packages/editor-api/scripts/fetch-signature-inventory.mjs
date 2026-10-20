#!/usr/bin/env node
// Explicit maintenance command. Reports, tests and builds remain offline.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { verifySubresourceIntegrity } from './lib/integrity.mjs';
import { extractFileFromTarGzip } from './lib/tar.mjs';
import { extractUpstreamInventory } from './lib/signature-inventory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const provenance = JSON.parse(await fs.readFile(path.join(root, 'compat/provenance.json'), 'utf8'));
const upstream = provenance.upstreamPackage;
const response = await fetch(upstream.tarballUrl, { signal: AbortSignal.timeout(60_000) });
if (!response.ok) throw new Error(`Upstream download failed: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (!verifySubresourceIntegrity(bytes, upstream.integrity))
  throw new Error('Upstream integrity mismatch');
const source = extractFileFromTarGzip(bytes, 'index.d.ts');
if (!source) throw new Error('Upstream index.d.ts missing');
const endpoints = extractUpstreamInventory(source.toString('utf8'));
const fixture = {
  schemaVersion: 1,
  upstream: {
    name: upstream.name,
    version: upstream.version,
    integrity: upstream.integrity,
    sourceUrl: upstream.sourceRepository.sourceUrl,
    declarationSha256: createHash('sha256').update(source).digest('hex'),
  },
  endpoints,
};
await fs.writeFile(
  path.join(root, 'compat/reference/word.full-inventory.json'),
  // One endpoint per line keeps this exhaustive fixture practical to diff.
  JSON.stringify(
    { schemaVersion: fixture.schemaVersion, upstream: fixture.upstream },
    null,
    2
  ).slice(0, -2) +
    ',\n  "endpoints": [\n' +
    endpoints.map((entry) => `    ${JSON.stringify(entry)}`).join(',\n') +
    '\n  ]\n}\n'
);
console.log(
  `Pinned ${endpoints.length} Word/OfficeExtension endpoints from ${upstream.name}@${upstream.version}.`
);
