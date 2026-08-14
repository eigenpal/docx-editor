// Browser stub for Node's `module`. harfbuzzjs imports it behind an
// IS_NODE guard that never runs in a browser, but the import must still resolve.
export function createRequire() {
  throw new Error('createRequire is not available in the browser');
}
export default { createRequire };
