/** Create a single-flight loader whose failed attempts do not poison later conversions. */
export function createRetryingLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return async (): Promise<T> => {
    pending ??= load();
    try {
      return await pending;
    } catch (error) {
      pending = undefined;
      throw error;
    }
  };
}
