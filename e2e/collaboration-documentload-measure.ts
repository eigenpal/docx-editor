import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import { readOoxmlPackage } from '@docx-editor.dev/core/store';
import {
  DocumentRegistry,
  MemoryBlobStore,
  seedPackage,
} from '../packages/pro/src/collaboration/document/index.ts';

const path = process.argv[2];
if (!path) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: 'missing path' })}\n`);
  process.exit(1);
}

const bytes = new Uint8Array(readFileSync(path));
const opened = readOoxmlPackage(bytes);
if (!opened.ok) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: opened.reason })}\n`);
  process.exit(0);
}

const doc = new Y.Doc();
try {
  const registry = new DocumentRegistry(doc);
  const seeded = await seedPackage(registry, opened.package, new MemoryBlobStore());
  if (!seeded.ok) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: seeded.code })}\n`);
    process.exit(0);
  }
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      nodes: registry.schema.nodes.size,
      updateBytes: Y.encodeStateAsUpdate(doc).byteLength,
    })}\n`
  );
} finally {
  doc.destroy();
}
