import { sha256FontBytes } from '@docx-editor.dev/core/layout';

/**
 * The only network this gate touches: three Montserrat faces, a few hundred KB.
 * Each attempt bounds both the response headers and body to 15 seconds.
 *
 * Retried, because a CDN blip is not a fidelity regression and reporting it as one trains
 * people to re-run a red gate. A CONTENT mismatch is not retried: bytes that arrived and
 * hashed wrong are a real answer, and asking the same immutable URL again returns the
 * same wrong bytes. An HTTP status IS retried, 404 included — a pinned jsDelivr path does
 * not stop existing, so a 404 here is far more likely to be the edge than the catalog.
 */
export async function catalogBytes(
  url: string,
  byteLength: number,
  hash: string,
  family: string
): Promise<Uint8Array> {
  const attempts = 3;
  let lastTransportError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== byteLength || sha256FontBytes(bytes) !== hash) {
        throw new CatalogBytesChanged(`Catalog bytes changed for ${family} (${url})`);
      }
      return bytes;
    } catch (error) {
      if (error instanceof CatalogBytesChanged) throw error;
      lastTransportError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw new Error(
    `${url}: ${attempts} attempts failed; last error ` +
      `${lastTransportError instanceof Error ? lastTransportError.message : String(lastTransportError)}`
  );
}

/** A content mismatch, which is a result rather than a transport failure. */
class CatalogBytesChanged extends Error {}
