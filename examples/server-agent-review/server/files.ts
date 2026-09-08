import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
export async function atomicWrite(file: string, data: string | Uint8Array) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, file);
}
