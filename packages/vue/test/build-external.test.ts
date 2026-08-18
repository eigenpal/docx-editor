import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(import.meta.dir, '..', 'dist', 'index.js');
const text = readFileSync(dist, 'utf8');
if (!text.includes('@docx-editor.dev/core')) {
  throw new Error('Vue dist must import @docx-editor.dev/core by bare specifier');
}
if (text.includes('createLayoutShaping') || text.includes('HarfBuzz')) {
  throw new Error('Vue dist must not inline the engine');
}
