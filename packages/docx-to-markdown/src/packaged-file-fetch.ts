export type PackagedFileRead = (
  path: string | URL,
  options: { readonly signal?: AbortSignal }
) => Promise<Uint8Array>;

async function readThroughHandle(path: string | URL, signal?: AbortSignal): Promise<Uint8Array> {
  if (signal?.aborted) throw signal.reason;
  const { open } = await import('node:fs/promises');
  const handle = await open(path, 'r');
  const closeOnAbort = (): void => {
    void handle.close();
  };
  signal?.addEventListener('abort', closeOnAbort, { once: true });
  try {
    if (signal?.aborted) throw signal.reason;
    const size = (await handle.stat()).size;
    const bytes = new Uint8Array(size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      if (signal?.aborted) throw signal.reason;
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (signal?.aborted) throw signal.reason;
    return offset === bytes.byteLength ? bytes : bytes.slice(0, offset);
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    throw error;
  } finally {
    signal?.removeEventListener('abort', closeOnAbort);
    await handle.close().catch(() => {});
  }
}

const nodePackagedFileRead: PackagedFileRead = async (path, { signal }) => {
  const { readFile } = await import('node:fs/promises');
  try {
    return await readFile(path, { ...(signal ? { signal } : {}) });
  } catch (error) {
    // Bun currently presents cross-package signals to node:fs as a different realm. Keep
    // cancellation physical there by switching to a close-on-abort file-handle reader.
    if (
      signal &&
      error instanceof TypeError &&
      error.message.includes('signal') &&
      error.message.includes('AbortSignal')
    ) {
      return readThroughHandle(path, signal);
    }
    throw error;
  }
};

/** Build the packaged-asset fetch adapter. Kept injectable for lifecycle and host-fetch tests. */
export function createPackagedFileFetch(
  read: PackagedFileRead = nodePackagedFileRead,
  networkFetch: typeof fetch = fetch
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const hostSignal = init?.signal;
    if (hostSignal?.aborted) throw hostSignal.reason;
    const value =
      input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
    if (value.protocol !== 'file:') {
      // Source builds run the same package in browser demos. Vite and other bundlers rewrite
      // `new URL('../assets/face.ttf', import.meta.url)` to an HTTP asset URL, so let the host
      // fetch it normally. Published Node builds retain file: URLs and stay on the bounded
      // file-reader path below.
      return networkFetch(value, init);
    }
    // A host signal can come from another JS realm. Node's fs validator rejects such signals
    // even though fetch accepts them, so bridge it through this module's native controller.
    const readController = hostSignal ? new AbortController() : undefined;
    const forwardAbort = (): void => readController?.abort(hostSignal?.reason);
    hostSignal?.addEventListener('abort', forwardAbort, { once: true });
    let bytes: Uint8Array;
    try {
      bytes = await read(value, {
        ...(readController ? { signal: readController.signal } : {}),
      });
      if (hostSignal?.aborted) throw hostSignal.reason;
    } catch (error) {
      if (hostSignal?.aborted) throw hostSignal.reason;
      if (readController?.signal.aborted) throw readController.signal.reason ?? error;
      if (
        (error instanceof DOMException && error.name === 'AbortError') ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        throw error;
      }
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return new Response(null, { status: 404 });
      }
      throw error;
    } finally {
      hostSignal?.removeEventListener('abort', forwardAbort);
    }
    return new Response(bytes as unknown as BodyInit, { status: 200 });
  }) as typeof fetch;
}
