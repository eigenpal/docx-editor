/**
 * Collect export names marked `@deprecated` in committed API Extractor snapshots.
 */

import { readFileSync } from 'node:fs';
import { normalizeSnapshotText } from './api-snapshot-parse.mjs';

export function collectDeprecatedExports(snapshotPath) {
  const deprecated = new Set();
  const lines = normalizeSnapshotText(readFileSync(snapshotPath, 'utf8')).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('@deprecated')) continue;
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const exportLine = lines[j];
      const fn = /^export (?:declare )?function (\w+)/.exec(exportLine);
      if (fn) {
        deprecated.add(fn[1]);
        break;
      }
      const iface = /^export interface (\w+)/.exec(exportLine);
      if (iface) {
        deprecated.add(iface[1]);
        break;
      }
      const type = /^export type (\w+)/.exec(exportLine);
      if (type) {
        deprecated.add(type[1]);
        break;
      }
      const varDecl = /^export (?:declare )?(?:const|let|var|class) (\w+)/.exec(exportLine);
      if (varDecl) {
        deprecated.add(varDecl[1]);
        break;
      }
    }
  }
  return deprecated;
}
