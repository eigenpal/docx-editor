/** Create a single-flight loader whose failed attempts do not poison later conversions. */
export function createRetryingLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return async (): Promise<T> => {
    const attempt = (pending ??= load());
    try {
      return await attempt;
    } catch (error) {
      // A late observer of an older rejection must not clear a newer retry already in flight.
      if (pending === attempt) pending = undefined;
      throw error;
    }
  };
}
