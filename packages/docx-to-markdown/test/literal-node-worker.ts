import { cpSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface LiteralNodeWorker {
  readonly repositoryRoot: string;
  readonly temporary: string;
  readonly path: string;
  dispose(): void;
}

// Bun's bundler can race while two test files traverse the same workspace dependency graph.
// Keep builds serialized; the emitted workers themselves still run independently.
let buildQueue = Promise.resolve();
interface SharedWorkerArtifact {
  readonly repositoryRoot: string;
  readonly temporary: string;
  readonly path: string;
  references: number;
}
const sharedWorkers = new Map<string, Promise<SharedWorkerArtifact>>();

/** Bundle a source-level worker and give literal Node the package/assets Bun normally resolves. */
export async function buildLiteralNodeWorker(entrypoint: URL): Promise<LiteralNodeWorker> {
  const key = entrypoint.href;
  const existing = sharedWorkers.get(key);
  if (existing) return workerHandle(key, await existing);

  const pending = buildLiteralNodeWorkerArtifact(entrypoint);
  sharedWorkers.set(key, pending);
  try {
    return workerHandle(key, await pending);
  } catch (error) {
    if (sharedWorkers.get(key) === pending) sharedWorkers.delete(key);
    throw error;
  }
}

function workerHandle(key: string, artifact: SharedWorkerArtifact): LiteralNodeWorker {
  artifact.references += 1;
  let disposed = false;
  return {
    repositoryRoot: artifact.repositoryRoot,
    temporary: artifact.temporary,
    path: artifact.path,
    dispose() {
      if (disposed) return;
      disposed = true;
      artifact.references -= 1;
      if (artifact.references === 0) {
        sharedWorkers.delete(key);
        rmSync(artifact.temporary, { recursive: true, force: true });
      }
    },
  };
}

async function buildLiteralNodeWorkerArtifact(entrypoint: URL): Promise<SharedWorkerArtifact> {
  const previousBuild = buildQueue;
  let releaseBuild!: () => void;
  buildQueue = new Promise<void>((resolve) => {
    releaseBuild = resolve;
  });
  await previousBuild;
  const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
  const cacheDirectory = join(repositoryRoot, 'node_modules', '.cache');
  mkdirSync(cacheDirectory, { recursive: true });
  const temporary = await mkdtemp(join(cacheDirectory, 'docx-markdown-node-'));
  try {
    const outputDirectory = join(temporary, 'src');
    mkdirSync(outputDirectory, { recursive: true });
    cpSync(
      fileURLToPath(new URL('../../fonts/assets', import.meta.url)),
      join(temporary, 'assets'),
      { recursive: true }
    );
    const temporaryModules = join(temporary, 'node_modules');
    mkdirSync(temporaryModules, { recursive: true });
    symlinkSync(
      realpathSync(join(repositoryRoot, 'packages', 'core', 'node_modules', 'harfbuzzjs')),
      join(temporaryModules, 'harfbuzzjs'),
      'junction'
    );
    const built = await Bun.build({
      entrypoints: [fileURLToPath(entrypoint)],
      outdir: outputDirectory,
      target: 'node',
      format: 'esm',
      external: ['harfbuzzjs'],
    });
    if (!built.success) throw new Error(built.logs.map(String).join('\n'));
    const path = built.outputs[0]?.path;
    if (!path) throw new Error('literal Node worker build emitted no entrypoint');
    return {
      repositoryRoot,
      temporary,
      path,
      references: 0,
    };
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  } finally {
    releaseBuild();
  }
}
