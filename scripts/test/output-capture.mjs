// A test file's combined stdout and stderr, held in bounded memory.
//
// The runner used to append every chunk to one string. A file that logged in a loop wrote more
// than a JavaScript string can hold, and `output += chunk` threw `RangeError: Invalid string
// length` inside the pipe's data handler, which crashed the whole runner without naming the file.
// This keeps the start of the output, where the first failure usually is, and the end, where Bun
// prints its tallies, and counts what it dropped between them.

const MiB = 1024 * 1024;

/** Output kept from the start of the file's run. */
export const OUTPUT_HEAD_BYTES = 1 * MiB;
/** Output kept from the end of the file's run. */
export const OUTPUT_TAIL_BYTES = 4 * MiB;
/** A file that writes more than this fails, whatever its tests reported. */
export const OUTPUT_LIMIT_BYTES = 64 * MiB;

/**
 * A sink for a child's output chunks. `text()` returns the kept output, with a line that says how
 * much was dropped from the middle, and `overLimit` says whether the file wrote more than `limit`.
 */
export function createOutputCapture({
  head = OUTPUT_HEAD_BYTES,
  tail = OUTPUT_TAIL_BYTES,
  limit = OUTPUT_LIMIT_BYTES,
} = {}) {
  const headChunks = [];
  let headBytes = 0;
  const tailChunks = [];
  let tailBytes = 0;
  let total = 0;

  return {
    write(chunk) {
      let bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      total += bytes.length;
      if (headBytes < head) {
        const taken = bytes.subarray(0, head - headBytes);
        headChunks.push(taken);
        headBytes += taken.length;
        bytes = bytes.subarray(taken.length);
      }
      if (bytes.length === 0) return;
      tailChunks.push(bytes);
      tailBytes += bytes.length;
      // Drop whole chunks from the front while the rest still fills the tail, then trim one.
      while (tailChunks.length > 1 && tailBytes - tailChunks[0].length >= tail) {
        tailBytes -= tailChunks.shift().length;
      }
      if (tailBytes > tail) {
        tailChunks[0] = tailChunks[0].subarray(tailBytes - tail);
        tailBytes = tail;
      }
    },
    get bytes() {
      return total;
    },
    get overLimit() {
      return total > limit;
    },
    text() {
      const dropped = total - headBytes - tailBytes;
      const parts = [Buffer.concat(headChunks).toString('utf8')];
      if (dropped > 0) parts.push(`\n[... ${dropped} bytes of output omitted ...]\n`);
      parts.push(Buffer.concat(tailChunks).toString('utf8'));
      if (total > limit) {
        parts.push(
          `\nThis file wrote ${total} bytes of output, more than the ${limit}-byte limit, and` +
            ' was stopped. A log line in a loop is the usual cause.\n'
        );
      }
      return parts.join('');
    },
  };
}
