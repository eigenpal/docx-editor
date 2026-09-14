/** Node.js filesystem delivery for portable Markdown exports. @packageDocumentation @public */
import { lstat, mkdir, open, readdir, realpath, rmdir, unlink } from 'node:fs/promises';
import { basename, dirname, join, parse, resolve, sep } from 'node:path';
import { constants } from 'node:fs';
import { markdownBundleFiles } from './markdown-bundle.ts';
import { MarkdownBundleError } from './media-errors.ts';
import type { MarkdownExportResult } from './markdown-types.ts';

/** Output folder for a portable bundle. @public */
export interface WriteMarkdownBundleOptions {
  /** New or existing empty directory. Files are never overwritten. */
  readonly directory: string;
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function checkDirectory(path: string): Promise<void> {
  const root = parse(path).root;
  let current = root;
  for (const component of path.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, component);
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new MarkdownBundleError(
        'write-failed',
        'Output directories must be real directories, not symbolic links.',
        { path: current }
      );
  }
}

/** Write document.md, document.json, and media/ into a new or empty directory. @public */
export async function writeMarkdownBundle(
  result: MarkdownExportResult,
  options: WriteMarkdownBundleOptions
): Promise<void> {
  const files = markdownBundleFiles(result);
  if (typeof options?.directory !== 'string' || !options.directory.trim())
    throw new TypeError('directory must be a nonempty path');
  const directory = resolve(options.directory);
  const createdFiles: string[] = [];
  const createdDirectories: string[] = [];
  try {
    // Resolve the trusted parent once; generated child paths never originate in the DOCX.
    const parent = await realpath(dirname(directory));
    const target = join(parent, basename(directory));
    await checkDirectory(parent);
    try {
      await mkdir(target);
      createdDirectories.push(target);
    } catch (cause) {
      if (!(typeof cause === 'object' && cause && 'code' in cause && cause.code === 'EEXIST'))
        throw cause;
    }
    await checkDirectory(target);
    if ((await readdir(target)).length)
      throw new MarkdownBundleError(
        'output-not-empty',
        'Choose a new or empty directory; existing files are never overwritten.',
        { path: target }
      );
    if (result.media.length) {
      const media = join(target, 'media');
      await mkdir(media);
      createdDirectories.push(media);
    }
    for (const [relative, bytes] of files) {
      const path = join(target, relative);
      await checkDirectory(dirname(path));
      const handle = await open(
        path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600
      );
      createdFiles.push(path);
      try {
        await handle.writeFile(bytes);
      } finally {
        await handle.close();
      }
    }
  } catch (cause) {
    for (const path of createdFiles.reverse()) {
      try {
        await unlink(path);
      } catch {
        /* Preserve the original write failure. */
      }
    }
    for (const path of createdDirectories.reverse()) {
      try {
        await rmdir(path);
      } catch {
        /* Never remove another writer's files. */
      }
    }
    if (cause instanceof MarkdownBundleError) throw cause;
    throw new MarkdownBundleError(
      'write-failed',
      isMissing(cause)
        ? 'The parent output directory must exist.'
        : 'Could not write the Markdown bundle.',
      { path: directory, cause }
    );
  }
}
